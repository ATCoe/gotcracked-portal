-- GotCracked Portal: repair workflow integrity hardening.
-- Aligns legacy Ready for Pickup records with checkout, makes sale finalization
-- compatible with the controlled workflow guard, and closes cross-record integrity gaps.

-- The unique partial index added by 0041 supersedes the older non-unique index
-- for every normalized phone value used by Portal lookups.
drop index if exists public.customers_location_phone_normalized_idx;

create or replace function public.enforce_repair_relationship_integrity()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  customer_location uuid;
  device_customer uuid;
  assignee record;
begin
  select c.location_id into customer_location
  from public.customers c
  where c.id=new.customer_id;

  if customer_location is null then
    raise exception 'Repair customer was not found.';
  end if;
  if customer_location is distinct from new.location_id then
    raise exception 'Repair customer is outside the work-order location.';
  end if;

  select d.customer_id into device_customer
  from public.devices d
  where d.id=new.device_id;

  if device_customer is null then
    raise exception 'Repair device was not found.';
  end if;
  if device_customer is distinct from new.customer_id then
    raise exception 'Repair device does not belong to this customer.';
  end if;

  if new.assigned_user_id is not null then
    select p.id,p.location_id,p.active
      into assignee
    from public.profiles p
    where p.id=new.assigned_user_id;

    if assignee.id is null then
      raise exception 'Assigned staff member was not found.';
    end if;
    if assignee.location_id is distinct from new.location_id then
      raise exception 'Assigned staff member is outside the work-order location.';
    end if;
    if not coalesce(assignee.active,false) then
      raise exception 'Assigned staff member is inactive.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists repair_relationship_integrity_guard on public.repair_tickets;
create trigger repair_relationship_integrity_guard
before insert or update of location_id,customer_id,device_id,assigned_user_id
on public.repair_tickets
for each row execute function public.enforce_repair_relationship_integrity();

create or replace function public.guard_new_work_order_prepayment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  required_now boolean := true;
  paid public.payment_requests;
begin
  -- Trusted server/service-role imports do not have an auth.uid(). Browser staff
  -- creation is always subject to the configured pre-payment policy.
  if auth.uid() is null then return new; end if;

  select coalesce(prepay_required_default,true) into required_now
  from public.business_settings where location_id=new.location_id;
  new.prepay_required:=required_now;
  if not required_now then return new; end if;

  if new.payment_request_id is null then
    raise exception 'Pre-payment is required before a work order can be created';
  end if;

  select * into paid
  from public.payment_requests
  where id=new.payment_request_id
    and location_id=new.location_id
    and status='verified'
    and amount_verified_cents>=amount_due_cents
    and ticket_id is null
  for update;

  if paid.id is null then
    raise exception 'The selected pre-payment has not been verified or has already been used';
  end if;
  if paid.customer_id is not null and paid.customer_id is distinct from new.customer_id then
    raise exception 'The selected pre-payment belongs to a different customer';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_repair_status_flow()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_status text:=old.status::text;
  new_status text:=new.status::text;
  allowed boolean:=false;
begin
  if new.status is not distinct from old.status then return new; end if;

  if old_status='awaiting_customer' and new_status='awaiting_repair'
     and coalesce(public.has_permission('repairs.intake'),false)
     and new.intake_session_id is not null and new.arrived_at is not null then
    return new;
  end if;

  if coalesce(current_setting('app.repair_status_advance',true),'')<>'allowed' then
    raise exception 'Repair stages must be advanced through the controlled workflow';
  end if;

  if new_status='repaired' and new.ready_for_pickup_at is null then
    new.ready_for_pickup_at:=now();
  end if;

  if new_status='awaiting_callback'
     and old_status not in ('repaired','sale_complete','unrepairable','customer_declined','abandoned','completed','cancelled') then
    new.status_before_callback:=old.status;
    return new;
  end if;

  if old_status='awaiting_callback' then
    allowed:=new.status=old.status_before_callback or new_status in ('unrepairable','customer_declined','cancelled');
    if not allowed then
      raise exception 'Awaiting callback must return to the paused stage or close with a documented outcome';
    end if;
    return new;
  end if;

  allowed:=case old_status
    when 'checked_in' then new_status in ('awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_approval' then new_status in ('awaiting_repair','need_to_order_parts','awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'waiting_on_parts' then new_status in ('awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_diagnosis' then new_status in ('diagnostic_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'in_repair' then new_status in ('repair_in_progress','need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'ready_for_pickup' then
      case
        when new_status='sale_complete' then new.payment_status in ('paid','waived') and new.paid_at is not null
        else new_status in ('repaired','unrepairable','customer_declined','completed','cancelled')
      end
    when 'awaiting_repair' then new_status in ('need_to_order_parts','awaiting_parts','diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'need_to_order_parts' then new_status in ('awaiting_parts','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'awaiting_parts' then new_status in ('diagnostic_in_progress','repair_in_progress','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'diagnostic_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','repair_in_progress','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'repair_in_progress' then new_status in ('need_to_order_parts','awaiting_parts','quality_inspection','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'quality_inspection' then new_status in ('diagnostic_in_progress','repair_in_progress','repaired','awaiting_callback','unrepairable','customer_declined','cancelled')
    when 'repaired' then
      case
        when new_status='sale_complete' then new.payment_status in ('paid','waived') and new.paid_at is not null
        when new_status='abandoned' then public.current_staff_role() in ('owner','manager')
          and now()>=coalesce(old.ready_for_pickup_at,old.updated_at)
            +coalesce((select abandoned_after_days from public.business_settings where location_id=old.location_id),30)*interval '1 day'
        else false
      end
    else false
  end;

  if not allowed then
    raise exception 'Invalid repair stage transition from % to %',replace(old_status,'_',' '),replace(new_status,'_',' ');
  end if;
  return new;
end;
$$;

create or replace function public.confirm_repair_payment(
  target_ticket uuid,
  paid_amount_cents integer,
  paid_method text,
  paid_reference text default null,
  payment_note text default null
)
returns public.repair_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.repair_tickets;
  ticket_total integer;
begin
  if auth.uid() is not null and not coalesce(public.has_permission('ready_pickup.checkout'),false) then
    raise exception 'You do not have permission to complete pickup.';
  end if;
  if paid_method not in ('cash','card','online','other','warranty','no_charge') then
    raise exception 'Choose a valid payment method';
  end if;

  select total_cents into ticket_total
  from public.repair_tickets
  where id=target_ticket
    and location_id=public.current_location_id()
    and status::text in ('repaired','ready_for_pickup');

  if ticket_total is null then
    raise exception 'Only a ready-for-pickup ticket can be paid and closed';
  end if;
  if paid_method not in ('warranty','no_charge') and coalesce(paid_amount_cents,0)<ticket_total then
    raise exception 'The confirmed payment must cover the work-order total';
  end if;

  update public.repair_tickets
  set payment_status=case when paid_method in ('warranty','no_charge') then 'waived' else 'paid' end,
      amount_paid_cents=case when paid_method in ('warranty','no_charge') then greatest(coalesce(paid_amount_cents,0),0) else greatest(coalesce(paid_amount_cents,0),0) end,
      payment_method=paid_method,
      payment_reference=nullif(btrim(paid_reference),''),
      paid_at=now(),
      payment_confirmed_by=auth.uid()
  where id=target_ticket and location_id=public.current_location_id()
  returning * into saved;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility,attachments)
  values(
    target_ticket,
    auth.uid(),
    'payment_confirmed',
    concat('Payment confirmed · ',replace(paid_method,'_',' '),case when nullif(btrim(payment_note),'') is not null then concat(' · ',btrim(payment_note)) else '' end),
    'internal',
    '[]'::jsonb
  );

  return saved;
end;
$$;

create or replace function public.finalize_external_pos_sale(
  target_ticket uuid,
  pos_reference text default null,
  pos_tender text default 'external_pos',
  paid_amount_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  t public.repair_tickets;
  c public.customers;
  d public.devices;
  r public.receipts;
  biz_date date;
  expected integer;
  paid integer;
  tender text:=coalesce(nullif(trim(pos_tender),''),'external_pos');
  waived boolean:=false;
  lines jsonb;
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then
    raise exception 'Checkout permission required.';
  end if;

  select * into t
  from public.repair_tickets
  where id=target_ticket and location_id=loc
  for update;

  if not found then raise exception 'Work order not found.'; end if;
  if t.status::text not in ('repaired','ready_for_pickup') then
    raise exception 'Work order must be Ready for Pickup before Sale Complete.';
  end if;
  if tender not in ('external_pos','external_pos_card','external_pos_cash','external_pos_other','cash','card','online','other','warranty','no_charge') then
    raise exception 'Choose a valid payment method.';
  end if;

  waived:=tender in ('warranty','no_charge');
  expected:=greatest(coalesce(t.total_cents,0),0);
  paid:=case when waived then greatest(coalesce(paid_amount_cents,0),0) else coalesce(paid_amount_cents,expected) end;
  if paid<0 then raise exception 'Paid amount cannot be negative.'; end if;
  if not waived and paid<>expected then
    raise exception 'External POS amount must match the work-order total exactly.';
  end if;
  if exists(select 1 from public.receipts where ticket_id=t.id) then
    raise exception 'This work order already has a completed sale receipt.';
  end if;

  select * into c from public.customers where id=t.customer_id and location_id=loc;
  if c.id is null then raise exception 'Customer record is unavailable for this work order.'; end if;
  select * into d from public.devices where id=t.device_id and customer_id=t.customer_id;
  if d.id is null then raise exception 'Device record is unavailable for this work order.'; end if;

  biz_date:=public.current_business_date(loc);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type',w.item_type,
    'sku',w.sku,
    'description',w.description,
    'quantity',w.quantity,
    'unit_price_cents',coalesce(w.unit_price_cents,0),
    'unit_cost_cents',coalesce(w.unit_cost_cents,0),
    'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,
    'part_pricing_mode',w.part_pricing_mode,
    'auto_pricing_line',w.auto_pricing_line,
    'pricing_metadata',w.pricing_metadata
  ) order by w.created_at),'[]'::jsonb) into lines
  from public.work_order_items w
  where w.ticket_id=t.id
    and not (w.item_type='part' and w.part_pricing_mode='bundled_service');

  -- This is the controlled atomic checkout path. Set the transaction-local guard
  -- before changing status so both canonical `repaired` and legacy
  -- `ready_for_pickup` rows can safely advance to Sale Complete.
  perform set_config('app.repair_status_advance','allowed',true);

  update public.repair_tickets
  set payment_status=case when waived then 'waived' else 'paid' end,
      amount_paid_cents=paid,
      payment_method=tender,
      payment_reference=nullif(trim(pos_reference),''),
      paid_at=now(),
      payment_confirmed_by=auth.uid(),
      status='sale_complete',
      pickup_at=coalesce(pickup_at,now()),
      completed_at=coalesce(completed_at,now()),
      sale_completed_at=now(),
      sale_business_date=biz_date,
      updated_at=now()
  where id=t.id;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(
    t.id,
    auth.uid(),
    'sale_complete',
    'External POS sale confirmed'||case when nullif(trim(pos_reference),'') is not null then ' · POS ref '||trim(pos_reference) else '' end,
    'internal'
  );

  insert into public.receipts(
    location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,
    subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by
  ) values(
    loc,t.id,t.ticket_number,biz_date,t.customer_id,
    trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),
    nullif(trim(c.email),''),
    nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),
    coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,paid,tender,nullif(trim(pos_reference),''),lines,auth.uid()
  ) returning * into r;

  return jsonb_build_object(
    'receipt_id',r.id,
    'receipt_number',r.receipt_number,
    'ticket_id',r.ticket_id,
    'ticket_number',r.ticket_number,
    'business_date',r.business_date,
    'customer_name',r.customer_name,
    'customer_email',r.customer_email,
    'device_description',r.device_description,
    'subtotal_cents',r.subtotal_cents,
    'tax_cents',r.tax_cents,
    'total_cents',r.total_cents,
    'amount_paid_cents',r.amount_paid_cents,
    'payment_method',r.payment_method,
    'payment_reference',r.payment_reference,
    'line_items',r.line_items,
    'created_at',r.created_at
  );
end;
$$;

revoke all on function public.enforce_repair_relationship_integrity() from public,anon,authenticated;
revoke all on function public.guard_new_work_order_prepayment() from public,anon,authenticated;
revoke all on function public.enforce_repair_status_flow() from public,anon,authenticated;
revoke all on function public.confirm_repair_payment(uuid,integer,text,text,text) from public,anon;
revoke all on function public.finalize_external_pos_sale(uuid,text,text,integer) from public,anon;
grant execute on function public.confirm_repair_payment(uuid,integer,text,text,text) to authenticated;
grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;
