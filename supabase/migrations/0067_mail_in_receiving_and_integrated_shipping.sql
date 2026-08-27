-- Mail-in receiving + integrated shipping foundation.
-- Shipping labels may only be purchased from an explicit staff action in the
-- shipping provider Edge Function; there is no automatic label purchasing.

alter table public.business_settings
  add column if not exists shipping_provider text not null default 'easypost',
  add column if not exists shipping_provider_secret_id uuid,
  add column if not exists shipping_provider_mode text not null default 'test',
  add column if not exists shipping_default_parcel jsonb not null default '{"length":10,"width":8,"height":4,"weight_oz":32}'::jsonb,
  add column if not exists shipping_require_label_confirmation boolean not null default true;

alter table public.business_settings drop constraint if exists business_settings_shipping_provider_check;
alter table public.business_settings add constraint business_settings_shipping_provider_check
  check (shipping_provider in ('easypost'));
alter table public.business_settings drop constraint if exists business_settings_shipping_provider_mode_check;
alter table public.business_settings add constraint business_settings_shipping_provider_mode_check
  check (shipping_provider_mode in ('test','production'));

create table if not exists public.shipping_shipments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  repair_ticket_id uuid references public.repair_tickets(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  provider text not null default 'easypost',
  provider_shipment_id text,
  provider_rate_id text,
  carrier text,
  service text,
  tracking_code text,
  tracking_code_normalized text,
  label_url text,
  label_pdf_url text,
  label_format text,
  postage_cents integer not null default 0 check (postage_cents>=0),
  insurance_cents integer not null default 0 check (insurance_cents>=0),
  status text not null default 'draft' check (status in ('draft','rated','label_purchased','in_transit','delivered','received','voided','error')),
  from_address jsonb not null default '{}'::jsonb,
  to_address jsonb not null default '{}'::jsonb,
  parcel jsonb not null default '{}'::jsonb,
  rates jsonb not null default '[]'::jsonb,
  error_message text,
  purchased_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (repair_ticket_id is not null or lead_id is not null)
);

create index if not exists shipping_shipments_location_status_idx on public.shipping_shipments(location_id,status,created_at desc);
create index if not exists shipping_shipments_ticket_idx on public.shipping_shipments(repair_ticket_id,created_at desc) where repair_ticket_id is not null;
create index if not exists shipping_shipments_lead_idx on public.shipping_shipments(lead_id,created_at desc) where lead_id is not null;
create index if not exists shipping_shipments_tracking_idx on public.shipping_shipments(tracking_code_normalized) where tracking_code_normalized is not null;
create unique index if not exists shipping_shipments_provider_id_uq on public.shipping_shipments(provider,provider_shipment_id) where provider_shipment_id is not null;

alter table public.shipping_shipments enable row level security;

drop policy if exists shipping_shipments_staff_select on public.shipping_shipments;
create policy shipping_shipments_staff_select on public.shipping_shipments
for select to authenticated
using (
  location_id=public.current_location_id()
  and (
    coalesce(public.has_permission('repairs.view'),false)
    or coalesce(public.has_permission('repairs.intake'),false)
    or coalesce(public.has_permission('repairs.workflow'),false)
  )
);

drop policy if exists shipping_shipments_manager_write on public.shipping_shipments;
create policy shipping_shipments_manager_write on public.shipping_shipments
for all to authenticated
using (
  location_id=public.current_location_id()
  and (
    coalesce(public.has_permission('repairs.workflow'),false)
    or coalesce(public.has_permission('repairs.intake'),false)
  )
)
with check (
  location_id=public.current_location_id()
  and (
    coalesce(public.has_permission('repairs.workflow'),false)
    or coalesce(public.has_permission('repairs.intake'),false)
  )
);

grant select,insert,update on public.shipping_shipments to authenticated;

create or replace function public.normalize_shipping_scan(p_value text)
returns text
language sql
immutable
as $$ select upper(regexp_replace(coalesce(trim(p_value),''),'[^A-Za-z0-9]','','g')) $$;

grant execute on function public.normalize_shipping_scan(text) to authenticated,service_role;

create or replace function public.receive_mail_in_by_scan(p_scan text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  scan_norm text:=public.normalize_shipping_scan(p_scan);
  shipment public.shipping_shipments;
  lead_row public.leads;
  ticket public.repair_tickets;
  customer public.customers;
  device public.devices;
  names text[];
  first_name text;
  last_name text;
  phone_norm text;
  made_ticket boolean:=false;
begin
  if not (
    coalesce(public.has_permission('repairs.intake'),false)
    or coalesce(public.has_permission('repairs.workflow'),false)
  ) then raise exception 'Repair intake or workflow permission required.'; end if;
  if length(scan_norm)<6 then raise exception 'Scan a valid carrier tracking barcode or GotCracked ticket code.'; end if;

  select * into shipment
  from public.shipping_shipments
  where location_id=public.current_location_id()
    and direction='inbound'
    and tracking_code_normalized=scan_norm
    and status not in ('voided')
  order by created_at desc
  limit 1
  for update;

  if shipment.repair_ticket_id is not null then
    select * into ticket from public.repair_tickets where id=shipment.repair_ticket_id for update;
  end if;

  if ticket.id is null then
    select * into ticket
    from public.repair_tickets
    where location_id=public.current_location_id()
      and intake_method='mail_in'
      and public.normalize_shipping_scan(inbound_tracking)=scan_norm
    order by created_at desc
    limit 1
    for update;
  end if;

  -- Also allow a GotCracked ticket barcode as a staff fallback.
  if ticket.id is null and scan_norm ~ '^GC[0-9]+$' then
    select * into ticket
    from public.repair_tickets
    where location_id=public.current_location_id()
      and ticket_number=(regexp_replace(scan_norm,'[^0-9]','','g'))::bigint
    limit 1 for update;
  end if;

  if ticket.id is null and shipment.lead_id is not null then
    select * into lead_row from public.leads where id=shipment.lead_id for update;
    if lead_row.converted_ticket_id is not null then
      select * into ticket from public.repair_tickets where id=lead_row.converted_ticket_id for update;
    end if;
  end if;

  if ticket.id is null and lead_row.id is not null then
    if lead_row.customer_id is not null then select * into customer from public.customers where id=lead_row.customer_id; end if;
    phone_norm:=regexp_replace(coalesce(lead_row.phone,''),'[^0-9]','','g');
    if customer.id is null and phone_norm<>'' then
      select * into customer from public.customers
      where location_id=lead_row.location_id and phone_normalized=phone_norm limit 1;
    end if;
    if customer.id is null and nullif(trim(lead_row.email),'') is not null then
      select * into customer from public.customers
      where location_id=lead_row.location_id and lower(email)=lower(lead_row.email) limit 1;
    end if;
    if customer.id is null then
      names:=regexp_split_to_array(trim(coalesce(lead_row.name,'Customer')),'\s+');
      first_name:=case when array_length(names,1)>1 then array_to_string(names[1:array_length(names,1)-1],' ') else coalesce(names[1],'Customer') end;
      last_name:=case when array_length(names,1)>1 then names[array_length(names,1)] else 'Customer' end;
      insert into public.customers(location_id,first_name,last_name,phone,contact_phone,phone_normalized,email)
      values(lead_row.location_id,coalesce(nullif(first_name,''),'Customer'),coalesce(nullif(last_name,''),'Customer'),coalesce(lead_row.phone,''),coalesce(lead_row.phone,''),nullif(phone_norm,''),nullif(lower(trim(lead_row.email)),'') )
      returning * into customer;
    end if;

    if lead_row.device_id is not null then select * into device from public.devices where id=lead_row.device_id; end if;
    if device.id is null then
      select * into device from public.devices
      where customer_id=customer.id
        and lower(coalesce(manufacturer,''))=lower(coalesce(lead_row.manufacturer,''))
        and lower(model)=lower(coalesce(lead_row.model,lead_row.device_model,'Unspecified device'))
      limit 1;
    end if;
    if device.id is null then
      insert into public.devices(customer_id,category,manufacturer,model,last_seen_at)
      values(customer.id,coalesce(nullif(lead_row.device_category,''),nullif(lead_row.device_type,''),'Other'),nullif(lead_row.manufacturer,''),coalesce(nullif(lead_row.model,''),nullif(lead_row.device_model,''),'Unspecified device'),now())
      returning * into device;
    end if;

    insert into public.repair_tickets(
      location_id,customer_id,device_id,status,customer_issue,lead_id,intake_method,
      shipping_status,shipping_address,inbound_carrier,inbound_tracking,arrived_at
    ) values(
      lead_row.location_id,customer.id,device.id,'awaiting_repair',
      coalesce(nullif(lead_row.customer_issue,''),nullif(lead_row.service,''),'Mail-in repair'),lead_row.id,'mail_in',
      'received',lead_row.shipping_address,shipment.carrier,shipment.tracking_code,now()
    ) returning * into ticket;
    made_ticket:=true;

    update public.leads
    set pipeline_status='converted',status='won',customer_id=customer.id,device_id=device.id,
        converted_ticket_id=ticket.id,updated_at=now()
    where id=lead_row.id;
  end if;

  if ticket.id is null then
    return jsonb_build_object('ok',false,'reason','not_found','message','No expected mail-in repair matches that shipping label.');
  end if;

  update public.repair_tickets
  set shipping_status='received',
      inbound_carrier=coalesce(inbound_carrier,shipment.carrier),
      inbound_tracking=coalesce(inbound_tracking,shipment.tracking_code,p_scan),
      arrived_at=coalesce(arrived_at,now()),
      status=case when status in ('awaiting_customer','checked_in') then 'awaiting_repair'::public.ticket_status else status end,
      updated_at=now()
  where id=ticket.id
  returning * into ticket;

  if shipment.id is not null then
    update public.shipping_shipments
    set repair_ticket_id=ticket.id,status='received',received_at=coalesce(received_at,now()),updated_at=now()
    where id=shipment.id;
  end if;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(ticket.id,auth.uid(),'mail_in_received_scan',
    'Mail-in package received by scanning the carrier shipping label. Device entered the repair queue.','internal');

  return jsonb_build_object(
    'ok',true,'ticket_id',ticket.id,'ticket_number',ticket.ticket_number,
    'created_from_lead',made_ticket,'shipping_status',ticket.shipping_status,'repair_status',ticket.status
  );
end;
$function$;

grant execute on function public.receive_mail_in_by_scan(text) to authenticated,service_role;
