-- Preserve every Marlon work-journal pulse in Discord even when the ticket already has an execution run id.
create or replace function public.enqueue_marlon_execution_milestone()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ticket public.support_tickets%rowtype;
  stage text;
  discord_stage text;
  run_key text;
begin
  if new.actor <> 'marlon' then return new; end if;

  stage := case new.event_type
    when 'execution_claimed' then 'started'
    when 'execution_diagnosing' then 'diagnosed'
    when 'execution_patching' then 'patching'
    when 'execution_testing' then 'testing'
    when 'execution_waiting_window' then 'waiting'
    when 'execution_deploying' then 'deploying'
    when 'execution_verifying' then 'verifying'
    when 'execution_blocked' then 'blocked'
    when 'owner_approval_requested' then 'blocked'
    when 'execution_completed' then 'completed'
    when 'execution_failed' then 'failed'
    when 'agent_started' then 'started'
    when 'agent_inspecting' then 'inspecting'
    when 'agent_browser_qa' then 'browser_qa'
    when 'agent_reasoning' then 'reasoning'
    when 'agent_working' then 'working'
    when 'agent_mobile_followup' then 'mobile_followup'
    when 'agent_completed' then 'completed'
    when 'agent_failed' then 'failed'
    else null
  end;

  if stage is null then return new; end if;

  discord_stage := case stage
    when 'started' then 'started'
    when 'inspecting' then 'diagnosed'
    when 'browser_qa' then 'testing'
    when 'reasoning' then 'diagnosed'
    when 'working' then 'diagnosed'
    when 'diagnosed' then 'diagnosed'
    when 'patching' then 'diagnosed'
    when 'testing' then 'testing'
    when 'waiting' then 'testing'
    when 'deploying' then 'testing'
    when 'verifying' then 'testing'
    when 'mobile_followup' then 'testing'
    when 'blocked' then 'blocked'
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    else 'diagnosed'
  end;

  select * into ticket
  from public.support_tickets
  where id = new.ticket_id;
  if not found then return new; end if;

  run_key := coalesce(nullif(ticket.context->>'execution_run_id',''),new.id::text);

  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  )
  values(
    ticket.location_id,
    'support-ticket:'||ticket.id::text||':progress:'||run_key||':'||stage||':'||new.id::text,
    'support_ticket_progress',
    'support_ticket',
    ticket.id,
    jsonb_build_object(
      'ticket_number',ticket.ticket_number,
      'title',ticket.title,
      'description',left(new.message,1200),
      'current_action',left(new.message,1200),
      'category',ticket.category,
      'priority',ticket.priority,
      'status',ticket.status,
      'surface',ticket.surface,
      'managed_by',coalesce(ticket.managed_by,'Marlon'),
      'requires_approval',coalesce(ticket.requires_approval,false),
      'approval_status',ticket.approval_status,
      'diagnosis',ticket.diagnosis,
      'action_taken',left(new.message,700),
      'resolution',ticket.resolution,
      'portal_hash','#support-tickets',
      'execution_stage',discord_stage,
      'journal_stage',stage,
      'execution_blocked',stage='blocked',
      'execution_failed',stage='failed',
      'notify_owner',true,
      'event_id',new.id,
      'source_event_type',new.event_type
    )
  )
  on conflict (event_key) do nothing;

  return new;
end;
$function$;
