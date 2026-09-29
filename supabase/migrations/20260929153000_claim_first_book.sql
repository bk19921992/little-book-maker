-- One atomic free-book claim per account. The service role alone may invoke
-- this function. Paid export entitlements for a particular story are reusable.
create or replace function public.claim_book(p_user_id uuid, p_story_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if p_story_id is null or length(p_story_id) < 1 or length(p_story_id) > 100 then
    raise exception 'Invalid story id';
  end if;
  -- Serialize concurrent first-book starts from the same account, including
  -- separate browser tabs. The lock is transaction-scoped.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 651923));
  if exists (select 1 from public.entitlements where user_id = p_user_id and story_id = p_story_id and item = 'export') then
    return true;
  end if;
  if exists (select 1 from public.entitlements where user_id = p_user_id and item = 'export') then
    return false;
  end if;
  insert into public.entitlements (user_id, story_id, item, payment_intent_id)
  values (p_user_id, p_story_id, 'export', 'free-' || p_user_id::text);
  return true;
end;
$$;
revoke all on function public.claim_book(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_book(uuid, text) to service_role;
