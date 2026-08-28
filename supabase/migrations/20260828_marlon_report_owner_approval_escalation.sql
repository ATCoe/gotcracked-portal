create or replace function public.report_marlon_execution(
  p_run_id uuid,
  p_status text,
  p_diagnosis text default null,
  p_patch_summary text default null,
  p_resolution text default null,
  p_commit_sha text default null,
  p_deployment_url text default null,
  p_verification jsonb default '{}'::jsonb,
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.marlon_execution_runs%rowtype;
  next_ticket_status text;
  owner_escalation boolean := coalesce((p_metadata->>'owner_approval_escalation')::boolean,false);
begin
  if p_status not in ('diagnosing','patching','testing','waiting_window','deploying','verifying','completed','blocked','failed') then raise exception 'Invalid execution status.'; end if;
  select * into r from public.marlon_execution_runs where id=p_run_id for update;
  if not found then raise exception 'Execution run not found.'; end if;
  if r.status in ('completed','blocked','failed') then raise exception 'Execution run is already final.'; end if;

  update public.marlon_execution_runs
  set status=p_status,heartbeat_at=now(),finished_at=case when p_status in ('completed','blocked','failed') then now() else finished_at end,      diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),patch_summary=coalesce(nullif(btrim(p_patch_summary),''),patch_summary),resolution=coalesce(nullif(btrim(p_resolution),''),resolution),
      commit_sha=coalesce(nullif(btrim(p_commit_sha),''),commit_sha),deployment_url=coalesce(nullif(btrim(p_deployment_url),''),deployment_url),verification=coalesce(verification,'{}'::jsonb)||coalesce(p_verification,'{}'::jsonb),
      error=coalesce(nullif(btrim(p_error),''),error),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)
  where id=p_run_id returning * into r;

  if p_status='completed' then
    next_ticket_status:='resolved';
    update public.support_tickets set status='resolved',diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),resolution=coalesce(nullif(btrim(p_resolution),''),'Implemented and verified by Marlon execution worker.'),resolved_at=now(),context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_commit_sha',r.commit_sha,'execution_deployment_url',r.deployment_url,'execution_verification',r.verification,'execution_finished_at',r.finished_at),updated_at=now() where id=r.ticket_id;
  elsif p_status='waiting_window' then
    select case when maintenance_override_state='pending' then 'waiting_approval' else 'waiting' end into next_ticket_status from public.support_tickets where id=r.ticket_id;
    update public.support_tickets set status=next_ticket_status,diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_stage','waiting_window','tested_commit_sha',r.commit_sha,'maintenance_deferred',true,'execution_metadata',coalesce(p_metadata,'{}'::jsonb)),updated_at=now() where id=r.ticket_id;
  elsif p_status='blocked' and owner_escalation then
    next_ticket_status:='waiting_approval';
    update public.support_tickets
    set change_level='high_level',requires_approval=true,approval_state='pending',approval_status='pending',approval_requested_at=now(),approval_decided_at=null,approval_decided_by=null,
        approval_fingerprint=public.marlon_scope_fingerprint(surface,title,description),approval_summary=coalesce(nullif(btrim(approval_summary),''),title),
        status='waiting_approval',priority=case when priority in ('low','normal') then 'high' else priority end,
        diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),
        context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_blocked',true,'execution_error',r.error,'execution_verification',r.verification,'execution_finished_at',r.finished_at,'execution_metadata',coalesce(p_metadata,'{}'::jsonb),'protected_execution_escalated',true,'protected_execution_reason',coalesce(r.error,'Protected execution requires explicit Owner approval.'),'protected_execution_escalated_at',now()),updated_at=now()
    where id=r.ticket_id;
  elsif p_status in ('blocked','failed') then
    next_ticket_status:='waiting';
    update public.support_tickets set status='waiting',diagnosis=coalesce(nullif(btrim(p_diagnosis),''),diagnosis),action_taken=coalesce(nullif(btrim(p_patch_summary),''),action_taken),context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_blocked',p_status='blocked','execution_failed',p_status='failed','execution_error',r.error,'execution_verification',r.verification,'execution_finished_at',r.finished_at,'execution_metadata',coalesce(p_metadata,'{}'::jsonb)),updated_at=now() where id=r.ticket_id;  else
    next_ticket_status:='in_progress';
    update public.support_tickets set status='in_progress',context=coalesce(context,'{}'::jsonb)||jsonb_build_object('execution_run_id',r.id,'execution_stage',p_status,'execution_heartbeat_at',r.heartbeat_at,'execution_metadata',coalesce(p_metadata,'{}'::jsonb)),updated_at=now() where id=r.ticket_id;
  end if;

  insert into public.support_ticket_events(ticket_id,actor,event_type,message)
  values(r.ticket_id,'marlon',case when p_status='blocked' and owner_escalation then 'owner_approval_requested' else 'execution_'||p_status end,
    case
      when p_status='completed' then 'Marlon completed implementation and recorded verification evidence.'
      when p_status='waiting_window' then 'Marlon finished testing and is waiting for the maintenance window or Owner Deploy Now approval.'
      when p_status='blocked' and owner_escalation then 'Marlon identified a protected change, stopped execution, and requested explicit Owner approval for the exact fingerprinted scope.'
      when p_status='blocked' then 'Marlon paused execution because a required capability or safe execution condition is unavailable.'
      when p_status='failed' then 'Marlon execution failed and the ticket was moved to Waiting for follow-up.'
      else 'Marlon execution advanced to '||p_status||'.'
    end);
  return jsonb_build_object('ok',true,'run',to_jsonb(r),'ticket_status',next_ticket_status,'owner_approval_escalation',owner_escalation);
end;
$$;
