create sequence if not exists public.receipt_number_seq start with 100001;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default ('GCR-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0')),
  location_id uuid not null references public.locations(id),
  ticket_id uuid not null unique references public.repair_tickets(id) on delete restrict,
  ticket_number bigint not null,
  business_date date not null,
  customer_id uuid references public.customers(id),
  customer_name text not null,
  customer_email text,
  device_description text,
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  payment_method text not null default 'external_pos',
  payment_reference text,
  line_items jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  printed_at timestamptz,
  last_delivery_status text,
  constraint receipts_money_nonnegative check (least(subtotal_cents,tax_cents,total_cents,amount_paid_cents) >= 0)
);

create index if not exists receipts_location_business_date_idx on public.receipts(location_id,business_date desc);
create index if not exists receipts_customer_idx on public.receipts(customer_id,created_at desc);

create table if not exists public.receipt_deliveries (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  delivery_method text not null check (delivery_method in ('email','print')),
  destination text,
  status text not null default 'completed',
  detail text,
  actor_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists receipt_deliveries_receipt_idx on public.receipt_deliveries(receipt_id,created_at desc);

alter table public.receipts enable row level security;
alter table public.receipt_deliveries enable row level security;

drop policy if exists receipts_staff_select on public.receipts;
create policy receipts_staff_select on public.receipts for select to authenticated
using (location_id = public.current_location_id() and (public.has_permission('repairs.view') or public.has_permission('ready_pickup.checkout') or public.has_permission('reports.view')));

drop policy if exists receipt_deliveries_staff_select on public.receipt_deliveries;
create policy receipt_deliveries_staff_select on public.receipt_deliveries for select to authenticated
using (exists(select 1 from public.receipts r where r.id=receipt_id and r.location_id=public.current_location_id()) and (public.has_permission('repairs.view') or public.has_permission('ready_pickup.checkout') or public.has_permission('reports.view')));

grant select on public.receipts to authenticated;
grant select on public.receipt_deliveries to authenticated;

create or replace function public.finalize_external_pos_sale(
  target_ticket uuid,
  pos_reference text default null,
  pos_tender text default 'external_pos',
  paid_amount_cents integer default null
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  loc uuid := public.current_location_id();
  t public.repair_tickets;
  c public.customers;
  d public.devices;
  r public.receipts;
  biz_date date;
  expected integer;
  paid integer;
  tender text := coalesce(nullif(trim(pos_tender),''),'external_pos');
  lines jsonb;
begin
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then
    raise exception 'Checkout permission required.';
  end if;

  select * into t from public.repair_tickets where id=target_ticket and location_id=loc for update;
  if not found then raise exception 'Work order not found.'; end if;

  if t.status::text not in ('repaired','ready_for_pickup') then
    raise exception 'Work order must be Ready for Pickup before Sale Complete.';
  end if;

  expected := greatest(coalesce(t.total_cents,0),0);
  paid := coalesce(paid_amount_cents,expected);
  if paid < 0 then raise exception 'Paid amount cannot be negative.'; end if;
  if tender not in ('warranty','no_charge') and paid <> expected then
    raise exception 'External POS amount must match the work-order total exactly.';
  end if;

  if exists(select 1 from public.receipts where ticket_id=t.id) then
    raise exception 'This work order already has a completed sale receipt.';
  end if;

  select * into c from public.customers where id=t.customer_id;
  select * into d from public.devices where id=t.device_id;
  biz_date := public.current_business_date(loc);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type',w.item_type,'sku',w.sku,'description',w.description,'quantity',w.quantity,
    'unit_price_cents',coalesce(w.unit_price_cents,0),'unit_cost_cents',coalesce(w.unit_cost_cents,0),
    'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,
    'part_pricing_mode',w.part_pricing_mode
  ) order by w.created_at),'[]'::jsonb) into lines
  from public.work_order_items w where w.ticket_id=t.id;

  update public.repair_tickets set
    payment_status='paid',
    amount_paid_cents=paid,
    payment_method=tender,
    payment_reference=nullif(trim(pos_reference),''),
    paid_at=now(),
    status='sale_complete',
    pickup_at=coalesce(pickup_at,now()),
    completed_at=coalesce(completed_at,now()),
    sale_completed_at=now(),
    sale_business_date=biz_date,
    updated_at=now()
  where id=t.id;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(t.id,auth.uid(),'sale_complete',
    'External POS sale confirmed' || case when nullif(trim(pos_reference),'') is not null then ' · POS ref '||trim(pos_reference) else '' end,
    'internal');

  insert into public.receipts(
    location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,
    subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by
  ) values(
    loc,t.id,t.ticket_number,biz_date,t.customer_id,
    trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),nullif(trim(c.email),''),
    nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),
    coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,paid,tender,nullif(trim(pos_reference),''),lines,auth.uid()
  ) returning * into r;

  return jsonb_build_object(
    'receipt_id',r.id,'receipt_number',r.receipt_number,'ticket_id',r.ticket_id,'ticket_number',r.ticket_number,
    'business_date',r.business_date,'customer_name',r.customer_name,'customer_email',r.customer_email,
    'device_description',r.device_description,'subtotal_cents',r.subtotal_cents,'tax_cents',r.tax_cents,
    'total_cents',r.total_cents,'amount_paid_cents',r.amount_paid_cents,'payment_method',r.payment_method,
    'payment_reference',r.payment_reference,'line_items',r.line_items,'created_at',r.created_at
  );
end;
$$;

grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;

create or replace function public.record_receipt_print(target_receipt uuid)
returns void language plpgsql security definer set search_path='public' as $$
declare loc uuid:=public.current_location_id(); begin
  if loc is null or not (public.has_permission('ready_pickup.checkout') or public.has_permission('repairs.view')) then raise exception 'Receipt access denied.'; end if;
  update public.receipts set printed_at=now(),last_delivery_status='printed' where id=target_receipt and location_id=loc;
  if not found then raise exception 'Receipt not found.'; end if;
  insert into public.receipt_deliveries(receipt_id,delivery_method,status,actor_user_id) values(target_receipt,'print','completed',auth.uid());
end; $$;
grant execute on function public.record_receipt_print(uuid) to authenticated;
