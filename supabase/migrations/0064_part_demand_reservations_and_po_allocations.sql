-- Premium Inventory foundation: distinguish physical stock from committed stock.
-- A part demand records WHY a part is needed. PO allocations track inbound units.
-- Inventory reservations track physical units already committed after they are on hand.

create table if not exists public.part_demands (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  driver_type text not null check (driver_type in ('lead','appointment','work_order','stock_replenishment')),
  lead_id uuid references public.leads(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  registry_part_id uuid references public.parts_registry(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  quantity_required integer not null check (quantity_required > 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  quantity_ordered integer not null default 0 check (quantity_ordered >= 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  status text not null default 'needed' check (status in ('needed','partially_reserved','reserved','ordered','partially_received','ready','fulfilled','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  source text not null default 'portal',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (driver_type='lead' and lead_id is not null)
    or (driver_type='appointment' and appointment_id is not null)
    or (driver_type='work_order' and ticket_id is not null)
    or driver_type='stock_replenishment'
  )
);

create index if not exists part_demands_location_status_idx on public.part_demands(location_id,status,updated_at desc);
create index if not exists part_demands_inventory_idx on public.part_demands(location_id,inventory_item_id,status);
create index if not exists part_demands_ticket_idx on public.part_demands(ticket_id) where ticket_id is not null;
create index if not exists part_demands_appointment_idx on public.part_demands(appointment_id) where appointment_id is not null;
create index if not exists part_demands_lead_idx on public.part_demands(lead_id) where lead_id is not null;

create table if not exists public.purchase_order_item_allocations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  demand_id uuid not null references public.part_demands(id) on delete cascade,
  quantity_allocated integer not null check (quantity_allocated > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_item_id,demand_id),
  check (quantity_received <= quantity_allocated)
);

create index if not exists po_item_allocations_demand_idx on public.purchase_order_item_allocations(demand_id);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  demand_id uuid not null references public.part_demands(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_reservations_one_active_per_demand_item
  on public.inventory_reservations(demand_id,inventory_item_id)
  where status='reserved';
create index if not exists inventory_reservations_item_status_idx
  on public.inventory_reservations(location_id,inventory_item_id,status);

alter table public.part_demands enable row level security;
alter table public.purchase_order_item_allocations enable row level security;
alter table public.inventory_reservations enable row level security;

drop policy if exists part_demands_staff_read on public.part_demands;
create policy part_demands_staff_read on public.part_demands for select to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.view'),false) or coalesce(public.has_permission('repairs.view'),false)));

drop policy if exists part_demands_staff_manage on public.part_demands;
create policy part_demands_staff_manage on public.part_demands for all to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.manage'),false) or coalesce(public.has_permission('purchasing.manage'),false) or coalesce(public.has_permission('repairs.workflow'),false)))
with check (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.manage'),false) or coalesce(public.has_permission('purchasing.manage'),false) or coalesce(public.has_permission('repairs.workflow'),false)));

drop policy if exists po_item_allocations_staff_read on public.purchase_order_item_allocations;
create policy po_item_allocations_staff_read on public.purchase_order_item_allocations for select to authenticated
using (exists (
  select 1 from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=purchase_order_item_id and po.location_id=public.current_location_id()
) and (coalesce(public.has_permission('inventory.view'),false) or coalesce(public.has_permission('purchasing.view'),false)));

drop policy if exists po_item_allocations_staff_manage on public.purchase_order_item_allocations;
create policy po_item_allocations_staff_manage on public.purchase_order_item_allocations for all to authenticated
using (exists (
  select 1 from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=purchase_order_item_id and po.location_id=public.current_location_id()
) and coalesce(public.has_permission('purchasing.manage'),false))
with check (exists (
  select 1 from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=purchase_order_item_id and po.location_id=public.current_location_id()
) and coalesce(public.has_permission('purchasing.manage'),false));

drop policy if exists inventory_reservations_staff_read on public.inventory_reservations;
create policy inventory_reservations_staff_read on public.inventory_reservations for select to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.view'),false) or coalesce(public.has_permission('repairs.view'),false)));

drop policy if exists inventory_reservations_staff_manage on public.inventory_reservations;
create policy inventory_reservations_staff_manage on public.inventory_reservations for all to authenticated
using (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.manage'),false) or coalesce(public.has_permission('purchasing.manage'),false)))
with check (location_id=public.current_location_id() and (coalesce(public.has_permission('inventory.manage'),false) or coalesce(public.has_permission('purchasing.manage'),false)));

grant select,insert,update,delete on public.part_demands to authenticated;
grant select,insert,update,delete on public.purchase_order_item_allocations to authenticated;
grant select,insert,update,delete on public.inventory_reservations to authenticated;

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
  join public.part_demands d on d.id=a.demand_id
  where poi.inventory_item_id=i.id and d.status not in ('fulfilled','cancelled')
) inbound on true;

grant select on public.inventory_commitment_summary to authenticated;

create or replace view public.part_demand_queue
with (security_invoker=true)
as
select
  d.*,
  i.name as inventory_name,
  i.sku as inventory_sku,
  i.quantity_on_hand,
  l.name as lead_name,
  l.public_reference as lead_reference,
  a.preferred_date as appointment_date,
  a.preferred_time as appointment_time,
  rt.ticket_number,
  case
    when d.driver_type='work_order' then 'Open work order'
    when d.driver_type='appointment' then 'Future appointment'
    when d.driver_type='lead' then 'Future customer lead'
    else 'Stock replenishment'
  end as driver_label
from public.part_demands d
left join public.inventory_items i on i.id=d.inventory_item_id
left join public.leads l on l.id=d.lead_id
left join public.appointments a on a.id=d.appointment_id
left join public.repair_tickets rt on rt.id=d.ticket_id;

grant select on public.part_demand_queue to authenticated;

create or replace function public.reserve_available_inventory_for_demand(p_demand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  d public.part_demands;
  item public.inventory_items;
  active_reserved integer;
  existing_for_demand integer;
  needed integer;
  available integer;
  take_qty integer;
begin
  if auth.uid() is not null and not (
    coalesce(public.has_permission('inventory.manage'),false)
    or coalesce(public.has_permission('purchasing.manage'),false)
    or coalesce(public.has_permission('repairs.workflow'),false)
  ) then raise exception 'Inventory, purchasing, or repair workflow permission required.'; end if;

  select * into d from public.part_demands where id=p_demand_id for update;
  if d.id is null or (auth.uid() is not null and d.location_id<>public.current_location_id()) then raise exception 'Part demand not found.'; end if;
  if d.status in ('fulfilled','cancelled') then return jsonb_build_object('reserved',0,'status',d.status); end if;
  if d.inventory_item_id is null then return jsonb_build_object('reserved',0,'status',d.status,'reason','No inventory item linked'); end if;

  select * into item from public.inventory_items where id=d.inventory_item_id for update;
  if item.id is null then raise exception 'Inventory item not found.'; end if;

  select coalesce(sum(quantity),0) into active_reserved
  from public.inventory_reservations where inventory_item_id=item.id and status='reserved';
  select coalesce(sum(quantity),0) into existing_for_demand
  from public.inventory_reservations where inventory_item_id=item.id and demand_id=d.id and status='reserved';

  needed:=greatest(d.quantity_required-existing_for_demand,0);
  available:=greatest(item.quantity_on_hand-active_reserved,0);
  take_qty:=least(needed,available);

  if take_qty>0 then
    insert into public.inventory_reservations(location_id,inventory_item_id,demand_id,quantity,status,note)
    values(d.location_id,item.id,d.id,take_qty,'reserved','Automatically reserved for part demand')
    on conflict (demand_id,inventory_item_id) where status='reserved'
    do update set quantity=public.inventory_reservations.quantity+excluded.quantity,updated_at=now();
  end if;

  select coalesce(sum(quantity),0) into existing_for_demand
  from public.inventory_reservations where inventory_item_id=item.id and demand_id=d.id and status='reserved';

  update public.part_demands
  set quantity_reserved=existing_for_demand,
      status=case
        when existing_for_demand>=quantity_required then 'reserved'
        when existing_for_demand>0 then 'partially_reserved'
        when quantity_ordered>0 then 'ordered'
        else 'needed'
      end,
      updated_at=now()
  where id=d.id;

  return jsonb_build_object('reserved',take_qty,'total_reserved',existing_for_demand,'available_after',greatest(available-take_qty,0));
end;
$function$;

grant execute on function public.reserve_available_inventory_for_demand(uuid) to authenticated,service_role;

create or replace function public.allocate_part_demand_to_po_item(p_demand_id uuid,p_purchase_order_item_id uuid,p_quantity integer)
returns public.purchase_order_item_allocations
language plpgsql
security definer
set search_path='public'
as $function$
declare d public.part_demands; line public.purchase_order_items; po public.purchase_orders; saved public.purchase_order_item_allocations; already integer; open_need integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('purchasing.manage'),false) then raise exception 'Purchasing management permission required.'; end if;
  if p_quantity<=0 then raise exception 'Allocation quantity must be positive.'; end if;
  select * into d from public.part_demands where id=p_demand_id for update;
  select * into line from public.purchase_order_items where id=p_purchase_order_item_id for update;
  if d.id is null or line.id is null then raise exception 'Demand or PO line not found.'; end if;
  select * into po from public.purchase_orders where id=line.purchase_order_id;
  if d.location_id<>po.location_id or (auth.uid() is not null and po.location_id<>public.current_location_id()) then raise exception 'Demand and PO must belong to the same location.'; end if;
  if d.inventory_item_id is not null and line.inventory_item_id is distinct from d.inventory_item_id then raise exception 'PO line does not match the demanded inventory item.'; end if;
  select coalesce(sum(quantity_allocated),0) into already from public.purchase_order_item_allocations where demand_id=d.id;
  open_need:=greatest(d.quantity_required-d.quantity_reserved-already,0);
  if p_quantity>open_need then raise exception 'Allocation exceeds the demand quantity still needed.'; end if;
  insert into public.purchase_order_item_allocations(purchase_order_item_id,demand_id,quantity_allocated)
  values(line.id,d.id,p_quantity)
  on conflict(purchase_order_item_id,demand_id) do update set quantity_allocated=public.purchase_order_item_allocations.quantity_allocated+excluded.quantity_allocated,updated_at=now()
  returning * into saved;
  update public.part_demands set quantity_ordered=quantity_ordered+p_quantity,status='ordered',updated_at=now() where id=d.id;
  return saved;
end;
$function$;

grant execute on function public.allocate_part_demand_to_po_item(uuid,uuid,integer) to authenticated,service_role;

-- Receiving now preserves customer/work-order ownership of inbound parts.
create or replace function public.receive_purchase_order_item(target_item uuid, receive_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path TO 'public'
as $function$
declare
  line public.purchase_order_items;
  po public.purchase_orders;
  inv public.inventory_items;
  remaining integer;
  all_received boolean;
  any_received boolean;
  allocation record;
  alloc_take integer;
  unallocated integer;
  new_reserved integer;
  allocation_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.has_permission('purchasing.manage') then raise exception 'You do not have permission to receive purchase orders.'; end if;
  if receive_quantity<=0 then raise exception 'Receive quantity must be positive.'; end if;
  select * into line from public.purchase_order_items where id=target_item for update;
  if not found then raise exception 'Purchase-order item not found.'; end if;
  select * into po from public.purchase_orders where id=line.purchase_order_id for update;
  if auth.uid() is not null and po.location_id<>public.current_location_id() then raise exception 'Purchase order not found.'; end if;
  remaining:=line.quantity_ordered-line.quantity_received;
  if receive_quantity>remaining then raise exception 'Receive quantity exceeds the quantity still open.'; end if;
  if line.inventory_item_id is null then raise exception 'PO line must be linked to an inventory item before receiving.'; end if;

  update public.inventory_items
  set quantity_on_hand=quantity_on_hand+receive_quantity,cost_cents=coalesce(line.unit_cost_cents,cost_cents),updated_at=now()
  where id=line.inventory_item_id returning * into inv;

  update public.purchase_order_items set quantity_received=quantity_received+receive_quantity where id=target_item;
  insert into public.inventory_transactions(location_id,inventory_item_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id)
  values(po.location_id,inv.id,'receive',receive_quantity,line.unit_cost_cents,'Purchase order receipt',auth.uid());

  unallocated:=receive_quantity;
  for allocation in
    select a.*,d.driver_type,d.priority,d.quantity_required
    from public.purchase_order_item_allocations a
    join public.part_demands d on d.id=a.demand_id
    where a.purchase_order_item_id=target_item
      and a.quantity_received<a.quantity_allocated
      and d.status not in ('fulfilled','cancelled')
    order by
      case d.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      case d.driver_type when 'work_order' then 1 when 'appointment' then 2 when 'lead' then 3 else 4 end,
      d.created_at
    for update of a,d
  loop
    exit when unallocated<=0;
    alloc_take:=least(unallocated,allocation.quantity_allocated-allocation.quantity_received);
    if alloc_take<=0 then continue; end if;

    update public.purchase_order_item_allocations
    set quantity_received=quantity_received+alloc_take,updated_at=now()
    where id=allocation.id;

    insert into public.inventory_reservations(location_id,inventory_item_id,demand_id,quantity,status,note)
    values(po.location_id,inv.id,allocation.demand_id,alloc_take,'reserved','Reserved automatically when supplier shipment was received')
    on conflict (demand_id,inventory_item_id) where status='reserved'
    do update set quantity=public.inventory_reservations.quantity+excluded.quantity,updated_at=now();

    select coalesce(sum(quantity),0) into new_reserved
    from public.inventory_reservations
    where demand_id=allocation.demand_id and inventory_item_id=inv.id and status='reserved';

    update public.part_demands
    set quantity_received=quantity_received+alloc_take,
        quantity_reserved=new_reserved,
        status=case when new_reserved>=quantity_required then 'ready' else 'partially_received' end,
        updated_at=now()
    where id=allocation.demand_id;

    allocation_results:=allocation_results || jsonb_build_array(jsonb_build_object(
      'demand_id',allocation.demand_id,
      'driver_type',allocation.driver_type,
      'quantity_reserved',alloc_take
    ));
    unallocated:=unallocated-alloc_take;
  end loop;

  select bool_and(quantity_received>=quantity_ordered),bool_or(quantity_received>0)
  into all_received,any_received from public.purchase_order_items where purchase_order_id=po.id;
  update public.purchase_orders
  set status=case when all_received then 'received' when any_received then 'partial' else status end,
      received_at=case when all_received then now() else received_at end,
      updated_at=now()
  where id=po.id;

  return jsonb_build_object(
    'inventory_item_id',inv.id,
    'name',inv.name,
    'sku',inv.sku,
    'quantity_received',receive_quantity,
    'quantity_on_hand',inv.quantity_on_hand,
    'reserved_from_this_receipt',receive_quantity-unallocated,
    'unallocated_available_from_this_receipt',unallocated,
    'allocations',allocation_results,
    'sell_price_cents',inv.sell_price_cents
  );
end;
$function$;

grant execute on function public.receive_purchase_order_item(uuid,integer) to authenticated,service_role;

comment on table public.part_demands is 'Why a part is needed: future lead/appointment, open work order, or stock replenishment.';
comment on table public.purchase_order_item_allocations is 'Inbound PO quantities committed to specific part demands before the shipment arrives.';
comment on table public.inventory_reservations is 'Physical on-hand units that are not available to other customers because they are committed to a part demand.';
