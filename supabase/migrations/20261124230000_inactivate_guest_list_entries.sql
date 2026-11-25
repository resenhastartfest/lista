alter table public.guest_list_submissions
  add column is_active boolean not null default true;

alter table public.guest_list_entries
  add column is_active boolean not null default true;

update public.guest_list_submissions as submission
  set is_active = false
  where not exists (
    select 1 from public.guest_list_entries as entry where entry.submission_id = submission.id
  );

drop index public.guest_list_submissions_event_email_unique;
create unique index guest_list_submissions_event_email_unique
  on public.guest_list_submissions (event_id, lower(email))
  where email is not null and is_active;

revoke delete on public.guest_list_entries from authenticated;
drop policy "Admins can delete guest list entries" on public.guest_list_entries;

create function public.inactivate_guest_list_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_submission_id uuid;
begin
  if (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select submission_id into v_submission_id
    from public.guest_list_entries where id = p_entry_id;
  if not found then
    raise exception 'Guest not found' using errcode = '22023';
  end if;

  perform 1 from public.guest_list_submissions where id = v_submission_id for update;
  update public.guest_list_entries
    set is_active = false
    where id = p_entry_id and submission_id = v_submission_id and is_active;
  if not found then
    raise exception 'Guest is already inactive' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.guest_list_entries
      where submission_id = v_submission_id and is_active
  ) then
    update public.guest_list_submissions set is_active = false where id = v_submission_id;
  end if;
end;
$$;

revoke all on function public.inactivate_guest_list_entry(uuid) from public, anon, authenticated;
grant execute on function public.inactivate_guest_list_entry(uuid) to authenticated;

create or replace function public.register_email_guest_list(
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
  v_active boolean;
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
  select id, event_id, email, is_active into v_id, v_event_id, v_email, v_active
    from public.guest_list_submissions where request_id = p_request_id;
  if found then
    if v_event_id is distinct from p_event_id or v_email is distinct from p_email or not v_active then
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
    select id, event_id, email, is_active into v_id, v_event_id, v_email, v_active
      from public.guest_list_submissions where request_id = p_request_id;
    if v_event_id is distinct from p_event_id or v_email is distinct from p_email or not v_active then
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
