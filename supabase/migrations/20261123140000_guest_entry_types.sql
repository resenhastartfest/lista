alter table public.guest_list_entries
  drop constraint guest_list_entries_ticket_type_check;

alter table public.guest_list_entries
  add constraint guest_list_entries_ticket_type_check
  check (ticket_type in ('standard', 'vip', 'man', 'woman', 'couple'));

create or replace function public.create_guest_list_submission(
  p_event_id uuid,
  p_request_id uuid,
  p_consent_version text,
  p_guests jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  submission_id uuid;
  existing_event_id uuid;
  guest jsonb;
  guest_name text;
  ticket_type text;
begin
  if jsonb_typeof(p_guests) is distinct from 'array' then
    raise exception 'Guest list must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_guests) not between 1 and 10 then
    raise exception 'Guest list must contain between 1 and 10 people' using errcode = '22023';
  end if;
  if p_consent_version is null or p_consent_version !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Valid consent is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.events
    where id = p_event_id
      and status = 'published'
      and starts_at > now()
  ) then
    raise exception 'Event is not accepting guest lists' using errcode = '22023';
  end if;

  insert into public.guest_list_submissions (request_id, event_id, consent_version)
  values (p_request_id, p_event_id, p_consent_version)
  on conflict (request_id) do nothing
  returning id into submission_id;

  if submission_id is null then
    select id, event_id
      into submission_id, existing_event_id
      from public.guest_list_submissions
      where request_id = p_request_id;
    if existing_event_id is distinct from p_event_id then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    return submission_id;
  end if;

  for guest in select value from jsonb_array_elements(p_guests) as guest_rows(value)
  loop
    guest_name := btrim(guest ->> 'name');
    ticket_type := guest ->> 'ticketType';
    if guest_name is null
      or char_length(guest_name) not between 2 and 80
      or guest_name ~ '[[:cntrl:]]'
      or ticket_type is null
      or ticket_type not in ('standard', 'vip', 'man', 'woman', 'couple') then
      raise exception 'Guest details are invalid' using errcode = '22023';
    end if;

    insert into public.guest_list_entries (submission_id, guest_name, ticket_type)
    values (submission_id, guest_name, ticket_type);
  end loop;

  return submission_id;
end;
$$;
