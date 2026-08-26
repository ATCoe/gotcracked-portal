-- GotCracked Portal: store hours/web presence settings and exact Discord deep links.

alter table public.business_settings
  add column if not exists store_timezone text not null default 'America/New_York',
  add column if not exists website_url text,
  add column if not exists google_business_profile_url text,
  add column if not exists google_business_place_id text,
  add column if not exists google_search_console_property text,
  add column if not exists google_analytics_measurement_id text,
  add column if not exists google_analytics_property_id text;

comment on column public.business_settings.store_timezone is 'IANA timezone used to interpret store hours.';
comment on column public.business_settings.website_url is 'Public business website URL. Never store credentials here.';
comment on column public.business_settings.google_business_profile_url is 'Public Google Business Profile or Maps URL; no OAuth credentials.';
comment on column public.business_settings.google_business_place_id is 'Google Place ID used to identify the public business listing.';
comment on column public.business_settings.google_search_console_property is 'Search Console domain or URL-prefix property identifier.';
comment on column public.business_settings.google_analytics_measurement_id is 'GA4 web stream Measurement ID (G-...).';
comment on column public.business_settings.google_analytics_property_id is 'GA4 numeric property ID.';

create or replace function public.enqueue_discord_lead_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stage text;
  prior_stage text;
  event_name text;
  key_text text;
  base_url constant text := 'https://portal.gotcracked.co/';
begin
  stage := coalesce(new.pipeline_status, case when new.status::text='won' then 'converted' when new.status::text='lost' then 'lost' when new.status::text in ('claimed','qualified') then 'awaiting_customer' else 'need_to_contact' end);
  prior_stage := case when tg_op='UPDATE' then coalesce(old.pipeline_status,old.status::text) else null end;
  if tg_op='INSERT' then event_name := 'lead_created';
  elsif stage is distinct from prior_stage then event_name := 'lead_status_changed';
  elsif new.contact_attempted_at is distinct from old.contact_attempted_at then event_name := 'lead_contact_attempt';
  else return new;
  end if;
  key_text := 'lead:'||new.id::text||':'||event_name||':'||extract(epoch from clock_timestamp())::bigint::text;
  insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
  values(new.location_id,key_text,event_name,'lead',new.id,jsonb_build_object(
    'lead_id',new.id,'name',new.name,'phone',new.phone,'email',new.email,
    'device_category',new.device_category,'manufacturer',new.manufacturer,'model',new.model,
    'issue',coalesce(new.customer_issue,new.service,new.notes),'source',new.source,'intake_method',new.intake_method,
    'pipeline_status',stage,'previous_status',prior_stage,'contact_attempted_at',new.contact_attempted_at,
    'last_contact_note',new.last_contact_note,'assigned_user_id',new.assigned_user_id,
    'converted_ticket_id',new.converted_ticket_id,'appointment_id',new.appointment_id,
    'portal_hash','#leads/'||new.id::text,
    'portal_url',base_url||'#leads/'||new.id::text,
    'work_order_url',case when new.converted_ticket_id is not null then base_url||'#work-order/'||new.converted_ticket_id::text else null end,
    'appointment_url',case when new.appointment_id is not null then base_url||'#appointments/'||new.appointment_id::text else null end
  )) on conflict(event_key) do nothing;
  return new;
end
$$;

create or replace function public.enqueue_discord_work_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer public.customers;
  device public.devices;
  event_name text;
  key_text text;
  base_url constant text := 'https://portal.gotcracked.co/';
begin
  if tg_op='INSERT' then event_name := 'work_order_created';
  elsif new.status is distinct from old.status then event_name := 'work_order_status_changed';
  else return new;
  end if;
  select * into customer from public.customers where id=new.customer_id;
  select * into device from public.devices where id=new.device_id;
  key_text := 'work-order:'||new.id::text||':'||event_name||':'||extract(epoch from clock_timestamp())::bigint::text;
  insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
  values(new.location_id,key_text,event_name,'work_order',new.id,jsonb_build_object(
    'ticket_id',new.id,'ticket_number',new.ticket_number,
    'customer_name',trim(coalesce(customer.first_name,'')||' '||coalesce(customer.last_name,'')),
    'phone',customer.phone,'contact_phone',customer.contact_phone,'email',customer.email,
    'device_category',device.category,'manufacturer',device.manufacturer,'model',device.model,
    'model_number',device.model_number,'serial_number',device.serial_number,'issue',new.customer_issue,
    'intake_summary',new.intake_summary,'status',new.status,
    'previous_status',case when tg_op='UPDATE' then old.status else null end,
    'assigned_user_id',new.assigned_user_id,'lead_id',new.lead_id,
    'portal_hash','#work-order/'||new.id::text,
    'portal_url',base_url||'#work-order/'||new.id::text,
    'lead_url',case when new.lead_id is not null then base_url||'#leads/'||new.lead_id::text else null end
  )) on conflict(event_key) do nothing;
  return new;
end
$$;

create or replace function public.enqueue_discord_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
  key_text text;
  base_url constant text := 'https://portal.gotcracked.co/';
  linked_lead public.leads;
  linked_customer public.customers;
begin
  if tg_op='INSERT' then
    event_name := 'appointment_created';
  elsif new.status is distinct from old.status then
    event_name := 'appointment_status_changed';
  elsif new.starts_at is distinct from old.starts_at
     or new.preferred_date is distinct from old.preferred_date
     or new.preferred_time is distinct from old.preferred_time then
    event_name := 'appointment_rescheduled';
  else
    return new;
  end if;

  if new.lead_id is not null then select * into linked_lead from public.leads where id=new.lead_id; end if;
  if new.customer_id is not null then select * into linked_customer from public.customers where id=new.customer_id; end if;

  key_text := 'appointment:'||new.id::text||':'||event_name||':'||extract(epoch from clock_timestamp())::bigint::text;
  insert into public.discord_notification_outbox(location_id,event_key,event_type,entity_type,entity_id,payload)
  values(new.location_id,key_text,event_name,'appointment',new.id,jsonb_build_object(
    'appointment_id',new.id,'lead_id',new.lead_id,'customer_id',new.customer_id,
    'customer_name',coalesce(linked_lead.name,trim(coalesce(linked_customer.first_name,'')||' '||coalesce(linked_customer.last_name,''))),
    'phone',coalesce(linked_lead.phone,linked_customer.phone),'email',coalesce(linked_lead.email,linked_customer.email),
    'device_description',new.device_description,'service_requested',new.service_requested,
    'starts_at',new.starts_at,'preferred_date',new.preferred_date,'preferred_time',new.preferred_time,
    'service_mode',new.service_mode,'status',new.status,
    'previous_status',case when tg_op='UPDATE' then old.status else null end,
    'portal_hash','#appointments/'||new.id::text,
    'portal_url',base_url||'#appointments/'||new.id::text,
    'lead_url',case when new.lead_id is not null then base_url||'#leads/'||new.lead_id::text else null end
  )) on conflict(event_key) do nothing;
  return new;
end
$$;

revoke all on function public.enqueue_discord_lead_event() from public, anon, authenticated;
revoke all on function public.enqueue_discord_work_order_event() from public, anon, authenticated;
revoke all on function public.enqueue_discord_appointment_event() from public, anon, authenticated;

drop trigger if exists discord_appointment_outbox on public.appointments;
create trigger discord_appointment_outbox
after insert or update on public.appointments
for each row execute function public.enqueue_discord_appointment_event();

-- Avoid overlapping permissive SELECT policies on business_settings while retaining
-- location-scoped staff reads and settings.manage writes.
drop policy if exists "permissioned management can manage business settings" on public.business_settings;
drop policy if exists "permissioned management can insert business settings" on public.business_settings;
drop policy if exists "permissioned management can update business settings" on public.business_settings;
drop policy if exists "permissioned management can delete business settings" on public.business_settings;

create policy "permissioned management can insert business settings"
on public.business_settings
for insert
to authenticated
with check ((location_id = current_location_id()) and has_permission('settings.manage'::text));

create policy "permissioned management can update business settings"
on public.business_settings
for update
to authenticated
using ((location_id = current_location_id()) and has_permission('settings.manage'::text))
with check ((location_id = current_location_id()) and has_permission('settings.manage'::text));

create policy "permissioned management can delete business settings"
on public.business_settings
for delete
to authenticated
using ((location_id = current_location_id()) and has_permission('settings.manage'::text));