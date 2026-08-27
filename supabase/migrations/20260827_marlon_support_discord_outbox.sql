create or replace function public.enqueue_discord_support_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_event_key text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'support_ticket_created';
    v_event_key := 'support-ticket:' || new.id::text || ':created';
  else
    if new.status is not distinct from old.status
       and new.approval_status is not distinct from old.approval_status
       and new.action_taken is not distinct from old.action_taken
       and new.resolution is not distinct from old.resolution then
      return new;
    end if;
    v_event_type := 'support_ticket_updated';
    v_event_key := 'support-ticket:' || new.id::text || ':updated:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  end if;

  insert into public.discord_notification_outbox(
    location_id,event_key,event_type,entity_type,entity_id,payload
  ) values (
    new.location_id,
    v_event_key,
    v_event_type,
    'support_ticket',
    new.id,
    jsonb_build_object(
      'ticket_number', new.ticket_number,
      'title', new.title,
      'description', new.description,
      'category', new.category,
      'priority', new.priority,
      'status', new.status,
      'surface', new.surface,
      'managed_by', coalesce(new.managed_by,'Marlon'),
      'requires_approval', coalesce(new.requires_approval,false),
      'approval_status', new.approval_status,
      'action_taken', new.action_taken,
      'resolution', new.resolution,
      'portal_hash', '#support-tickets'
    )
  ) on conflict (event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists discord_support_ticket_outbox on public.support_tickets;
create trigger discord_support_ticket_outbox
after insert or update of status, approval_status, action_taken, resolution
on public.support_tickets
for each row execute function public.enqueue_discord_support_ticket_event();

alter table public.discord_notification_outbox
  drop constraint if exists discord_notification_outbox_entity_type_check;

alter table public.discord_notification_outbox
  add constraint discord_notification_outbox_entity_type_check
  check (entity_type = any (array['lead'::text,'work_order'::text,'purchase_order'::text,'support_ticket'::text]));

create or replace function public.dispatch_discord_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  signing_secret text;
  ts bigint;
  signature text;
begin
  if new.entity_type not in ('work_order','support_ticket') then
    return new;
  end if;
  select secret into signing_secret
  from public.internal_runtime_secrets
  where key='discord_outbox_signing';
  if signing_secret is null then return new; end if;
  ts := floor(extract(epoch from clock_timestamp()))::bigint;
  signature := encode(
    extensions.hmac(
      convert_to(new.id::text || ':' || ts::text,'UTF8'),
      convert_to(signing_secret,'UTF8'),
      'sha256'
    ),
    'hex'
  );
  perform net.http_post(
    url := 'https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/discord-outbox-delivery',
    headers := jsonb_build_object('Content-Type','application/json','x-gc-signature',signature),
    body := jsonb_build_object('outbox_id',new.id,'ts',ts),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;
