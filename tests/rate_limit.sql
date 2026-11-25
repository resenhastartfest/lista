-- Run inside a transaction and roll it back after testing.
do $$
declare
  test_key text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  attempt integer;
begin
  for attempt in 1..20 loop
    if not public.consume_guest_list_rate_limit(test_key) then
      raise exception 'attempt % was blocked before the limit', attempt;
    end if;
  end loop;

  if public.consume_guest_list_rate_limit(test_key) then
    raise exception 'attempt above the limit was accepted';
  end if;

  update public.guest_list_rate_limits
    set window_started_at = now() - interval '10 minutes'
    where rate_key = test_key;
  if not public.consume_guest_list_rate_limit(test_key) then
    raise exception 'expired rate-limit window was not reset';
  end if;
  if (select request_count from public.guest_list_rate_limits where rate_key = test_key) <> 1 then
    raise exception 'expired rate-limit window was not reset';
  end if;

  if has_function_privilege('anon', 'public.consume_guest_list_rate_limit(text)', 'execute')
    or not has_function_privilege('service_role', 'public.consume_guest_list_rate_limit(text)', 'execute') then
    raise exception 'unsafe rate-limit RPC permissions';
  end if;
end $$;
