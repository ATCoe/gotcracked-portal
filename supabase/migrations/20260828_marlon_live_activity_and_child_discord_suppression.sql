do $$
begin
  alter publication supabase_realtime add table public.marlon_execution_runs;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.support_tickets;
exception when duplicate_object then null;
end $$;

create or replace function public.enqueue_discord_support_ticket_event()
returns trigger
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_event_type text;
  v_event_key text;
begin
  -- Repository child tickets are internal execution details. The parent request
  -- owns the human-facing Discord lifecycle and the single Owner approval.
  if new.parent_ticket_id is not null
     or coalesce((new.context->>'approval_inherited_from_parent')::boolean,false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'support_ticket_created';
    v_event_key := 'support-ticket:' || new.id::text || ':created';
  else
    if new.status is not distinct from old.status
       and new.approval_status is not distinct from old.approval_status
       and new.action_taken is not distinct from old.action_taken
       and new.resolution is not distinct from old.resolution
       and new.diagnosis is not distinct from old.diagnosis then
      return new;
    end if;
    v_event_type := 'support_ticket_updated';
    v_event_key := 'support-ticket:' || new.id::text || ':updated:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  end if;

  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  ) values (
    new.location_id,v_event_key,v_event_type,'support_ticket',new.id,
    jsonb_build_object(
      'ticket_number',new.ticket_number,
      'title',new.title,
      'description',new.description,
      'category',new.category,
      'priority',new.priority,
      'status',new.status,
      'surface',new.surface,
      'managed_by',coalesce(new.managed_by,'Marlon'),
      'requires_approval',coalesce(new.requires_approval,false),
      'approval_status',new.approval_status,
      'diagnosis',new.diagnosis,
      'action_taken',new.action_taken,
      'resolution',new.resolution,
      'portal_hash','#support-tickets'
    )
  ) on conflict (event_key) do nothing;

  return new;
end;
$function$;
