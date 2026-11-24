alter table public.guest_list_submissions
  add column whatsapp_phone text,
  add column email text,
  add column email_status text not null default 'not_requested'
    check (email_status in ('not_requested', 'pending', 'accepted', 'failed'));

create unique index guest_list_submissions_event_email_unique
  on public.guest_list_submissions (event_id, lower(email))
  where email is not null;

revoke execute on function public.create_guest_list_submission(uuid, uuid, text, jsonb) from service_role;

create function public.register_email_guest_list(
  p_event_id uuid,
  p_request_id uuid,
  p_email text,
  p_guests jsonb
)
returns table (submission_id uuid, created boolean, event_title text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_event_id uuid;
  v_email text;
  v_title text;
  guest jsonb;
  guest_name text;
  ticket_type text;
begin
  if p_email is null or char_length(p_email) > 254
    or p_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    or char_length(split_part(p_email, '@', 1)) > 64
    or split_part(p_email, '@', 1) like '.%'
    or split_part(p_email, '@', 1) like '%.'
    or position('..' in split_part(p_email, '@', 1)) > 0
    or exists (select 1 from unnest(string_to_array(split_part(p_email, '@', 2), '.')) as label where char_length(label) > 63)
    or p_request_id is null or p_event_id is null then
    raise exception 'Invalid registration' using errcode = '22023';
  end if;
  if jsonb_typeof(p_guests) is distinct from 'array' then
    raise exception 'Invalid guests' using errcode = '22023';
  end if;
  if jsonb_array_length(p_guests) not between 1 and 10 then
    raise exception 'Invalid guests' using errcode = '22023';
  end if;

  p_email := lower(btrim(p_email));
  select id, event_id, email into v_id, v_event_id, v_email
    from public.guest_list_submissions where request_id = p_request_id;
  if found then
    if v_event_id is distinct from p_event_id or v_email is distinct from p_email then
      raise exception 'Invalid request identifier' using errcode = '22023';
    end if;
    select title into v_title from public.events where id = p_event_id;
    return query select v_id, false, v_title;
    return;
  end if;

  select title into v_title from public.events
    where id = p_event_id and status = 'published' and starts_at > now();
  if not found then
    raise exception 'Event is not accepting guest lists' using errcode = '22023';
  end if;

  insert into public.guest_list_submissions (request_id, event_id, consent_version, email, email_status)
    values (p_request_id, p_event_id, 'guest-list-v2', p_email, 'pending')
    on conflict (request_id) do nothing
    returning id into v_id;
  if v_id is null then
    select id, event_id, email into v_id, v_event_id, v_email
      from public.guest_list_submissions where request_id = p_request_id;
    if v_event_id is distinct from p_event_id or v_email is distinct from p_email then
      raise exception 'Invalid request identifier' using errcode = '22023';
    end if;
    return query select v_id, false, v_title;
    return;
  end if;

  for guest in select value from jsonb_array_elements(p_guests) as guest_rows(value)
  loop
    guest_name := btrim(guest ->> 'name');
    ticket_type := guest ->> 'ticketType';
    if guest_name is null or char_length(guest_name) not between 2 and 80
      or guest_name ~ '[[:cntrl:]]' or ticket_type is null
      or ticket_type not in ('standard', 'vip', 'man', 'woman', 'couple') then
      raise exception 'Invalid guest' using errcode = '22023';
    end if;
    insert into public.guest_list_entries (submission_id, guest_name, ticket_type)
      values (v_id, guest_name, ticket_type);
  end loop;

  return query select v_id, true, v_title;
end;
$$;

revoke all on function public.register_email_guest_list(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.register_email_guest_list(uuid, uuid, text, jsonb) to service_role;
