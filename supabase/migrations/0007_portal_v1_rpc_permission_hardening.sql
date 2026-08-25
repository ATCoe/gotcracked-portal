-- GotCracked Portal 1.0 final operational RPC permission hardening.
-- Aligns SECURITY DEFINER workflow helpers with the Portal 1.0 permission model
-- and safely supports Awaiting Customer -> Awaiting Repair physical intake.

-- ---------------------------------------------------------------------------
-- Repair notes/status/payment/work-order mutation
-- ---------------------------------------------------------------------------

create or replace function public.add_repair_update(
  target_ticket uuid,
  update_note text,
  update_attachments jsonb default '[]'::jsonb,
  update_visibility text default 'internal'
) returns public.ticket_events
language plpgsql security definer set search_path = public as $$
declare
  saved public.ticket_events;
begin
  if auth.uid() is not null and not (
    coalesce(public.has_permission('repairs.workflow'), false)
    or coalesce(public.has_permission('repairs.intake'), false)
    or coalesce(public.has_permission('ready_pickup.checkout'), false)
  ) then
    raise exception 'You do not have permission to add repair updates.';
  end if;
  if not exists (
    select 1 from public.repair_tickets
    where id = target_ticket and location_id = public.current_location_id()
  ) then raise exception 'Repair was not found'; end if;
  if update_visibility not in ('internal','customer') then raise exception 'Invalid update visibility'; end if;
  if nullif(btrim(update_note),'') is null and coalesce(jsonb_array_length(update_attachments),0)=0 then
    raise exception 'Add a note or photo';
  end if;
  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility,attachments)
  values(
    target_ticket,
    auth.uid(),
    case when update_visibility='customer' then 'customer_update' else 'repair_update' end,
    nullif(btrim(update_note),''),
    update_visibility,
    coalesce(update_attachments,'[]'::jsonb)
  ) returning * into saved;
  return saved;
end; $$;

create or replace function public.advance_repair_status(
  target_ticket uuid,
  next_status public.ticket_status,
  update_note text,
  update_attachments jsonb default '[]'::jsonb,
  update_visibility text default 'internal'
) returns public.repair_tickets
language plpgsql security definer set search_path = public as $$
declare
  saved public.repair_tickets;
  current_ticket public.repair_tickets;
begin
  if nullif(btrim(update_note),'') is null then
    raise exception 'A progress note is required to change repair stage';
  end if;

  select * into current_ticket
  from public.repair_tickets
  where id = target_ticket and location_id = public.current_location_id()
  for update;
  if current_ticket.id is null then raise exception 'Repair was not found'; end if;

  if auth.uid() is not null then
    if current_ticket.status::text='awaiting_customer' and next_status::text='awaiting_repair' then
      if not coalesce(public.has_permission('repairs.intake'), false) then
        raise exception 'You do not have permission to receive this device.';
      end if;
    elsif next_status::text='sale_complete' then
      if not coalesce(public.has_permission('ready_pickup.checkout'), false) then
        raise exception 'You do not have permission to complete pickup.';
      end if;
    elsif not coalesce(public.has_permission('repairs.workflow'), false) then
      raise exception 'You do not have permission to update repair workflow.';
    end if;
  end if;

  perform set_config('app.repair_status_advance','allowed',true);
  update public.repair_tickets
  set status = next_status
  where id = target_ticket and location_id = public.current_location_id()
  returning * into saved;
  if saved.id is null then raise exception 'Repair was not found'; end if;
  if next_status::text='sale_complete' then
    update public.repair_tickets set completed_at=now()
    where id=target_ticket returning * into saved;
  end if;
  perform public.add_repair_update(target_ticket,update_note,update_attachments,update_visibility);
  return saved;
end; $$;

create or replace function public.confirm_repair_payment(
  target_ticket uuid,
  paid_amount_cents integer,
  paid_method text,
  paid_reference text default null,
  payment_note text default null
) returns public.repair_tickets
language plpgsql security definer set search_path = public as $$
declare
  saved public.repair_tickets;
  ticket_total integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('ready_pickup.checkout'), false) then
    raise exception 'You do not have permission to complete pickup.';
  end if;
  if paid_method not in ('cash','card','online','other','warranty','no_charge') then
    raise exception 'Choose a valid payment method';
  end if;
  select total_cents into ticket_total
  from public.repair_tickets
  where id=target_ticket and location_id=public.current_location_id() and status='repaired';
  if ticket_total is null then raise exception 'Only a repaired ticket can be paid and closed'; end if;
  if paid_method not in ('warranty','no_charge') and coalesce(paid_amount_cents,0) < ticket_total then
    raise exception 'The confirmed payment must cover the work-order total';
  end if;
  update public.repair_tickets set
    payment_status=case when paid_method in ('warranty','no_charge') then 'waived' else 'paid' end,
    amount_paid_cents=greatest(coalesce(paid_amount_cents,0),0),
    payment_method=paid_method,
    payment_reference=nullif(btrim(paid_reference),''),
    paid_at=now(),
    payment_confirmed_by=auth.uid()
  where id=target_ticket and location_id=public.current_location_id()
  returning * into saved;
  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility,attachments)
  values(
    target_ticket,auth.uid(),'payment_confirmed',
    concat('Payment confirmed · ',replace(paid_method,'_',' '),
      case when nullif(btrim(payment_note),'') is not null then concat(' · ',btrim(payment_note)) else '' end),
    'internal','[]'::jsonb
  );
  return saved;
end; $$;

create or replace function public.save_work_order(
  target_ticket uuid,
  ticket_changes jsonb,
  new_line jsonb default null,
  manual_discount_cents integer default 0,
  manual_discount_reason text default null,
  entered_promo_code text default null
) returns public.repair_tickets
language plpgsql security definer set search_path = public as $$
declare
  saved public.repair_tickets;
  line_type text;
  shipping_fee integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('repairs.workflow'), false) then
    raise exception 'You do not have permission to modify this work order.';
  end if;
  select * into saved from public.repair_tickets
  where id=target_ticket and location_id=public.current_location_id()
  for update;
  if saved.id is null then raise exception 'Work order was not found for your location'; end if;
  if nullif(ticket_changes->>'status','') is not null
     and (ticket_changes->>'status') is distinct from saved.status::text then
    raise exception 'Use the controlled workflow to change repair status.';
  end if;

  update public.repair_tickets set
    assigned_user_id = case when ticket_changes ? 'assigned_user_id' and nullif(ticket_changes->>'assigned_user_id','') is not null then (ticket_changes->>'assigned_user_id')::uuid else null end,
    priority = coalesce(nullif(ticket_changes->>'priority',''),priority),
    public_notes = nullif(ticket_changes->>'public_notes',''),
    internal_notes = nullif(ticket_changes->>'internal_notes',''),
    intake_method = coalesce(nullif(ticket_changes->>'intake_method',''),intake_method),
    shipping_status = coalesce(nullif(ticket_changes->>'shipping_status',''),shipping_status),
    shipping_address = case when ticket_changes ? 'shipping_address' then ticket_changes->'shipping_address' else shipping_address end,
    inbound_carrier = case when ticket_changes ? 'inbound_carrier' then nullif(ticket_changes->>'inbound_carrier','') else inbound_carrier end,
    inbound_tracking = case when ticket_changes ? 'inbound_tracking' then nullif(ticket_changes->>'inbound_tracking','') else inbound_tracking end,
    outbound_carrier = case when ticket_changes ? 'outbound_carrier' then nullif(ticket_changes->>'outbound_carrier','') else outbound_carrier end,
    outbound_tracking = case when ticket_changes ? 'outbound_tracking' then nullif(ticket_changes->>'outbound_tracking','') else outbound_tracking end,
    shipping_label_url = case when ticket_changes ? 'shipping_label_url' then nullif(ticket_changes->>'shipping_label_url','') else shipping_label_url end,
    package_weight_oz = case when ticket_changes ? 'package_weight_oz' then nullif(ticket_changes->>'package_weight_oz','')::numeric else package_weight_oz end,
    insurance_amount_cents = case when ticket_changes ? 'insurance_amount_cents' then coalesce((ticket_changes->>'insurance_amount_cents')::integer,0) else insurance_amount_cents end,
    shipping_charge_cents = case when ticket_changes ? 'shipping_charge_cents' then coalesce((ticket_changes->>'shipping_charge_cents')::integer,0) else shipping_charge_cents end,
    shipped_at = case when coalesce(ticket_changes->>'shipping_status','')='outbound_in_transit' and shipped_at is null then now() else shipped_at end,
    delivered_at = case when coalesce(ticket_changes->>'shipping_status','')='delivered' and delivered_at is null then now() else delivered_at end
  where id=target_ticket returning * into saved;

  if new_line is not null and coalesce(new_line->>'item_type','') <> '' then
    line_type := new_line->>'item_type';
    insert into public.work_order_items(ticket_id,item_type,inventory_item_id,service_id,quantity,unit_price_cents,taxable,inventory_applied,price_overridden,created_by,description)
    values(
      target_ticket,line_type,
      case when line_type='part' then (new_line->>'catalog_id')::uuid end,
      case when line_type='service' then (new_line->>'catalog_id')::uuid end,
      coalesce((new_line->>'quantity')::numeric,1),
      coalesce((new_line->>'unit_price_cents')::integer,0),
      coalesce((new_line->>'taxable')::boolean,true),
      coalesce((new_line->>'inventory_applied')::boolean,false),
      coalesce((new_line->>'price_overridden')::boolean,false),
      auth.uid(),
      coalesce(new_line->>'description','Catalog item')
    );
  end if;

  if ticket_changes ? 'shipping_charge_cents' then
    shipping_fee := coalesce((ticket_changes->>'shipping_charge_cents')::integer,0);
    delete from public.work_order_items
    where ticket_id=target_ticket and item_type='fee' and description='Shipping';
    if shipping_fee > 0 then
      insert into public.work_order_items(ticket_id,item_type,description,quantity,unit_price_cents,taxable,price_overridden,created_by)
      values(target_ticket,'fee','Shipping',1,shipping_fee,true,true,auth.uid());
    end if;
  end if;

  if coalesce(manual_discount_cents,0) > 0 then
    insert into public.work_order_items(ticket_id,item_type,description,quantity,unit_price_cents,taxable,discount_reason,price_overridden,created_by)
    values(target_ticket,'discount',coalesce(nullif(btrim(manual_discount_reason),''),'Manual discount'),1,-manual_discount_cents,false,manual_discount_reason,true,auth.uid());
  end if;
  if nullif(btrim(entered_promo_code),'') is not null then
    perform public.apply_promo_code(target_ticket,entered_promo_code);
  end if;
  perform public.recalculate_ticket_totals(target_ticket);
  select * into saved from public.repair_tickets where id=target_ticket;
  return saved;
end; $$;

create or replace function public.apply_promo_code(target_ticket uuid, entered_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  promo public.promo_codes;
  eligible integer;
  discount integer;
  new_line uuid;
begin
  if auth.uid() is not null and not (
    coalesce(public.has_permission('repairs.workflow'),false)
    or coalesce(public.has_permission('ready_pickup.checkout'),false)
    or coalesce(public.has_permission('pricing.override'),false)
  ) then
    raise exception 'You do not have permission to apply promotions to this work order.';
  end if;
  select p.* into promo
  from public.promo_codes p
  join public.repair_tickets t on t.location_id=p.location_id
  where t.id=target_ticket and t.location_id=public.current_location_id()
    and upper(p.code)=upper(btrim(entered_code))
    and p.active
    and (p.starts_at is null or p.starts_at <= now())
    and (p.ends_at is null or p.ends_at >= now())
    and (p.usage_limit is null or p.times_used < p.usage_limit)
  for update;
  if promo.id is null then raise exception 'Promo code is invalid, expired, or exhausted'; end if;
  if exists(select 1 from public.work_order_items where ticket_id=target_ticket and promo_code_id=promo.id) then
    raise exception 'Promo code is already applied';
  end if;
  select coalesce(round(sum(quantity*unit_price_cents))::integer,0) into eligible
  from public.work_order_items where ticket_id=target_ticket and item_type <> 'discount';
  if promo.discount_type='percent' then
    discount := round(eligible * promo.discount_value / 100)::integer;
  else
    discount := round(promo.discount_value * 100)::integer;
  end if;
  if promo.maximum_discount_cents is not null then discount := least(discount,promo.maximum_discount_cents); end if;
  discount := least(discount,eligible);
  if discount <= 0 then raise exception 'No eligible subtotal for this promo code'; end if;
  insert into public.work_order_items(ticket_id,item_type,sku,description,quantity,unit_price_cents,taxable,discount_reason,promo_code_id,created_by)
  values(target_ticket,'discount',upper(promo.code),'Promo: '||upper(promo.code),1,-discount,false,promo.description,promo.id,auth.uid())
  returning id into new_line;
  update public.promo_codes set times_used=times_used+1 where id=promo.id;
  return new_line;
end; $$;

-- ---------------------------------------------------------------------------
-- Inventory and cycle-count RPCs
-- ---------------------------------------------------------------------------

create or replace function public.adjust_inventory(target_item uuid, quantity_delta integer, adjustment_note text)
returns public.inventory_items
language plpgsql security definer set search_path = public as $$
declare saved public.inventory_items;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception 'You do not have permission to adjust inventory.';
  end if;
  if quantity_delta = 0 then raise exception 'Adjustment cannot be zero'; end if;
  update public.inventory_items set quantity_on_hand=quantity_on_hand+quantity_delta
  where id=target_item and location_id=public.current_location_id() and quantity_on_hand+quantity_delta>=0
  returning * into saved;
  if saved.id is null then raise exception 'Inventory item was not found or adjustment would make stock negative'; end if;
  insert into public.inventory_transactions(location_id,inventory_item_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id)
  values(saved.location_id,saved.id,case when quantity_delta>0 then 'receive' else 'adjustment' end,quantity_delta,saved.cost_cents,nullif(btrim(adjustment_note),''),auth.uid());
  return saved;
end; $$;

create or replace function public.write_off_inventory(
  target_item uuid,
  quantity_to_remove integer,
  loss_category text,
  loss_note text,
  recoverable_amount_cents integer default 0
) returns public.inventory_transactions
language plpgsql security definer set search_path = public as $$
declare
  saved_item public.inventory_items;
  saved_transaction public.inventory_transactions;
  calculated_loss integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception 'You do not have permission to write off inventory.';
  end if;
  if quantity_to_remove<=0 then raise exception 'Write-off quantity must be greater than zero'; end if;
  if loss_category not in ('damaged','broken','shrinkage','expired','return_to_vendor','other') then
    raise exception 'Choose a valid loss category';
  end if;
  if nullif(btrim(loss_note),'') is null then raise exception 'A loss note is required'; end if;
  if coalesce(recoverable_amount_cents,0)<0 then raise exception 'Recoverable amount cannot be negative'; end if;
  update public.inventory_items set quantity_on_hand=quantity_on_hand-quantity_to_remove
  where id=target_item and location_id=public.current_location_id() and quantity_on_hand>=quantity_to_remove
  returning * into saved_item;
  if saved_item.id is null then raise exception 'Item was not found or the write-off exceeds stock on hand'; end if;
  calculated_loss:=greatest(0,quantity_to_remove*coalesce(saved_item.cost_cents,0)-coalesce(recoverable_amount_cents,0));
  insert into public.inventory_transactions(location_id,inventory_item_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id,loss_category,loss_amount_cents,recoverable_amount_cents)
  values(saved_item.location_id,saved_item.id,'write_off',-quantity_to_remove,saved_item.cost_cents,btrim(loss_note),auth.uid(),loss_category,calculated_loss,coalesce(recoverable_amount_cents,0))
  returning * into saved_transaction;
  return saved_transaction;
end; $$;

create or replace function public.start_inventory_audit(audit_notes text default null)
returns public.inventory_audits
language plpgsql security definer set search_path = public as $$
declare saved public.inventory_audits;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.count'), false) then
    raise exception 'You do not have permission to start an inventory count.';
  end if;
  select * into saved from public.inventory_audits
  where location_id=public.current_location_id() and status='in_progress' limit 1;
  if saved.id is not null then return saved; end if;
  insert into public.inventory_audits(location_id,notes,started_by)
  values(public.current_location_id(),nullif(btrim(audit_notes),''),auth.uid()) returning * into saved;
  insert into public.inventory_audit_items(audit_id,inventory_item_id,expected_quantity)
  select saved.id,id,quantity_on_hand from public.inventory_items where location_id=saved.location_id and active=true;
  return saved;
end; $$;

create or replace function public.scan_inventory_audit(target_audit uuid, scanned_sku text, scan_quantity integer default 1)
returns public.inventory_audit_items
language plpgsql security definer set search_path = public as $$
declare item_id uuid; saved public.inventory_audit_items;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.count'), false) then
    raise exception 'You do not have permission to perform inventory counts.';
  end if;
  if scan_quantity<=0 then raise exception 'Scan quantity must be positive'; end if;
  if not exists(select 1 from public.inventory_audits where id=target_audit and location_id=public.current_location_id() and status='in_progress') then
    raise exception 'No active audit was found';
  end if;
  select id into item_id from public.inventory_items
  where location_id=public.current_location_id() and upper(sku)=upper(btrim(scanned_sku)) and active=true limit 1;
  if item_id is null then raise exception 'SKU was not found in active inventory'; end if;
  update public.inventory_audit_items set counted_quantity=counted_quantity+scan_quantity,last_scanned_at=now(),last_scanned_by=auth.uid()
  where audit_id=target_audit and inventory_item_id=item_id returning * into saved;
  if saved.id is null then raise exception 'Item is not part of this audit'; end if;
  return saved;
end; $$;

create or replace function public.set_inventory_audit_count(target_audit uuid, target_item uuid, new_count integer)
returns public.inventory_audit_items
language plpgsql security definer set search_path = public as $$
declare saved public.inventory_audit_items;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.count'), false) then
    raise exception 'You do not have permission to perform inventory counts.';
  end if;
  if new_count<0 then raise exception 'Count cannot be negative'; end if;
  if not exists(select 1 from public.inventory_audits where id=target_audit and location_id=public.current_location_id() and status='in_progress') then
    raise exception 'No active audit was found';
  end if;
  update public.inventory_audit_items set counted_quantity=new_count,last_scanned_at=now(),last_scanned_by=auth.uid()
  where audit_id=target_audit and inventory_item_id=target_item returning * into saved;
  if saved.id is null then raise exception 'Item is not part of this audit'; end if;
  return saved;
end; $$;

create or replace function public.complete_inventory_audit(target_audit uuid)
returns public.inventory_audits
language plpgsql security definer set search_path = public as $$
declare saved public.inventory_audits; row_item record; variance integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.count'), false) then
    raise exception 'You do not have permission to complete an inventory count.';
  end if;
  select * into saved from public.inventory_audits
  where id=target_audit and location_id=public.current_location_id() and status='in_progress' for update;
  if saved.id is null then raise exception 'No active audit was found'; end if;
  for row_item in
    select ai.*,i.cost_cents from public.inventory_audit_items ai
    join public.inventory_items i on i.id=ai.inventory_item_id
    where ai.audit_id=target_audit
  loop
    variance:=row_item.counted_quantity-row_item.expected_quantity;
    if variance<>0 then
      update public.inventory_items set quantity_on_hand=row_item.counted_quantity
      where id=row_item.inventory_item_id and location_id=saved.location_id;
      insert into public.inventory_transactions(location_id,inventory_item_id,audit_id,transaction_type,quantity_delta,unit_cost_cents,note,actor_user_id)
      values(saved.location_id,row_item.inventory_item_id,target_audit,'adjustment',variance,row_item.cost_cents,'Inventory audit variance',auth.uid());
    end if;
  end loop;
  update public.inventory_audits set status='completed',completed_by=auth.uid(),completed_at=now()
  where id=target_audit returning * into saved;
  return saved;
end; $$;

create or replace function public.cancel_inventory_audit(target_audit uuid)
returns public.inventory_audits
language plpgsql security definer set search_path = public as $$
declare saved public.inventory_audits;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('inventory.count'), false) then
    raise exception 'You do not have permission to cancel an inventory count.';
  end if;
  update public.inventory_audits set status='cancelled',completed_by=auth.uid(),completed_at=now()
  where id=target_audit and location_id=public.current_location_id() and status='in_progress'
  returning * into saved;
  if saved.id is null then raise exception 'No active audit was found'; end if;
  return saved;
end; $$;

-- ---------------------------------------------------------------------------
-- Per-user pricing override enforcement
-- ---------------------------------------------------------------------------

create or replace function public.authorize_work_order_price_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  settings public.business_settings;
  ticket_location uuid;
  catalog_part public.inventory_items;
  catalog_service public.services;
begin
  if auth.uid() is null then return new; end if;
  select t.location_id into ticket_location from public.repair_tickets t where t.id=new.ticket_id;
  select bs.* into settings from public.business_settings bs where bs.location_id=ticket_location;
  if ticket_location is null or ticket_location is distinct from public.current_location_id() then
    raise exception 'Work order is outside your assigned location';
  end if;
  if new.item_type='part' then
    select * into catalog_part from public.inventory_items
    where id=new.inventory_item_id and location_id=ticket_location and active;
    if catalog_part.id is null then raise exception 'Inventory item is unavailable'; end if;
    new.sku:=catalog_part.sku;
    new.description:=catalog_part.name;
    new.unit_cost_cents:=catalog_part.cost_cents;
    if not new.price_overridden then new.unit_price_cents:=catalog_part.sell_price_cents; end if;
  elsif new.item_type='service' then
    select * into catalog_service from public.services
    where id=new.service_id and location_id=ticket_location and active;
    if catalog_service.id is null then raise exception 'Service is unavailable'; end if;
    new.sku:=catalog_service.sku;
    new.description:=catalog_service.name;
    new.unit_cost_cents:=catalog_service.cost_cents;
    new.taxable:=catalog_service.taxable;
    if catalog_service.quote_required and not new.price_overridden then
      raise exception 'This service requires an approved price quote';
    end if;
    if not new.price_overridden then new.unit_price_cents:=catalog_service.price_cents; end if;
  end if;
  if (new.price_overridden or (new.item_type='discount' and new.promo_code_id is null))
     and not coalesce(public.has_permission('pricing.override'), false) then
    raise exception 'Pricing override permission is required for discounts and price overrides';
  end if;
  if new.price_overridden and coalesce(settings.allow_manager_price_overrides,true)=false then
    raise exception 'Price overrides are disabled in Settings';
  end if;
  if new.item_type='discount' and new.promo_code_id is null
     and coalesce(settings.allow_manager_manual_discounts,true)=false then
    raise exception 'Manual discounts are disabled in Settings';
  end if;
  if new.item_type='discount' then
    if new.unit_price_cents>=0 then raise exception 'A discount must be a negative amount'; end if;
    if coalesce(settings.require_discount_reason,true)
       and nullif(btrim(new.discount_reason),'') is null and new.promo_code_id is null then
      raise exception 'A reason is required for a manual discount';
    end if;
  elsif new.unit_price_cents<0 then
    raise exception 'Only discount lines may have a negative price';
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Safe physical arrival of a pre-created Awaiting Customer work order.
-- Front Desk/Technician intake staff may update only intake-related columns.
-- ---------------------------------------------------------------------------

create or replace function public.guard_pending_intake_arrival_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_rest jsonb;
  new_rest jsonb;
begin
  if auth.uid() is null then return new; end if;
  if coalesce(public.has_permission('repairs.workflow'), false) then return new; end if;
  if not coalesce(public.has_permission('repairs.intake'), false) then return new; end if;
  if old.status::text<>'awaiting_customer' or new.status::text<>'awaiting_repair' then return new; end if;
  if new.intake_session_id is null or new.arrived_at is null then
    raise exception 'Completed intake and arrival time are required.';
  end if;
  old_rest := to_jsonb(old) - array[
    'status','arrived_at','intake_summary','intake_session_id','customer_id','device_id',
    'customer_issue','intake_method','updated_at'
  ];
  new_rest := to_jsonb(new) - array[
    'status','arrived_at','intake_summary','intake_session_id','customer_id','device_id',
    'customer_issue','intake_method','updated_at'
  ];
  if old_rest is distinct from new_rest then
    raise exception 'Intake-only staff may only update physical intake fields on a pending arrival.';
  end if;
  return new;
end; $$;

create or replace function public.enforce_repair_status_flow()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_status text:=old.status::text;
  new_status text:=new.status::text;
  allowed boolean:=false;
begin
  if new.status is not distinct from old.status then return new; end if;

  -- Physical arrival is the one safe direct transition used by the guided
  -- intake UI. RLS + guard_pending_intake_arrival_update constrain the fields.
  if old_status='awaiting_customer' and new_status='awaiting_repair'
     and coalesce(public.has_permission('repairs.intake'),false)
     and new.intake_session_id is not null and new.arrived_at is not null then
    return new;
  end if;

  if coalesce(current_setting('app.repair_status_advance',true),'') <> 'allowed' then
    raise exception 'Repair stages must be advanced through the controlled workflow';
  end if;
  if new_status='repaired' and new.ready_for_pickup_at is null then new.ready_for_pickup_at:=now(); end if;
  if new_status='awaiting_callback' and old_status not in ('repaired','sale_complete','unrepairable','customer_declined','abandoned','completed','cancelled') then
    new.status_before_callback:=old.status;
    return new;
  end if;
  if old_status='awaiting_callback' then
    allowed:=new.status=old.status_before_callback or new_status in ('unrepairable','customer_declined','cancelled');
    if not allowed then raise exception 'Awaiting callback must return to the paused stage or close with a documented outcome'; end if;
    return new;
  end if;
  allowed:=case old_status
    when 'checked_in' then new_status in ('awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_approval' then new_status in ('awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'waiting_on_parts' then new_status in ('awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_diagnosis' then new_status in ('diagnostic_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_repair' then new_status in ('repair_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'ready_for_pickup' then new_status in ('repaired','unrepairable','customer_declined','completed','cancelled')
    when 'awaiting_repair' then new_status in ('need_to_order_parts','awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'need_to_order_parts' then new_status in ('awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_parts' then new_status in ('diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'diagnostic_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','repair_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'repair_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'quality_inspection' then new_status in ('diagnostic_in_progress','repair_in_progress','repaired','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'repaired' then case
      when new_status='sale_complete' then new.payment_status in ('paid','waived') and new.paid_at is not null
      when new_status='abandoned' then public.current_staff_role() in ('owner','manager')
        and now() >= coalesce(old.ready_for_pickup_at,old.updated_at)
          + coalesce((select abandoned_after_days from public.business_settings where location_id=old.location_id),30) * interval '1 day'
      else false end
    else false end;
  if not allowed then
    raise exception 'Invalid repair stage transition from % to %',replace(old_status,'_',' '),replace(new_status,'_',' ');
  end if;
  return new;
end; $$;

drop policy if exists "intake staff can receive pending arrivals" on public.repair_tickets;
create policy "intake staff can receive pending arrivals"
  on public.repair_tickets for update to authenticated
  using (
    location_id=public.current_location_id()
    and status::text='awaiting_customer'
    and public.has_permission('repairs.intake')
  )
  with check (
    location_id=public.current_location_id()
    and status::text='awaiting_repair'
    and intake_session_id is not null
    and arrived_at is not null
    and public.has_permission('repairs.intake')
  );

drop trigger if exists repair_pending_intake_arrival_guard on public.repair_tickets;
create trigger repair_pending_intake_arrival_guard
  before update on public.repair_tickets
  for each row execute function public.guard_pending_intake_arrival_update();

-- Internal-only helpers should not be directly callable from the browser.
revoke execute on function public.recalculate_ticket_totals(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_ticket_totals(uuid) to service_role;
revoke execute on function public.guard_pending_intake_arrival_update() from public, anon, authenticated;
revoke execute on function public.authorize_work_order_price_change() from public, anon, authenticated;
revoke execute on function public.enforce_repair_status_flow() from public, anon, authenticated;

-- Explicit browser RPC grants. CREATE OR REPLACE preserves existing ACLs, but
-- these statements document the intended authenticated surface.
grant execute on function public.add_repair_update(uuid,text,jsonb,text) to authenticated;
grant execute on function public.advance_repair_status(uuid,public.ticket_status,text,jsonb,text) to authenticated;
grant execute on function public.confirm_repair_payment(uuid,integer,text,text,text) to authenticated;
grant execute on function public.save_work_order(uuid,jsonb,jsonb,integer,text,text) to authenticated;
grant execute on function public.apply_promo_code(uuid,text) to authenticated;
grant execute on function public.adjust_inventory(uuid,integer,text) to authenticated;
grant execute on function public.write_off_inventory(uuid,integer,text,text,integer) to authenticated;
grant execute on function public.start_inventory_audit(text) to authenticated;
grant execute on function public.scan_inventory_audit(uuid,text,integer) to authenticated;
grant execute on function public.set_inventory_audit_count(uuid,uuid,integer) to authenticated;
grant execute on function public.complete_inventory_audit(uuid) to authenticated;
grant execute on function public.cancel_inventory_audit(uuid) to authenticated;
