-- Uniform internal parts status for leads, appointments and work orders.
alter table public.leads add column if not exists parts_status text not null default 'not_evaluated';
alter table public.appointments add column if not exists parts_status text not null default 'not_evaluated';
alter table public.repair_tickets add column if not exists parts_status text not null default 'not_evaluated';

alter table public.leads drop constraint if exists leads_parts_status_check;
alter table public.leads add constraint leads_parts_status_check check (parts_status in ('not_evaluated','available','need_to_order','ordered','awaiting_parts','ready','fulfilled'));
alter table public.appointments drop constraint if exists appointments_parts_status_check;
alter table public.appointments add constraint appointments_parts_status_check check (parts_status in ('not_evaluated','available','need_to_order','ordered','awaiting_parts','ready','fulfilled'));
alter table public.repair_tickets drop constraint if exists repair_tickets_parts_status_check;
alter table public.repair_tickets add constraint repair_tickets_parts_status_check check (parts_status in ('not_evaluated','available','need_to_order','ordered','awaiting_parts','ready','fulfilled'));

create or replace function public.refresh_part_driver_status(
  p_driver_type text,
  p_lead_id uuid default null,
  p_appointment_id uuid default null,
  p_ticket_id uuid default null
) returns text
language plpgsql
security definer
set search_path='public'
as $function$
declare
  status_value text;
  needed_count integer;
  awaiting_count integer;
  ready_count integer;
  active_count integer;
begin
  select
    count(*) filter (where status in ('needed','partially_reserved') and quantity_reserved+quantity_ordered < quantity_required),
    count(*) filter (where status in ('ordered','partially_received') or (quantity_ordered>0 and quantity_reserved<quantity_required)),
    count(*) filter (where status in ('reserved','ready') or quantity_reserved>=quantity_required),
    count(*) filter (where status not in ('fulfilled','cancelled'))
  into needed_count,awaiting_count,ready_count,active_count
  from public.part_demands
  where driver_type=p_driver_type
    and (p_lead_id is null or lead_id=p_lead_id)
    and (p_appointment_id is null or appointment_id=p_appointment_id)
    and (p_ticket_id is null or ticket_id=p_ticket_id);

  status_value:=case
    when coalesce(active_count,0)=0 then 'fulfilled'
    when coalesce(needed_count,0)>0 then 'need_to_order'
    when coalesce(awaiting_count,0)>0 then 'awaiting_parts'
    when coalesce(ready_count,0)>0 then 'ready'
    else 'available'
  end;

  if p_driver_type='lead' and p_lead_id is not null then
    update public.leads
    set parts_status=status_value,
        pipeline_status=case
          when status_value='need_to_order' and pipeline_status not in ('converted','lost') then 'need_to_order_part'
          when status_value='awaiting_parts' and pipeline_status='need_to_order_part' then 'awaiting_parts'
          else pipeline_status
        end,
        updated_at=now()
    where id=p_lead_id;
  elsif p_driver_type='appointment' and p_appointment_id is not null then
    update public.appointments set parts_status=status_value,updated_at=now() where id=p_appointment_id;
  elsif p_driver_type='work_order' and p_ticket_id is not null then
    update public.repair_tickets
    set parts_status=status_value,
        status=case
          when status_value='need_to_order' and status not in ('sale_complete','completed','cancelled','repaired','ready_for_pickup','abandoned','unrepairable','customer_declined') then 'need_to_order_parts'::public.ticket_status
          when status_value='awaiting_parts' and status='need_to_order_parts' then 'awaiting_parts'::public.ticket_status
          else status
        end,
        updated_at=now()
    where id=p_ticket_id;
  end if;

  return status_value;
end;
$function$;

revoke all on function public.refresh_part_driver_status(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.refresh_part_driver_status(text,uuid,uuid,uuid) to service_role;

create or replace function public.part_demand_status_effects()
returns trigger
language plpgsql
security definer
set search_path='public'
as $function$
begin
  if tg_op='DELETE' then
    perform public.refresh_part_driver_status(old.driver_type,old.lead_id,old.appointment_id,old.ticket_id);
    return old;
  end if;
  perform public.refresh_part_driver_status(new.driver_type,new.lead_id,new.appointment_id,new.ticket_id);
  if tg_op='UPDATE' and (old.driver_type,old.lead_id,old.appointment_id,old.ticket_id) is distinct from (new.driver_type,new.lead_id,new.appointment_id,new.ticket_id) then
    perform public.refresh_part_driver_status(old.driver_type,old.lead_id,old.appointment_id,old.ticket_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists part_demand_status_effects_trigger on public.part_demands;
create trigger part_demand_status_effects_trigger
after insert or update or delete on public.part_demands
for each row execute function public.part_demand_status_effects();

-- Add or update a demand for one internal driver. Useful for Marlon and Portal workflows.
create or replace function public.require_part_for_driver(
  p_driver_type text,
  p_driver_id uuid,
  p_inventory_item_id uuid,
  p_quantity integer default 1,
  p_notes text default null,
  p_source text default 'portal'
) returns public.part_demands
language plpgsql
security definer
set search_path='public'
as $function$
declare
  loc uuid;
  existing public.part_demands;
  saved public.part_demands;
  lead_id_value uuid;
  appointment_id_value uuid;
  ticket_id_value uuid;
begin
  if auth.uid() is not null and not (
    coalesce(public.has_permission('repairs.workflow'),false)
    or coalesce(public.has_permission('inventory.manage'),false)
    or coalesce(public.has_permission('purchasing.manage'),false)
  ) then raise exception 'Repair workflow, inventory, or purchasing permission required.'; end if;
  if p_driver_type not in ('lead','appointment','work_order','stock_replenishment') then raise exception 'Invalid demand driver.'; end if;
  if p_quantity<=0 then raise exception 'Quantity must be positive.'; end if;
  loc:=case when auth.uid() is null then (select location_id from public.inventory_items where id=p_inventory_item_id) else public.current_location_id() end;
  if loc is null or not exists(select 1 from public.inventory_items where id=p_inventory_item_id and location_id=loc and active=true) then raise exception 'Inventory part was not found.'; end if;

  if p_driver_type='lead' then lead_id_value:=p_driver_id;
  elsif p_driver_type='appointment' then appointment_id_value:=p_driver_id;
  elsif p_driver_type='work_order' then ticket_id_value:=p_driver_id;
  end if;

  select * into existing from public.part_demands d
  where d.location_id=loc and d.driver_type=p_driver_type and d.inventory_item_id=p_inventory_item_id
    and d.status not in ('fulfilled','cancelled')
    and (p_driver_type='stock_replenishment'
      or (p_driver_type='lead' and d.lead_id=p_driver_id)
      or (p_driver_type='appointment' and d.appointment_id=p_driver_id)
      or (p_driver_type='work_order' and d.ticket_id=p_driver_id))
  order by d.created_at limit 1 for update;

  if existing.id is not null then
    update public.part_demands set quantity_required=greatest(quantity_required,p_quantity),notes=coalesce(nullif(btrim(p_notes),''),notes),updated_at=now() where id=existing.id returning * into saved;
  else
    insert into public.part_demands(location_id,driver_type,lead_id,appointment_id,ticket_id,inventory_item_id,quantity_required,status,source,notes,created_by)
    values(loc,p_driver_type,lead_id_value,appointment_id_value,ticket_id_value,p_inventory_item_id,p_quantity,'needed',coalesce(nullif(btrim(p_source),''),'portal'),nullif(btrim(p_notes),''),auth.uid()) returning * into saved;
  end if;

  perform public.reserve_available_inventory_for_demand(saved.id);
  select * into saved from public.part_demands where id=saved.id;
  return saved;
end;
$function$;

grant execute on function public.require_part_for_driver(text,uuid,uuid,integer,text,text) to authenticated,service_role;

-- Work-order parts can now remain on a repair as a requirement when stock is unavailable.
-- Existing on-hand/reserved units are consumed only when they are actually available to this work order.
create or replace function public.work_order_item_effects()
returns trigger
language plpgsql
security definer
set search_path TO 'public'
as $function$
declare
  item public.inventory_items;
  qty integer;
  target uuid;
  total_reserved integer;
  own_reserved integer;
  available integer;
  demand_row public.part_demands;
  consume_from_reservation integer;
begin
  if pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  target:=coalesce(new.ticket_id,old.ticket_id);

  if tg_op='DELETE' and old.promo_code_id is not null then
    update public.promo_codes set times_used=greatest(times_used-1,0) where id=old.promo_code_id;
  elsif tg_op='UPDATE' and old.promo_code_id is distinct from new.promo_code_id and old.promo_code_id is not null then
    update public.promo_codes set times_used=greatest(times_used-1,0) where id=old.promo_code_id;
  end if;

  if tg_op in ('UPDATE','DELETE') and old.item_type='part' and old.inventory_applied then
    update public.inventory_items set quantity_on_hand=quantity_on_hand+ceil(old.quantity)::integer,updated_at=now() where id=old.inventory_item_id;
    insert into public.inventory_transactions(location_id,inventory_item_id,ticket_id,work_order_item_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id)
      select location_id,old.inventory_item_id,old.ticket_id,old.id,'return',ceil(old.quantity)::integer,old.unit_cost_cents,'Work-order line changed or removed',auth.uid() from public.repair_tickets where id=old.ticket_id;
  elsif tg_op='DELETE' and old.item_type='part' and not old.inventory_applied then
    update public.part_demands set status='cancelled',updated_at=now()
    where driver_type='work_order' and ticket_id=old.ticket_id and inventory_item_id=old.inventory_item_id and status not in ('fulfilled','cancelled');
  end if;

  if tg_op in ('INSERT','UPDATE') and new.item_type='part' and new.inventory_applied then
    qty:=ceil(new.quantity)::integer;
    select * into item from public.inventory_items where id=new.inventory_item_id for update;
    if item.id is null then raise exception 'Inventory part not found.'; end if;

    select coalesce(sum(ir.quantity),0) into total_reserved
    from public.inventory_reservations ir
    where ir.inventory_item_id=item.id and ir.status='reserved';

    select coalesce(sum(ir.quantity),0) into own_reserved
    from public.inventory_reservations ir
    join public.part_demands d on d.id=ir.demand_id
    where ir.inventory_item_id=item.id and ir.status='reserved' and d.driver_type='work_order' and d.ticket_id=new.ticket_id;

    available:=greatest(item.quantity_on_hand-total_reserved+own_reserved,0);

    if available<qty then
      update public.work_order_items set inventory_applied=false where id=new.id;
      select public.require_part_for_driver('work_order',new.ticket_id,new.inventory_item_id,qty,'Required by work order','work_order_line') into demand_row;
    else
      consume_from_reservation:=least(qty,own_reserved);
      if consume_from_reservation>0 then
        update public.inventory_reservations ir
        set quantity=case when quantity>consume_from_reservation then quantity-consume_from_reservation else quantity end,
            status=case when quantity<=consume_from_reservation then 'consumed' else status end,
            consumed_at=case when quantity<=consume_from_reservation then now() else consumed_at end,
            updated_at=now()
        where ir.id in (
          select ir2.id from public.inventory_reservations ir2 join public.part_demands d2 on d2.id=ir2.demand_id
          where ir2.inventory_item_id=item.id and ir2.status='reserved' and d2.driver_type='work_order' and d2.ticket_id=new.ticket_id
          order by ir2.reserved_at limit 1
        );
      end if;
      update public.inventory_items set quantity_on_hand=quantity_on_hand-qty,updated_at=now() where id=new.inventory_item_id;
      insert into public.inventory_transactions(location_id,inventory_item_id,ticket_id,work_order_item_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id)
        select location_id,new.inventory_item_id,new.ticket_id,new.id,'consume',-qty,new.unit_cost_cents,'Added to work order',auth.uid() from public.repair_tickets where id=new.ticket_id;
      update public.part_demands set status='fulfilled',quantity_reserved=0,updated_at=now()
      where driver_type='work_order' and ticket_id=new.ticket_id and inventory_item_id=new.inventory_item_id and status not in ('fulfilled','cancelled');
    end if;
  end if;

  perform public.recalculate_ticket_totals(target);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

-- Existing AFTER trigger remains attached to this function.
