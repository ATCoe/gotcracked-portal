-- Marlon RPCs are internal. Remove the implicit PUBLIC/anon EXECUTE grant while
-- preserving the explicit authenticated/service_role grants defined per RPC.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname ilike '%marlon%'
  loop
    execute format('revoke all on function %s from public, anon',fn.signature);
  end loop;
end
$$;

create or replace function public.sync_marlon_executor_capability_truth()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  next_status text;
  next_reason text;
begin
  if new.status not in ('completed','blocked','failed') or new.status is not distinct from old.status then
    return new;
  end if;

  next_status:=case when new.status='completed' then 'active' else 'degraded' end;
  next_reason:=case
    when new.status='completed' then 'Latest repository-bound execution completed with a recorded verification receipt.'
    when new.status='blocked' then 'Latest repository-bound execution was blocked. Inspect the run receipt before promising execution.'
    else 'Latest repository-bound execution failed. Marlon must not claim implementation or deployment until a verified run succeeds.'
  end;

  update public.marlon_execution_capabilities
  set status=next_status,
      reason=next_reason,
      last_verified_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'latest_run_id',new.id,
        'latest_run_status',new.status,
        'latest_run_finished_at',new.finished_at,
        'latest_run_commit_sha',new.commit_sha
      )
  where location_id=new.location_id
    and capability in ('support_ticket_execution','github_patch_execution');
  return new;
end
$$;

revoke all on function public.sync_marlon_executor_capability_truth() from public, anon, authenticated;

drop trigger if exists sync_marlon_executor_capability_truth on public.marlon_execution_runs;
create trigger sync_marlon_executor_capability_truth
after update of status on public.marlon_execution_runs
for each row execute function public.sync_marlon_executor_capability_truth();

-- The latest production runs failed at inference, so do not retain a stale
-- "active" promise until a completed run proves recovery.
update public.marlon_execution_capabilities
set status='degraded',
    reason='Recent repository-bound execution failed at the AI planning layer. Awaiting a completed run with verification evidence.',
    last_verified_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('truth_status_source','marlon_execution_runs','receipt_required',true)
where capability in ('support_ticket_execution','github_patch_execution');
