-- Route meaningful Marlon execution milestones through the existing signed Discord outbox.
create or replace function public.enqueue_marlon_execution_milestone()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ticket public.support_tickets%rowtype;
  stage text;
  run_key text;
begin
  if new.actor <> 'marlon' then return new; end if;

  stage := case new.event_type
    when 'execution_claimed' then 'started'
    when 'execution_patching' then 'diagnosed'
    when 'execution_testing' then 'testing'
    when 'execution_blocked' then 'blocked'
    when 'owner_approval_requested' then 'blocked'
    when 'execution_completed' then 'completed'
    when 'execution_failed' then 'failed'
    when 'agent_started' then 'started'
    when 'agent_completed' then 'completed'
    when 'agent_failed' then 'failed'
    else null
  end;

  if stage is null then return new; end if;

  select * into ticket
  from public.support_tickets
  where id = new.ticket_id;
  if not found then return new; end if;

  run_key := coalesce(
    nullif(ticket.context->>'execution_run_id',''),
    new.id::text
  );

  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  )
  values(
    ticket.location_id,
    'support-ticket:'||ticket.id::text||':progress:'||run_key||':'||stage,
    'support_ticket_progress',
    'support_ticket',
    ticket.id,
    jsonb_build_object(
      'ticket_number',ticket.ticket_number,
      'title',ticket.title,
      'description',left(new.message,1200),
      'category',ticket.category,
      'priority',ticket.priority,
      'status',ticket.status,
      'surface',ticket.surface,
      'managed_by',coalesce(ticket.managed_by,'Marlon'),
      'requires_approval',coalesce(ticket.requires_approval,false),
      'approval_status',ticket.approval_status,
      'diagnosis',ticket.diagnosis,
      'action_taken',ticket.action_taken,
      'resolution',ticket.resolution,
      'portal_hash','#support-tickets',
      'execution_stage',stage,
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

revoke all on function public.enqueue_marlon_execution_milestone()
  from public, anon, authenticated;

drop trigger if exists marlon_execution_milestone_outbox
  on public.support_ticket_events;

create trigger marlon_execution_milestone_outbox
after insert on public.support_ticket_events
for each row
execute function public.enqueue_marlon_execution_milestone();
