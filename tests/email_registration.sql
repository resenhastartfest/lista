-- Run inside a transaction and roll it back after testing.
do $$
declare
  first_event uuid := gen_random_uuid();
  second_event uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  first_submission uuid;
  created boolean;
  actual_count integer;
begin
  insert into public.events (id, slug, title, venue, neighborhood, starts_at, description, category, status)
  values
    (first_event, 'test-' || first_event, 'Teste evento', 'Local', 'Bairro', now() + interval '10 days', 'Teste temporario', 'Teste', 'published'),
    (second_event, 'test-' || second_event, 'Teste evento 2', 'Local', 'Bairro', now() + interval '10 days', 'Teste temporario', 'Teste', 'published');

  select submission_id, register_email_guest_list.created into first_submission, created
    from public.register_email_guest_list(first_event, request_id, 'Teste@Example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
  if first_submission is null or not created then raise exception 'registration failed'; end if;

  select register_email_guest_list.created into created
    from public.register_email_guest_list(first_event, request_id, 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
  if created then raise exception 'retry created another submission'; end if;

  begin
    perform * from public.register_email_guest_list(first_event, gen_random_uuid(), 'TESTE@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
    raise exception 'duplicate email accepted';
  exception when unique_violation then null;
  end;
  perform * from public.register_email_guest_list(second_event, gen_random_uuid(), 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"woman"}]'::jsonb);
  select count(*) into actual_count from public.guest_list_submissions where event_id in (first_event, second_event);
  if actual_count <> 2 then raise exception 'different events failed'; end if;

  begin
    perform * from public.register_email_guest_list(second_event, gen_random_uuid(), 'invalid-email', '[{"name":"Teste Pessoa","ticketType":"woman"}]'::jsonb);
    raise exception 'invalid email accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_function_privilege('anon', 'public.register_email_guest_list(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('service_role', 'public.create_guest_list_submission(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'unsafe RPC permissions';
  end if;
end $$;
