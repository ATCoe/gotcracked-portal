alter table public.business_settings
  add column if not exists target_gross_margin_percent numeric(5,2) not null default 50,
  add column if not exists auto_service_taxable boolean not null default true;

do $$ begin
  alter table public.business_settings add constraint business_settings_target_gm_check check (target_gross_margin_percent >= 0 and target_gross_margin_percent < 95);
exception when duplicate_object then null; end $$;

alter table public.inventory_items
  add column if not exists repair_guide_id uuid references public.repair_guides(id) on delete set null,
  add column if not exists estimated_repair_minutes integer;

do $$ begin
  alter table public.inventory_items add constraint inventory_estimated_repair_minutes_check check (estimated_repair_minutes is null or estimated_repair_minutes between 1 and 1440);
exception when duplicate_object then null; end $$;

alter table public.work_order_items
  add column if not exists pricing_parent_line_id uuid references public.work_order_items(id) on delete cascade,
  add column if not exists auto_pricing_line boolean not null default false,
  add column if not exists pricing_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists work_order_items_auto_pricing_parent_uidx
  on public.work_order_items(pricing_parent_line_id)
  where auto_pricing_line and pricing_parent_line_id is not null;

create or replace function public.calculate_part_repair_pricing(
  target_ticket uuid,
  target_inventory_item uuid,
  line_quantity numeric default 1
) returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  loc uuid;
  device_category text;
  part public.inventory_items;
  bs public.business_settings;
  guide_minutes integer;
  fallback_minutes numeric;
  minutes integer;
  qty numeric := greatest(coalesce(line_quantity,1),0.01);
  gm numeric;
  labor_cost_hourly_cents numeric;
  estimated_labor_cost_cents integer;
  part_cost_total_cents integer;
  direct_cost_cents integer;
  target_total_cents integer;
  part_revenue_cents integer;
  service_charge_cents integer;
begin
  select t.location_id,d.category into loc,device_category
  from public.repair_tickets t
  left join public.devices d on d.id=t.device_id
  where t.id=target_ticket;
  if loc is null then raise exception 'Work order not found.'; end if;

  select * into part from public.inventory_items
  where id=target_inventory_item and location_id=loc and active;
  if part.id is null then raise exception 'Inventory item is unavailable.'; end if;

  select * into bs from public.business_settings where location_id=loc;
  gm := greatest(0,least(94,coalesce(bs.target_gross_margin_percent,50)));

  if part.repair_guide_id is not null then
    select bench_time_minutes into guide_minutes
    from public.repair_guides
    where id=part.repair_guide_id and active;
  end if;

  if part.estimated_repair_minutes is not null then
    minutes := part.estimated_repair_minutes;
  elsif guide_minutes is not null then
    minutes := guide_minutes;
  else
    select percentile_cont(0.5) within group(order by bench_time_minutes)
      into fallback_minutes
    from public.repair_guides
    where active and bench_time_minutes is not null
      and (device_category is null or lower(device_category)=lower(coalesce(repair_guides.device_category,'')));
    minutes := coalesce(round(fallback_minutes)::integer,60);
  end if;

  labor_cost_hourly_cents := coalesce(bs.target_splh,125) * 100 * coalesce(bs.target_labor_percent,0.18);
  estimated_labor_cost_cents := round(labor_cost_hourly_cents * minutes / 60.0)::integer;
  part_cost_total_cents := round(coalesce(part.cost_cents,0) * qty)::integer;
  direct_cost_cents := greatest(0,part_cost_total_cents + estimated_labor_cost_cents);
  target_total_cents := case when gm >= 94 then direct_cost_cents else ceil(direct_cost_cents / greatest(0.06,1-(gm/100.0)))::integer end;

  part_revenue_cents := case when coalesce(bs.charge_parts_to_customer,false)
    then round(coalesce(part.sell_price_cents,0) * qty)::integer else 0 end;
  service_charge_cents := greatest(0,target_total_cents-part_revenue_cents);

  return jsonb_build_object(
    'charge_parts_to_customer',coalesce(bs.charge_parts_to_customer,false),
    'target_gross_margin_percent',gm,
    'estimated_repair_minutes',minutes,
    'labor_cost_hourly_cents',round(labor_cost_hourly_cents)::integer,
    'estimated_labor_cost_cents',estimated_labor_cost_cents,
    'part_cost_total_cents',part_cost_total_cents,
    'direct_cost_cents',direct_cost_cents,
    'inventory_sell_revenue_cents',part_revenue_cents,
    'target_repair_total_cents',target_total_cents,
    'service_charge_cents',service_charge_cents,
    'auto_service_taxable',coalesce(bs.auto_service_taxable,true),
    'repair_guide_id',part.repair_guide_id
  );
end;
$$;
grant execute on function public.calculate_part_repair_pricing(uuid,uuid,numeric) to authenticated;

create or replace function public.sync_part_pricing_companion()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  pricing jsonb;
  companion_id uuid;
  service_label text;
  service_price integer;
  service_cost integer;
  service_taxable boolean;
begin
  if tg_op='UPDATE' and old.item_type='part' and (new.item_type is distinct from 'part' or coalesce(new.damaged,false)) then
    delete from public.work_order_items where pricing_parent_line_id=new.id and auto_pricing_line;
    return new;
  end if;

  if new.item_type <> 'part' or coalesce(new.damaged,false) or new.inventory_item_id is null then
    return new;
  end if;

  pricing := public.calculate_part_repair_pricing(new.ticket_id,new.inventory_item_id,new.quantity);
  service_price := coalesce((pricing->>'service_charge_cents')::integer,0);
  service_cost := coalesce((pricing->>'estimated_labor_cost_cents')::integer,0);
  service_taxable := coalesce((pricing->>'auto_service_taxable')::boolean,true);
  service_label := case when coalesce((pricing->>'charge_parts_to_customer')::boolean,false)
    then 'Repair Labor / Service' else 'Repair Service' end;

  select id into companion_id from public.work_order_items
  where pricing_parent_line_id=new.id and auto_pricing_line
  limit 1;

  if companion_id is null then
    insert into public.work_order_items(
      ticket_id,item_type,description,quantity,unit_cost_cents,unit_price_cents,taxable,
      inventory_applied,price_overridden,created_by,pricing_parent_line_id,auto_pricing_line,pricing_metadata
    ) values(
      new.ticket_id,'fee',service_label,1,service_cost,service_price,service_taxable,
      false,false,auth.uid(),new.id,true,pricing
    );
  else
    update public.work_order_items set
      description=service_label,
      quantity=1,
      unit_cost_cents=service_cost,
      unit_price_cents=service_price,
      taxable=service_taxable,
      pricing_metadata=pricing,
      updated_at=now()
    where id=companion_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_part_pricing_companion_trg on public.work_order_items;
create trigger sync_part_pricing_companion_trg
after insert or update of item_type,inventory_item_id,quantity,unit_cost_cents,unit_price_cents,part_pricing_mode,damaged
on public.work_order_items
for each row execute function public.sync_part_pricing_companion();

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
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then raise exception 'Checkout permission required.'; end if;
  select * into t from public.repair_tickets where id=target_ticket and location_id=loc for update;
  if not found then raise exception 'Work order not found.'; end if;
  if t.status::text not in ('repaired','ready_for_pickup') then raise exception 'Work order must be Ready for Pickup before Sale Complete.'; end if;
  expected:=greatest(coalesce(t.total_cents,0),0); paid:=coalesce(paid_amount_cents,expected);
  if paid<0 then raise exception 'Paid amount cannot be negative.'; end if;
  if tender not in ('warranty','no_charge') and paid<>expected then raise exception 'External POS amount must match the work-order total exactly.'; end if;
  if exists(select 1 from public.receipts where ticket_id=t.id) then raise exception 'This work order already has a completed sale receipt.'; end if;
  select * into c from public.customers where id=t.customer_id;
  select * into d from public.devices where id=t.device_id;
  biz_date:=public.current_business_date(loc);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type',w.item_type,'sku',w.sku,'description',w.description,'quantity',w.quantity,
    'unit_price_cents',coalesce(w.unit_price_cents,0),'unit_cost_cents',coalesce(w.unit_cost_cents,0),
    'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,
    'part_pricing_mode',w.part_pricing_mode,'auto_pricing_line',w.auto_pricing_line,'pricing_metadata',w.pricing_metadata
  ) order by w.created_at),'[]'::jsonb) into lines
  from public.work_order_items w
  where w.ticket_id=t.id
    and not (w.item_type='part' and w.part_pricing_mode='bundled_service');

  update public.repair_tickets set payment_status='paid',amount_paid_cents=paid,payment_method=tender,
    payment_reference=nullif(trim(pos_reference),''),paid_at=now(),status='sale_complete',pickup_at=coalesce(pickup_at,now()),
    completed_at=coalesce(completed_at,now()),sale_completed_at=now(),sale_business_date=biz_date,updated_at=now()
  where id=t.id;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(t.id,auth.uid(),'sale_complete','External POS sale confirmed'||case when nullif(trim(pos_reference),'') is not null then ' · POS ref '||trim(pos_reference) else '' end,'internal');

  insert into public.receipts(location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,
    subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by)
  values(loc,t.id,t.ticket_number,biz_date,t.customer_id,trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),nullif(trim(c.email),''),
    nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,paid,tender,nullif(trim(pos_reference),''),lines,auth.uid())
  returning * into r;

  return jsonb_build_object('receipt_id',r.id,'receipt_number',r.receipt_number,'ticket_id',r.ticket_id,'ticket_number',r.ticket_number,
    'business_date',r.business_date,'customer_name',r.customer_name,'customer_email',r.customer_email,'device_description',r.device_description,
    'subtotal_cents',r.subtotal_cents,'tax_cents',r.tax_cents,'total_cents',r.total_cents,'amount_paid_cents',r.amount_paid_cents,
    'payment_method',r.payment_method,'payment_reference',r.payment_reference,'line_items',r.line_items,'created_at',r.created_at);
end;
$$;
grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;
