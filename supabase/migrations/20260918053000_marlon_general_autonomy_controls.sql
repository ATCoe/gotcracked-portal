-- General-purpose Portal execution controls. These controls widen investigation
-- routing without widening protected-system authority.

alter table public.marlon_execution_runs
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_retry_at timestamptz;

create unique index if not exists support_tickets_marlon_suggestion_surface_unique
on public.support_tickets (
  (context->>'suggestion_id'),
  surface
)
where managed_by='Marlon'
  and coalesce(context->>'marlon_autonomous_improvement','false')='true'
  and nullif(context->>'suggestion_id','') is not null
  and status not in ('resolved','closed');

create or replace function public.marlon_execution_recover_stale(
  p_timeout interval default interval '25 minutes'
)
returns integer
language plpgsql
security definer
set search_path=public
as $function$
declare recovered integer;
begin
  with stale_candidates as (
    select
      er.id,
      er.ticket_id,
      least(2, greatest(0,
        case
          when (coalesce(st.context,'{}'::jsonb)->>'execution_retry_count') ~ '^[0-9]+$'
            then (st.context->>'execution_retry_count')::integer
          else 0
        end
      )) as prior_retry_count
    from public.marlon_execution_runs er
    join public.support_tickets st on st.id=er.ticket_id
    where er.status in ('claimed','diagnosing','patching','testing','deploying','verifying')
      and er.heartbeat_at < now()-p_timeout
    for update of er skip locked
  ),
  stale as (
    update public.marlon_execution_runs er
    set status='failed',
        finished_at=now(),
        heartbeat_at=now(),
        error='Execution worker heartbeat expired; run recovered for a bounded retry.',
        retry_count=sc.prior_retry_count+1,
        next_attempt_at=case sc.prior_retry_count
          when 0 then now()+interval '5 minutes'
          when 1 then now()+interval '10 minutes'
          else null
        end,
        last_retry_at=now(),
        metadata=coalesce(er.metadata,'{}'::jsonb)||jsonb_build_object(
          'stale_recovered',true,
          'stale_recovered_at',now(),
          'retry_budget_source','ticket',
          'retry_scheduled',sc.prior_retry_count < 2
        )
    from stale_candidates sc
    where er.id=sc.id
    returning er.ticket_id,er.retry_count,er.next_attempt_at
  )
  update public.support_tickets st
  set status='waiting',
      context=coalesce(st.context,'{}'::jsonb)||jsonb_build_object(
        'execution_stale_recovered',true,
        'execution_retry_count',stale.retry_count,
        'execution_next_attempt_at',stale.next_attempt_at,
        'execution_retry_exhausted',stale.next_attempt_at is null
      ),
      updated_at=now()
  from stale
  where st.id=stale.ticket_id;

  get diagnostics recovered = row_count;
  return recovered;
end;
$function$;

revoke all on function public.marlon_execution_recover_stale(interval)
  from public,anon,authenticated;
grant execute on function public.marlon_execution_recover_stale(interval)
  to service_role;

create or replace function public.marlon_execution_release_due_retries()
returns integer
language plpgsql
security definer
set search_path=public
as $function$
declare released integer;
begin
  update public.support_tickets
  set status='open',
      context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
        'execution_retry_released_at',now(),
        'execution_next_attempt_at',null
      ),
      updated_at=now()
  where managed_by='Marlon'
    and status='waiting'
    and (context->>'execution_next_attempt_at')::timestamptz <= now()
    and coalesce((context->>'execution_retry_count')::integer,0) between 1 and 2
    and coalesce((context->>'execution_retry_exhausted')::boolean,false)=false;
  get diagnostics released = row_count;
  return released;
end;
$function$;

revoke all on function public.marlon_execution_release_due_retries()
  from public,anon,authenticated;
grant execute on function public.marlon_execution_release_due_retries()
  to service_role;

-- A transaction-scoped advisory lock makes the database the final single-worker
-- authority, even if two repository workflows wake at the same time.
create or replace function public.marlon_execution_admit_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $function$
begin
  if new.status in ('claimed','diagnosing','patching','testing','deploying','verifying') then
    perform pg_advisory_xact_lock(hashtext('gotcracked-marlon-single-active-worker'));
    if exists (
      select 1 from public.marlon_execution_runs
      where status in ('claimed','diagnosing','patching','testing','deploying','verifying')
        and id is distinct from new.id
    ) then
      raise exception 'Marlon worker capacity is occupied; retry with bounded backoff.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists marlon_execution_single_worker_guard
  on public.marlon_execution_runs;
create trigger marlon_execution_single_worker_guard
before insert or update of status
on public.marlon_execution_runs
for each row execute function public.marlon_execution_admit_run();

revoke all on function public.marlon_execution_admit_run()
  from public,anon,authenticated;
