-- GotCracked Portal 1.0 Discord event outbox.
-- Production-only Supabase writes enqueue rich operational payloads for the
-- existing staff bot/notification service. Training Store is browser-local and
-- never reaches this table.

create table if not exists public.discord_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  entity_type text not null check (entity_type in ('lead','work_order','purchase_order')),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists discord_outbox_pending_idx
  on public.discord_notification_outbox(delivered_at, created_at)
  where delivered_at is null;

alter table public.discord_notification_outbox enable row level security;

create policy "management can view discord notification outbox"
  on public.discord_notification_outbox for select to authenticated
  using (location_id = public.current_location_id() and public.has_permission('staff.manage'));

create or replace function public.enqueue_discord_lead_event()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  stage text;
  prior_stage text;
  event_name text;
  key_text text;
begin
  stage := coalesce(new.pipeline_status,
    case when new.status='won' then 'converted'
         when new.status='lost' then 'lost'
         when new.status in ('claimed','qualified') then 'awaiting_customer'
         else 'need_to_contact' end);

  prior_stage := case when tg_op='UPDATE' then coalesce(old.pipeline_status, old.status) else null end;

  if tg_op='INSERT' then
    event_name := 'lead_created';
  elsif stage is distinct from prior_stage then
    event_name := 'lead_status_changed';
  elsif new.contact_attempted_at is distinct from old.contact_attempted_at then
    event_name := 'lead_contact_attempt';
  else
    return new;
  end if;

  key_text := 'lead:' || new.id::text || ':' || event_name || ':' || extract(epoch from clock_timestamp())::bigint::text;

  insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
  values(
    new.location_id,
    key_text,
    event_name,
    'lead',
    new.id,
    jsonb_build_object(
      'lead_id', new.id,
      'name', new.name,
      'phone', new.phone,
      'email', new.email,
      'device_category', new.device_category,
      'manufacturer', new.manufacturer,
      'model', new.model,
      'issue', coalesce(new.customer_issue,new.service,new.notes),
      'source', new.source,
      'intake_method', new.intake_method,
      'pipeline_status', stage,
      'previous_status', prior_stage,
      'contact_attempted_at', new.contact_attempted_at,
      'last_contact_note', new.last_contact_note,
      'assigned_user_id', new.assigned_user_id,
      'converted_ticket_id', new.converted_ticket_id,
      'portal_hash', '#leads/' || new.id::text
    )
  ) on conflict(event_key) do nothing;

  return new;
end; $$;

create or replace function public.enqueue_discord_work_order_event()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  customer public.customers;
  device public.devices;
  event_name text;
  key_text text;
begin
  if tg_op='INSERT' then
    event_name := 'work_order_created';
  elsif new.status is distinct from old.status then
    event_name := 'work_order_status_changed';
  else
    return new;
  end if;

  select * into customer from public.customers where id = new.customer_id;
  select * into device from public.devices where id = new.device_id;

  key_text := 'work-order:' || new.id::text || ':' || event_name || ':' || extract(epoch from clock_timestamp())::bigint::text;

  insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
  values(
    new.location_id,
    key_text,
    event_name,
    'work_order',
    new.id,
    jsonb_build_object(
      'ticket_id', new.id,
      'ticket_number', new.ticket_number,
      'customer_name', trim(coalesce(customer.first_name,'') || ' ' || coalesce(customer.last_name,'')),
      'phone', customer.phone,
      'contact_phone', customer.contact_phone,
      'email', customer.email,
      'device_category', device.category,
      'manufacturer', device.manufacturer,
      'model', device.model,
      'model_number', device.model_number,
      'serial_number', device.serial_number,
      'issue', new.customer_issue,
      'intake_summary', new.intake_summary,
      'status', new.status,
      'previous_status', case when tg_op='UPDATE' then old.status else null end,
      'assigned_user_id', new.assigned_user_id,
      'lead_id', new.lead_id,
      'portal_hash', '#work-order/' || new.id::text
    )
  ) on conflict(event_key) do nothing;

  return new;
end; $$;

drop trigger if exists discord_lead_outbox on public.leads;
create trigger discord_lead_outbox
  after insert or update on public.leads
  for each row execute function public.enqueue_discord_lead_event();

drop trigger if exists discord_work_order_outbox on public.repair_tickets;
create trigger discord_work_order_outbox
  after insert or update on public.repair_tickets
  for each row execute function public.enqueue_discord_work_order_event();

-- Bot/service-role workers can mark delivery without granting ordinary staff
-- mutation rights. Service-role clients bypass RLS in Supabase.
