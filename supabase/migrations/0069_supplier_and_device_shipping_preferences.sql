-- Marlon shipping decision support for supplier parts orders and customer devices.
-- Supplier shipping choices NEVER place an order. Device shipping preferences NEVER
-- purchase postage. Existing explicit checkout/Buy & print confirmation remains required.

alter table public.business_settings
  add column if not exists supplier_shipping_preference text not null default 'balanced',
  add column if not exists device_shipping_preference text not null default 'balanced';

alter table public.business_settings drop constraint if exists business_settings_supplier_shipping_preference_check;
alter table public.business_settings add constraint business_settings_supplier_shipping_preference_check
  check (supplier_shipping_preference in ('balanced','lowest_cost','fastest'));
alter table public.business_settings drop constraint if exists business_settings_device_shipping_preference_check;
alter table public.business_settings add constraint business_settings_device_shipping_preference_check
  check (device_shipping_preference in ('balanced','lowest_cost','fastest'));

alter table public.purchase_orders
  add column if not exists supplier_shipping_options jsonb not null default '[]'::jsonb,
  add column if not exists supplier_shipping_carrier text,
  add column if not exists supplier_shipping_service text,
  add column if not exists supplier_shipping_option_key text,
  add column if not exists supplier_shipping_cost_cents integer,
  add column if not exists supplier_shipping_recommendation jsonb not null default '{}'::jsonb,
  add column if not exists supplier_shipping_selected_by uuid references public.profiles(id) on delete set null,
  add column if not exists supplier_shipping_selected_at timestamptz,
  add column if not exists supplier_shipping_selection_source text;

alter table public.purchase_orders drop constraint if exists purchase_orders_supplier_shipping_cost_check;
alter table public.purchase_orders add constraint purchase_orders_supplier_shipping_cost_check
  check (supplier_shipping_cost_cents is null or supplier_shipping_cost_cents >= 0);
alter table public.purchase_orders drop constraint if exists purchase_orders_supplier_shipping_selection_source_check;
alter table public.purchase_orders add constraint purchase_orders_supplier_shipping_selection_source_check
  check (supplier_shipping_selection_source is null or supplier_shipping_selection_source in ('marlon','staff','checkout','api'));

alter table public.shipping_shipments
  add column if not exists marlon_recommended_rate_id text,
  add column if not exists marlon_recommendation jsonb not null default '{}'::jsonb,
  add column if not exists preferred_rate_id text,
  add column if not exists preferred_carrier text,
  add column if not exists preferred_service text,
  add column if not exists preferred_by uuid references public.profiles(id) on delete set null,
  add column if not exists preferred_at timestamptz,
  add column if not exists preference_source text;

alter table public.shipping_shipments drop constraint if exists shipping_shipments_preference_source_check;
alter table public.shipping_shipments add constraint shipping_shipments_preference_source_check
  check (preference_source is null or preference_source in ('marlon','staff','rate_recommendation'));

create table if not exists public.supplier_shipping_methods (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  option_key text not null,
  carrier text not null,
  service text not null,
  transit_days_min integer,
  transit_days_max integer,
  free_threshold_cents integer,
  regular_price_cents integer,
  weekday_cutoff time,
  saturday_cutoff time,
  ground_compatible boolean not null default false,
  active boolean not null default true,
  source_url text,
  source_note text,
  updated_at timestamptz not null default now(),
  unique(source_name,option_key),
  check (transit_days_min is null or transit_days_min >= 0),
  check (transit_days_max is null or transit_days_max >= 0),
  check (free_threshold_cents is null or free_threshold_cents >= 0),
  check (regular_price_cents is null or regular_price_cents >= 0)
);

alter table public.supplier_shipping_methods enable row level security;
drop policy if exists supplier_shipping_methods_staff_read on public.supplier_shipping_methods;
create policy supplier_shipping_methods_staff_read on public.supplier_shipping_methods
for select to authenticated using (true);
grant select on public.supplier_shipping_methods to authenticated;

-- MobileSentrix publishes service-level shipping options. Some published rows do
-- not expose a unique carrier in plain text, so FedEx/UPS is intentionally kept
-- as a carrier group until the account checkout returns the exact carrier.
insert into public.supplier_shipping_methods(
  source_name,option_key,carrier,service,transit_days_min,transit_days_max,
  free_threshold_cents,regular_price_cents,weekday_cutoff,saturday_cutoff,
  ground_compatible,source_url,source_note
) values
  ('mobilesentrix','standard_overnight','FedEx/UPS','Standard Overnight',1,1,50000,500,'18:30','17:00',false,'https://www.mobilesentrix.com/shipping','Published domestic option; exact carrier should follow account checkout.'),
  ('mobilesentrix','priority_overnight','FedEx/UPS','Priority Overnight',1,1,null,2500,'18:30','17:00',false,'https://www.mobilesentrix.com/shipping','Published domestic option; priority overnight is the faster next-day tier.'),
  ('mobilesentrix','two_day','FedEx/UPS','2 Day',2,2,35000,500,'14:00','22:00',false,'https://www.mobilesentrix.com/shipping','Published domestic 2-day option.'),
  ('mobilesentrix','fedex_ground','FedEx','Ground',2,4,35000,399,'18:00',null,true,'https://www.mobilesentrix.com/shipping','Published Ground tier; checkout is authoritative for exact carrier/rate.'),
  ('mobilesentrix','ups_ground','UPS','Ground',2,4,35000,399,'19:00','18:00',true,'https://www.mobilesentrix.com/shipping','Published Ground tier; checkout is authoritative for exact carrier/rate.'),
  ('mobilesentrix','usps_ground','USPS','USPS Ground',2,4,35000,399,'18:00','18:00',true,'https://www.mobilesentrix.com/shipping','Published USPS Ground option.'),
  ('mobilesentrix','priority_mail','USPS','Priority Mail',1,3,50000,1000,'17:00','17:00',false,'https://www.mobilesentrix.com/shipping','Published USPS Priority Mail option.'),
  ('mobilesentrix','priority_mail_express','USPS','Priority Mail Express',1,2,100000,1500,'17:00',null,false,'https://www.mobilesentrix.com/shipping','Published USPS Priority Mail Express option.'),
  ('mobilesentrix','saturday_delivery','FedEx/UPS','Saturday Delivery',1,1,180000,3000,'14:00',null,false,'https://www.mobilesentrix.com/shipping','Published Friday cutoff varies by carrier; checkout is authoritative.')
on conflict (source_name,option_key) do update set
  carrier=excluded.carrier,
  service=excluded.service,
  transit_days_min=excluded.transit_days_min,
  transit_days_max=excluded.transit_days_max,
  free_threshold_cents=excluded.free_threshold_cents,
  regular_price_cents=excluded.regular_price_cents,
  weekday_cutoff=excluded.weekday_cutoff,
  saturday_cutoff=excluded.saturday_cutoff,
  ground_compatible=excluded.ground_compatible,
  source_url=excluded.source_url,
  source_note=excluded.source_note,
  active=true,
  updated_at=now();

create or replace function public.get_mobilesentrix_shipping_recommendation(p_purchase_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  po public.purchase_orders;
  preference text:='balanced';
  subtotal integer:=0;
  needed_at timestamptz;
  days_available integer;
  demand_priority text:='normal';
  ground_only boolean:=false;
  options jsonb:='[]'::jsonb;
  best jsonb:='{}'::jsonb;
  best_score numeric:=999999999;
  opt record;
  effective_cost integer;
  meets boolean;
  score numeric;
  recommendation jsonb;
begin
  if not (
    coalesce(public.has_permission('purchasing.manage'),false)
    or coalesce(public.has_permission('inventory.manage'),false)
  ) then raise exception 'Purchasing or inventory management permission required.'; end if;

  select * into po
  from public.purchase_orders
  where id=p_purchase_order_id and location_id=public.current_location_id();
  if po.id is null then raise exception 'Purchase order not found.'; end if;
  if lower(coalesce(po.supplier_name,''))<>'mobilesentrix' then
    raise exception 'This recommendation is for MobileSentrix purchase orders.';
  end if;

  select coalesce(sum(quantity_ordered*unit_cost_cents),0)::integer
  into subtotal
  from public.purchase_order_items where purchase_order_id=po.id;

  select coalesce(bs.supplier_shipping_preference,'balanced') into preference
  from public.business_settings bs where bs.location_id=po.location_id;
  preference:=coalesce(preference,'balanced');

  select
    min(coalesce(ap.starts_at,rt.promised_at)),
    case
      when bool_or(d.priority='urgent') then 'urgent'
      when bool_or(d.priority='high') then 'high'
      when bool_or(d.priority='normal') then 'normal'
      else 'low'
    end
  into needed_at,demand_priority
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
  join public.part_demands d on d.id=a.demand_id
  left join public.appointments ap on ap.id=d.appointment_id
  left join public.repair_tickets rt on rt.id=d.ticket_id
  where poi.purchase_order_id=po.id and d.status not in ('fulfilled','cancelled');

  select coalesce(bool_or(
    lower(coalesce(i.category,'')||' '||coalesce(i.name,'')||' '||coalesce(poi.description,'')) ~ '(battery|lithium)'
  ),false)
  into ground_only
  from public.purchase_order_items poi
  left join public.inventory_items i on i.id=poi.inventory_item_id
  where poi.purchase_order_id=po.id;

  if needed_at is not null then
    days_available:=greatest(1,ceil(extract(epoch from (needed_at-now()))/86400.0)::integer);
  else
    days_available:=null;
  end if;

  for opt in
    select * from public.supplier_shipping_methods
    where source_name='mobilesentrix' and active=true
      and (not ground_only or ground_compatible=true)
    order by service,carrier
  loop
    effective_cost:=case
      when opt.free_threshold_cents is not null and subtotal>=opt.free_threshold_cents then 0
      else coalesce(opt.regular_price_cents,0)
    end;
    meets:=days_available is null or coalesce(opt.transit_days_max,99)<=days_available;
    options:=options||jsonb_build_array(jsonb_build_object(
      'option_key',opt.option_key,
      'carrier',opt.carrier,
      'service',opt.service,
      'transit_days_min',opt.transit_days_min,
      'transit_days_max',opt.transit_days_max,
      'effective_cost_cents',effective_cost,
      'free_threshold_cents',opt.free_threshold_cents,
      'meets_need_by',meets,
      'ground_compatible',opt.ground_compatible,
      'source_url',opt.source_url
    ));

    score:=case when meets then 0 else 1000000 end;
    if preference='fastest' or demand_priority in ('urgent','high') then
      score:=score+coalesce(opt.transit_days_max,99)*10000+effective_cost;
    elsif preference='lowest_cost' then
      score:=score+effective_cost*100+coalesce(opt.transit_days_max,99);
    else
      score:=score+effective_cost*50+coalesce(opt.transit_days_max,99)*100;
    end if;
    if score<best_score then
      best_score:=score;
      best:=jsonb_build_object(
        'option_key',opt.option_key,
        'carrier',opt.carrier,
        'service',opt.service,
        'transit_days_min',opt.transit_days_min,
        'transit_days_max',opt.transit_days_max,
        'effective_cost_cents',effective_cost,
        'meets_need_by',meets,
        'ground_compatible',opt.ground_compatible
      );
    end if;
  end loop;

  recommendation:=jsonb_build_object(
    'source','mobilesentrix_published_shipping_policy',
    'purchase_order_id',po.id,
    'po_number',po.po_number,
    'subtotal_cents',subtotal,
    'needed_at',needed_at,
    'days_available',days_available,
    'priority',coalesce(demand_priority,'normal'),
    'preference',preference,
    'ground_only',ground_only,
    'recommended',best,
    'options',options,
    'checkout_authoritative',true,
    'note',case when ground_only then 'Battery/lithium order detected; Marlon limited the fallback recommendation to ground-compatible methods.' else 'Published MobileSentrix options are a planning fallback. Use the exact carrier, price, and availability shown by account checkout when they differ.' end,
    'generated_at',now()
  );

  update public.purchase_orders
  set supplier_shipping_recommendation=recommendation,updated_at=now()
  where id=po.id;

  return recommendation;
end;
$function$;

grant execute on function public.get_mobilesentrix_shipping_recommendation(uuid) to authenticated,service_role;

create or replace function public.save_mobilesentrix_checkout_options(p_purchase_order_id uuid,p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare po public.purchase_orders;
begin
  if not coalesce(public.has_permission('purchasing.manage'),false) then
    raise exception 'Purchasing management permission required.';
  end if;
  select * into po from public.purchase_orders
  where id=p_purchase_order_id and location_id=public.current_location_id() for update;
  if po.id is null then raise exception 'Purchase order not found.'; end if;
  if lower(coalesce(po.supplier_name,''))<>'mobilesentrix' then raise exception 'MobileSentrix purchase order required.'; end if;
  if jsonb_typeof(coalesce(p_options,'[]'::jsonb))<>'array' then raise exception 'Shipping options must be a JSON array.'; end if;
  if jsonb_array_length(coalesce(p_options,'[]'::jsonb))>50 then raise exception 'Too many shipping options.'; end if;
  update public.purchase_orders set supplier_shipping_options=coalesce(p_options,'[]'::jsonb),updated_at=now() where id=po.id;
  return jsonb_build_object('ok',true,'purchase_order_id',po.id,'options_saved',jsonb_array_length(coalesce(p_options,'[]'::jsonb)));
end;
$function$;

grant execute on function public.save_mobilesentrix_checkout_options(uuid,jsonb) to authenticated,service_role;

create or replace function public.set_mobilesentrix_shipping_choice(
  p_purchase_order_id uuid,
  p_carrier text,
  p_service text,
  p_option_key text default null,
  p_cost_cents integer default null,
  p_source text default 'staff'
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare po public.purchase_orders; source_value text;
begin
  if not coalesce(public.has_permission('purchasing.manage'),false) then
    raise exception 'Purchasing management permission required.';
  end if;
  select * into po from public.purchase_orders
  where id=p_purchase_order_id and location_id=public.current_location_id() for update;
  if po.id is null then raise exception 'Purchase order not found.'; end if;
  if lower(coalesce(po.supplier_name,''))<>'mobilesentrix' then raise exception 'MobileSentrix purchase order required.'; end if;
  if po.status not in ('draft','submitted') then raise exception 'Shipping method can only be changed before the supplier order is finalized.'; end if;
  if nullif(trim(p_carrier),'') is null or nullif(trim(p_service),'') is null then raise exception 'Carrier and shipping method are required.'; end if;
  if p_cost_cents is not null and p_cost_cents<0 then raise exception 'Shipping cost cannot be negative.'; end if;
  source_value:=case when p_source in ('marlon','staff','checkout','api') then p_source else 'staff' end;

  update public.purchase_orders
  set supplier_shipping_carrier=trim(p_carrier),
      supplier_shipping_service=trim(p_service),
      supplier_shipping_option_key=nullif(trim(p_option_key),''),
      supplier_shipping_cost_cents=p_cost_cents,
      supplier_shipping_selected_by=auth.uid(),
      supplier_shipping_selected_at=now(),
      supplier_shipping_selection_source=source_value,
      updated_at=now()
  where id=po.id;

  return jsonb_build_object(
    'ok',true,'purchase_order_id',po.id,'po_number',po.po_number,
    'carrier',trim(p_carrier),'service',trim(p_service),'cost_cents',p_cost_cents,
    'source',source_value,'paid_order_submitted',false
  );
end;
$function$;

grant execute on function public.set_mobilesentrix_shipping_choice(uuid,text,text,text,integer,text) to authenticated,service_role;

create or replace function public.set_mobilesentrix_shipping_choice_by_number(
  p_po_number bigint,
  p_carrier text,
  p_service text,
  p_option_key text default null,
  p_cost_cents integer default null,
  p_source text default 'marlon'
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare target uuid;
begin
  select id into target from public.purchase_orders
  where location_id=public.current_location_id() and po_number=p_po_number
    and lower(coalesce(supplier_name,''))='mobilesentrix'
  limit 1;
  if target is null then raise exception 'MobileSentrix purchase order not found.'; end if;
  return public.set_mobilesentrix_shipping_choice(target,p_carrier,p_service,p_option_key,p_cost_cents,p_source);
end;
$function$;

grant execute on function public.set_mobilesentrix_shipping_choice_by_number(bigint,text,text,text,integer,text) to authenticated,service_role;

create or replace function public.set_device_shipping_preference(
  p_shipment_id uuid,
  p_carrier text,
  p_service text,
  p_rate_id text default null,
  p_source text default 'staff'
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare shipment public.shipping_shipments; source_value text; matched boolean:=false;
begin
  if not (
    coalesce(public.has_permission('repairs.workflow'),false)
    or coalesce(public.has_permission('repairs.intake'),false)
  ) then raise exception 'Repair workflow or intake permission required.'; end if;
  select * into shipment from public.shipping_shipments
  where id=p_shipment_id and location_id=public.current_location_id() for update;
  if shipment.id is null then raise exception 'Shipment not found.'; end if;
  if shipment.status<>'rated' then raise exception 'Only a rated shipment can have a preferred rate selected.'; end if;
  if nullif(trim(p_carrier),'') is null or nullif(trim(p_service),'') is null then raise exception 'Carrier and service are required.'; end if;

  select exists(
    select 1 from jsonb_array_elements(coalesce(shipment.rates,'[]'::jsonb)) r
    where lower(coalesce(r->>'carrier',''))=lower(trim(p_carrier))
      and lower(coalesce(r->>'service',''))=lower(trim(p_service))
      and (nullif(trim(p_rate_id),'') is null or r->>'id'=trim(p_rate_id))
  ) into matched;
  if not matched then raise exception 'That carrier/service is not one of the live rates returned for this shipment.'; end if;

  source_value:=case when p_source in ('marlon','staff','rate_recommendation') then p_source else 'staff' end;
  update public.shipping_shipments
  set preferred_rate_id=nullif(trim(p_rate_id),''),preferred_carrier=trim(p_carrier),preferred_service=trim(p_service),
      preferred_by=auth.uid(),preferred_at=now(),preference_source=source_value,updated_at=now()
  where id=shipment.id;
  return jsonb_build_object('ok',true,'shipment_id',shipment.id,'carrier',trim(p_carrier),'service',trim(p_service),'rate_id',nullif(trim(p_rate_id),''),'source',source_value,'postage_purchased',false);
end;
$function$;

grant execute on function public.set_device_shipping_preference(uuid,text,text,text,text) to authenticated,service_role;

create or replace function public.get_marlon_shipping_context()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  can_supplier boolean:=coalesce(public.has_permission('purchasing.manage'),false) or coalesce(public.has_permission('inventory.manage'),false);
  can_device boolean:=coalesce(public.has_permission('repairs.view'),false) or coalesce(public.has_permission('repairs.workflow'),false) or coalesce(public.has_permission('repairs.intake'),false);
  supplier_rows jsonb:='[]'::jsonb;
  device_rows jsonb:='[]'::jsonb;
begin
  if loc is null then return jsonb_build_object('supplier_orders','[]'::jsonb,'device_shipments','[]'::jsonb); end if;

  if can_supplier then
    select coalesce(jsonb_agg(x.row_data order by x.created_at desc),'[]'::jsonb) into supplier_rows
    from (
      select po.created_at,jsonb_build_object(
        'id',po.id,'po_number',po.po_number,'status',po.status,'supplier',po.supplier_name,
        'carrier',po.supplier_shipping_carrier,'service',po.supplier_shipping_service,
        'shipping_cost_cents',po.supplier_shipping_cost_cents,
        'selection_source',po.supplier_shipping_selection_source,
        'recommendation',po.supplier_shipping_recommendation,
        'checkout_url',po.checkout_url
      ) row_data
      from public.purchase_orders po
      where po.location_id=loc and lower(coalesce(po.supplier_name,''))='mobilesentrix'
        and po.status in ('draft','submitted','ordered','partial','partially_received')
      order by po.created_at desc limit 8
    ) x;
  end if;

  if can_device then
    select coalesce(jsonb_agg(x.row_data order by x.created_at desc),'[]'::jsonb) into device_rows
    from (
      select s.created_at,jsonb_build_object(
        'id',s.id,'repair_ticket_id',s.repair_ticket_id,'lead_id',s.lead_id,'direction',s.direction,'status',s.status,
        'carrier',s.carrier,'service',s.service,'preferred_carrier',s.preferred_carrier,'preferred_service',s.preferred_service,
        'preferred_rate_id',s.preferred_rate_id,'recommendation',s.marlon_recommendation,'rates',s.rates
      ) row_data
      from public.shipping_shipments s
      where s.location_id=loc and s.status in ('rated','label_purchased','in_transit','delivered')
      order by s.created_at desc limit 8
    ) x;
  end if;

  return jsonb_build_object('supplier_orders',supplier_rows,'device_shipments',device_rows,'generated_at',now());
end;
$function$;

grant execute on function public.get_marlon_shipping_context() to authenticated,service_role;
