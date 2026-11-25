create or replace function public.consume_guest_list_rate_limit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate limit key' using errcode = '22023';
  end if;

  insert into public.guest_list_rate_limits as current_window (
    rate_key, window_started_at, request_count
  )
  values (p_key, now(), 1)
  on conflict (rate_key) do update
    set window_started_at = case
          when current_window.window_started_at <= now() - interval '10 minutes' then now()
          else current_window.window_started_at
        end,
        request_count = case
          when current_window.window_started_at <= now() - interval '10 minutes' then 1
          else current_window.request_count + 1
        end,
        updated_at = now()
  returning request_count into current_count;

  return current_count <= 20;
end;
$$;
