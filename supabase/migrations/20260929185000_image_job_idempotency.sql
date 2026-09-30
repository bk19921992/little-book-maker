-- Idempotent starts are a single transaction. A lost HTTP response can be
-- retried with the same client UUID without a second usage row or job.
alter table public.image_jobs add column if not exists client_request_id uuid;
create unique index if not exists image_jobs_user_request_idx
  on public.image_jobs (user_id, client_request_id)
  where client_request_id is not null;

create or replace function public.start_image_job_once(
  p_user_id uuid, p_request_id uuid, p_request jsonb,
  p_reference_url text, p_items jsonb, p_units integer, p_limit integer
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  existing record;
  new_job_id uuid;
  used_units integer;
begin
  if current_user <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or p_request_id is null or p_request is null or
     jsonb_typeof(p_items) is distinct from 'array' or
     jsonb_array_length(p_items) <> p_units or p_units < 1 or p_units > 21 then
    raise exception 'Invalid illustration job request';
  end if;
  -- Serialise this user's starts, including two racing retries of the same
  -- request. The lock lives until the transaction commits or rolls back.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select id, request into existing
    from public.image_jobs where user_id = p_user_id and client_request_id = p_request_id;
  -- Keep request IDs permanently in the job table unless a separate
  -- retention scheme leaves a durable tombstone. Otherwise late retries
  -- could create a second charged job.
  if found then
    if existing.request is distinct from p_request then
      raise exception 'Illustration request ID was reused for different content';
    end if;
    return jsonb_build_object('jobId', existing.id, 'replayed', true);
  end if;

  select coalesce(sum(units), 0) into used_units from public.generation_usage
    where user_id = p_user_id and kind = 'image'
      and created_at >= now() - interval '24 hours';
  if p_limit is null or p_limit < 0 then
    raise exception 'Invalid illustration limit';
  end if;
  if used_units + p_units > p_limit then
    return jsonb_build_object('limitReached', true);
  end if;

  insert into public.image_jobs(user_id, client_request_id, request, reference_url)
    values (p_user_id, p_request_id, p_request, p_reference_url)
    returning id into new_job_id;
  insert into public.image_job_items(job_id, item_key, seq, page, prompt,
    status, attempts, last_issues, lease_until, image_url, review, error)
    select new_job_id, item_key, seq, page, prompt, status, attempts,
      last_issues, lease_until, image_url, review, error
    from jsonb_to_recordset(p_items) as i(item_key text, seq integer,
      page integer, prompt jsonb, status text, attempts integer,
      last_issues jsonb, lease_until timestamptz, image_url text,
      review jsonb, error text);
  insert into public.generation_usage(user_id, kind, units)
    values (p_user_id, 'image', p_units);
  return jsonb_build_object('jobId', new_job_id, 'replayed', false);
end;
$$;
revoke all on function public.start_image_job_once(uuid,uuid,jsonb,text,jsonb,integer,integer) from public, anon, authenticated;
grant execute on function public.start_image_job_once(uuid,uuid,jsonb,text,jsonb,integer,integer) to service_role;
