-- Run inside a transaction and roll it back after testing.
do $$
declare
  first_event uuid := gen_random_uuid();
  second_event uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  first_submission uuid;
  new_submission uuid;
  first_guest uuid;
  second_guest uuid;
  created boolean;
  actual_count integer;
begin
  insert into public.events (id, slug, title, venue, neighborhood, starts_at, description, category, status)
  values
    (first_event, 'test-' || first_event, 'Teste evento', 'Local', 'Bairro', now() + interval '10 days', 'Teste temporario', 'Teste', 'published'),
    (second_event, 'test-' || second_event, 'Teste evento 2', 'Local', 'Bairro', now() + interval '10 days', 'Teste temporario', 'Teste', 'published');

  select submission_id, register_email_guest_list.created into first_submission, created
    from public.register_email_guest_list(first_event, request_id, 'Teste@Example.com', '[{"name":"Teste Pessoa","ticketType":"man"},{"name":"Outra Pessoa","ticketType":"woman"}]'::jsonb);
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

  select id into first_guest from public.guest_list_entries where submission_id = first_submission limit 1;
  select id into second_guest from public.guest_list_entries where submission_id = first_submission and id <> first_guest;
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{}}', true);
  begin
    perform public.inactivate_guest_list_entry(first_guest);
    raise exception 'non-admin could inactivate a guest';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', true);
  perform public.inactivate_guest_list_entry(first_guest);
  if not exists (select 1 from public.guest_list_submissions where id = first_submission and is_active)
    or not exists (select 1 from public.guest_list_entries where id = first_guest and not is_active) then
    raise exception 'partial inactivation did not preserve submission and guest';
  end if;
  begin
    perform * from public.register_email_guest_list(first_event, gen_random_uuid(), 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
    raise exception 'duplicate email accepted while a guest remains';
  exception when unique_violation then null;
  end;
  perform public.inactivate_guest_list_entry(second_guest);
  if not exists (select 1 from public.guest_list_submissions where id = first_submission and not is_active)
    or (select count(*) from public.guest_list_entries where submission_id = first_submission and not is_active) <> 2 then
    raise exception 'inactive submission or guests were not preserved';
  end if;
  begin
    perform * from public.register_email_guest_list(first_event, request_id, 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
    raise exception 'inactive request was accepted as an idempotent retry';
  exception when invalid_parameter_value then null;
  end;
  select submission_id, register_email_guest_list.created into new_submission, created
    from public.register_email_guest_list(first_event, gen_random_uuid(), 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
  if not created or new_submission = first_submission then
    raise exception 'registration after inactivation failed';
  end if;
  select id into first_guest from public.guest_list_entries where submission_id = new_submission;
  perform public.inactivate_guest_list_entry(first_guest);
  perform * from public.register_email_guest_list(first_event, gen_random_uuid(), 'teste@example.com', '[{"name":"Teste Pessoa","ticketType":"man"}]'::jsonb);
  if (select count(*) from public.guest_list_submissions where event_id = first_event and email = 'teste@example.com' and not is_active) <> 2 then
    raise exception 'multiple inactive registrations were not preserved';
  end if;

  begin
    perform * from public.register_email_guest_list(second_event, gen_random_uuid(), 'invalid-email', '[{"name":"Teste Pessoa","ticketType":"woman"}]'::jsonb);
    raise exception 'invalid email accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_function_privilege('anon', 'public.register_email_guest_list(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('service_role', 'public.create_guest_list_submission(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.inactivate_guest_list_entry(uuid)', 'execute')
    or has_table_privilege('authenticated', 'public.guest_list_entries', 'delete') then
    raise exception 'unsafe RPC permissions';
  end if;
end $$;
