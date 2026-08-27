-- GotCracked procurement staging: Marlon may prepare orders, but never submit paid supplier checkout.

alter table public.business_settings
  add column if not exists marlon_auto_prepare_orders boolean not null default true;

alter table public.purchase_orders
  add column if not exists prepared_by_marlon boolean not null default false,
  add column if not exists prepared_at timestamptz,
  add column if not exists checkout_url text,
  add column if not exists requires_manual_checkout boolean not null default true;

alter table public.part_demands
  add column if not exists quantity_staged integer not null default 0;

alter table public.part_demands
  drop constraint if exists part_demands_quantity_staged_check;
alter table public.part_demands
  add constraint part_demands_quantity_staged_check check (quantity_staged >= 0);

-- Draft PO allocations are commitments-in-preparation, not inbound stock. Only
-- externally ordered POs count as inbound inventory commitments.
create or replace view public.inventory_commitment_summary
with (security_invoker=true)
as
select
  i.*,
  coalesce(r.reserved_quantity,0)::integer as reserved_quantity,
  greatest(i.quantity_on_hand-coalesce(r.reserved_quantity,0),0)::integer as available_quantity,
  coalesce(r.future_customer_reserved,0)::integer as future_customer_reserved,
  coalesce(r.work_order_reserved,0)::integer as work_order_reserved,
  coalesce(inbound.inbound_committed,0)::integer as inbound_committed,
  coalesce(inbound.inbound_for_future_customers,0)::integer as inbound_for_future_customers,
  coalesce(inbound.inbound_for_work_orders,0)::integer as inbound_for_work_orders
from public.inventory_items i
left join lateral (
  select
    sum(ir.quantity) filter (where ir.status='reserved') as reserved_quantity,
    sum(ir.quantity) filter (where ir.status='reserved' and d.driver_type in ('lead','appointment')) as future_customer_reserved,
    sum(ir.quantity) filter (where ir.status='reserved' and d.driver_type='work_order') as work_order_reserved
  from public.inventory_reservations ir
  join public.part_demands d on d.id=ir.demand_id
  where ir.inventory_item_id=i.id
) r on true
left join lateral (
  select
    sum(greatest(a.quantity_allocated-a.quantity_received,0)) as inbound_committed,
    sum(greatest(a.quantity_allocated-a.quantity_received,0)) filter (where d.driver_type in ('lead','appointment')) as inbound_for_future_customers,
    sum(greatest(a.quantity_allocated-a.quantity_received,0)) filter (where d.driver_type='work_order') as inbound_for_work_orders
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  join public.part_demands d on d.id=a.demand_id
  where poi.inventory_item_id=i.id
    and po.status in ('ordered','partial','partially_received')
    and d.status not in ('fulfilled','cancelled')
) inbound on true;

grant select on public.inventory_commitment_summary to authenticated;

create or replace function public.stage_mobilesentrix_demand_internal(p_demand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  d public.part_demands;
  inv public.inventory_items;
  supplier public.suppliers;
  listing public.part_source_listings;
  existing record;
  needed integer;
  po public.purchase_orders;
  line public.purchase_order_items;
begin
  select * into d from public.part_demands where id=p_demand_id for update;
  if d.id is null then return jsonb_build_object('ok',false,'reason','demand_not_found'); end if;
  if d.status in ('fulfilled','cancelled') then return jsonb_build_object('ok',false,'reason','closed_demand'); end if;
  if d.inventory_item_id is null then return jsonb_build_object('ok',false,'reason','inventory_item_required'); end if;

  select * into inv from public.inventory_items where id=d.inventory_item_id;
  if inv.id is null then return jsonb_build_object('ok',false,'reason','inventory_item_not_found'); end if;

  select a.id as allocation_id,poi.purchase_order_id,poi.id as line_id
  into existing
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
  join public.purchase_orders p on p.id=poi.purchase_order_id
  where a.demand_id=d.id and p.status in ('draft','submitted','ordered','partial','partially_received')
  order by p.created_at desc
  limit 1;
  if existing.allocation_id is not null then
    return jsonb_build_object('ok',true,'already_staged',true,'purchase_order_id',existing.purchase_order_id,'purchase_order_item_id',existing.line_id);
  end if;

  needed:=greatest(d.quantity_required-d.quantity_reserved-d.quantity_ordered-d.quantity_staged,0);
  if needed<=0 then return jsonb_build_object('ok',true,'already_covered',true); end if;

  select * into supplier
  from public.suppliers
  where location_id=d.location_id and active=true and (supplier_type='mobilesentrix' or lower(name)='mobilesentrix')
  order by case when supplier_type='mobilesentrix' then 0 else 1 end
  limit 1;

  if coalesce(d.registry_part_id,inv.registry_part_id) is not null then
    select * into listing
    from public.part_source_listings
    where part_id=coalesce(d.registry_part_id,inv.registry_part_id)
      and source_name='mobilesentrix' and active=true
    order by last_seen_at desc
    limit 1;
  end if;

  if listing.id is null and lower(coalesce(inv.supplier_name,''))<>'mobilesentrix' then
    return jsonb_build_object('ok',false,'reason','no_mobilesentrix_source');
  end if;

  insert into public.purchase_orders(
    location_id,supplier_id,supplier_name,status,notes,created_by,
    prepared_by_marlon,prepared_at,checkout_url,requires_manual_checkout
  ) values(
    d.location_id,supplier.id,'MobileSentrix','draft',
    'Prepared automatically from verified part demand. Paid supplier checkout must be completed manually.',
    auth.uid(),true,now(),coalesce(supplier.ordering_url,supplier.website_url,'https://www.mobilesentrix.com'),true
  ) returning * into po;

  insert into public.purchase_order_items(
    purchase_order_id,inventory_item_id,supplier_sku,description,quantity_ordered,
    quantity_received,unit_cost_cents,product_url
  ) values(
    po.id,inv.id,coalesce(listing.supplier_sku,inv.supplier_sku),inv.name,needed,
    0,coalesce(listing.price_cents,inv.cost_cents,0),coalesce(listing.source_url,inv.supplier_url)
  ) returning * into line;

  insert into public.purchase_order_item_allocations(purchase_order_item_id,demand_id,quantity_allocated)
  values(line.id,d.id,needed);

  update public.part_demands
  set quantity_staged=quantity_staged+needed,updated_at=now()
  where id=d.id;

  return jsonb_build_object(
    'ok',true,'staged',needed,'purchase_order_id',po.id,'purchase_order_item_id',line.id,
    'manual_checkout_required',true,'checkout_url',po.checkout_url
  );
end;
$function$;

revoke all on function public.stage_mobilesentrix_demand_internal(uuid) from public,anon,authenticated;
grant execute on function public.stage_mobilesentrix_demand_internal(uuid) to service_role;

create or replace function public.stage_mobilesentrix_demand(p_demand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
begin
  if not (
    coalesce(public.has_permission('purchasing.manage'),false)
    or coalesce(public.has_permission('inventory.manage'),false)
  ) then raise exception 'Purchasing or inventory management permission required.'; end if;
  return public.stage_mobilesentrix_demand_internal(p_demand_id);
end;
$function$;

grant execute on function public.stage_mobilesentrix_demand(uuid) to authenticated,service_role;

create or replace function public.auto_stage_part_demand()
returns trigger
language plpgsql
security definer
set search_path='public'
as $function$
declare enabled boolean;
begin
  if new.status in ('fulfilled','cancelled','ordered','partially_received','ready') then return new; end if;
  select coalesce(marlon_auto_prepare_orders,true) into enabled
  from public.business_settings where location_id=new.location_id;
  if not coalesce(enabled,true) then return new; end if;
  begin
    perform public.stage_mobilesentrix_demand_internal(new.id);
  exception when others then
    -- A missing supplier listing must never block creation of the repair demand.
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.auto_stage_part_demand() from public,anon,authenticated;

drop trigger if exists part_demand_auto_stage_po_trigger on public.part_demands;
create trigger part_demand_auto_stage_po_trigger
after insert or update of status,quantity_required,quantity_reserved,quantity_ordered,inventory_item_id,registry_part_id
on public.part_demands
for each row execute function public.auto_stage_part_demand();

create or replace function public.finalize_manual_supplier_order(
  p_purchase_order_id uuid,
  p_external_order_number text,
  p_external_order_id text default null,
  p_expected_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  po public.purchase_orders;
  rec record;
begin
  if not coalesce(public.has_permission('purchasing.manage'),false) then
    raise exception 'Purchasing management permission required.';
  end if;
  if nullif(trim(p_external_order_number),'') is null then
    raise exception 'The supplier order number is required after manual checkout.';
  end if;

  select * into po from public.purchase_orders where id=p_purchase_order_id for update;
  if po.id is null or po.location_id<>public.current_location_id() then raise exception 'Purchase order not found.'; end if;
  if po.status not in ('draft','submitted') then raise exception 'Only a prepared or submitted PO can be marked ordered.'; end if;

  update public.purchase_orders
  set status='ordered',external_order_number=trim(p_external_order_number),external_order_id=nullif(trim(p_external_order_id),''),
      ordered_at=now(),expected_at=p_expected_at,updated_at=now()
  where id=po.id;

  for rec in
    select a.demand_id,sum(a.quantity_allocated)::integer as qty
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id=a.purchase_order_item_id
    where poi.purchase_order_id=po.id
    group by a.demand_id
  loop
    update public.part_demands
    set quantity_ordered=quantity_ordered+rec.qty,
        quantity_staged=greatest(quantity_staged-rec.qty,0),
        status='ordered',updated_at=now()
    where id=rec.demand_id and status not in ('fulfilled','cancelled');
  end loop;

  return jsonb_build_object('ok',true,'purchase_order_id',po.id,'status','ordered','manual_checkout_recorded',true);
end;
$function$;

grant execute on function public.finalize_manual_supplier_order(uuid,text,text,timestamptz) to authenticated,service_role;
