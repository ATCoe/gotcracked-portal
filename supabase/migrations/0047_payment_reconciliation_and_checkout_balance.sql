-- GotCracked Portal: reconcile verified intake prepayments with final checkout.
-- The database is authoritative for the remaining balance. Browser code cannot
-- choose to ignore a linked prepayment or charge the original total twice.

alter table public.receipts
  add column if not exists prepayment_amount_cents integer not null default 0,
  add column if not exists prepayment_method text,
  add column if not exists prepayment_reference text,
  add column if not exists checkout_amount_cents integer not null default 0,
  add column if not exists checkout_payment_method text,
  add column if not exists checkout_payment_reference text;

alter table public.receipts
  drop constraint if exists receipts_payment_breakdown_nonnegative;
alter table public.receipts
  add constraint receipts_payment_breakdown_nonnegative
  check (prepayment_amount_cents >= 0 and checkout_amount_cents >= 0);

create or replace function public.get_checkout_payment_summary(target_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  loc uuid := public.current_location_id();
  t public.repair_tickets;
  p public.payment_requests;
  total_due integer := 0;
  prepaid integer := 0;
  balance integer := 0;
  overpayment integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then
    raise exception 'Checkout permission required.';
  end if;

  select * into t
  from public.repair_tickets
  where id = target_ticket and location_id = loc;
  if not found then raise exception 'Work order not found.'; end if;

  total_due := greatest(coalesce(t.total_cents,0),0);

  if t.payment_request_id is not null then
    select * into p
    from public.payment_requests
    where id = t.payment_request_id
      and location_id = loc
      and ticket_id = t.id
      and status = 'verified';
    if p.id is not null then prepaid := greatest(coalesce(p.amount_verified_cents,0),0); end if;
  end if;

  if coalesce(t.prepay_required,false) and t.payment_request_id is not null and p.id is null then
    raise exception 'The work order prepayment is no longer verified.';
  end if;

  overpayment := greatest(prepaid - total_due,0);
  balance := greatest(total_due - prepaid,0);

  return jsonb_build_object(
    'ticket_id', t.id,
    'total_cents', total_due,
    'prepayment_amount_cents', prepaid,
    'prepayment_method', case when p.id is null then null else p.payment_method end,
    'prepayment_reference', case when p.id is null then null else p.payment_reference end,
    'balance_due_cents', balance,
    'overpayment_cents', overpayment,
    'payment_request_id', t.payment_request_id,
    'prepay_required', coalesce(t.prepay_required,false)
  );
end;
$$;

create or replace function public.finalize_external_pos_sale(
  target_ticket uuid,
  pos_reference text default null,
  pos_tender text default 'external_pos_card',
  paid_amount_cents integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  loc uuid := public.current_location_id();
  t public.repair_tickets;
  c public.customers;
  d public.devices;
  p public.payment_requests;
  r public.receipts;
  biz_date date;
  expected integer := 0;
  prepaid integer := 0;
  balance_due integer := 0;
  checkout_paid integer := 0;
  tender text := coalesce(nullif(trim(pos_tender),''),'external_pos_card');
  reference_text text := nullif(trim(coalesce(pos_reference,'')),'');
  combined_method text;
  combined_reference text;
  lines jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then
    raise exception 'Checkout permission required.';
  end if;

  select * into t
  from public.repair_tickets
  where id = target_ticket and location_id = loc
  for update;
  if not found then raise exception 'Work order not found.'; end if;

  if t.status::text not in ('repaired','ready_for_pickup') then
    raise exception 'Work order must be Ready for Pickup before Sale Complete.';
  end if;

  if exists(select 1 from public.receipts where ticket_id = t.id) then
    raise exception 'This work order already has a completed sale receipt.';
  end if;

  expected := greatest(coalesce(t.total_cents,0),0);

  if t.payment_request_id is not null then
    select * into p
    from public.payment_requests
    where id = t.payment_request_id
      and location_id = loc
      and ticket_id = t.id
      and status = 'verified'
    for update;
    if p.id is not null then prepaid := greatest(coalesce(p.amount_verified_cents,0),0); end if;
  end if;

  if coalesce(t.prepay_required,false) then
    if t.payment_request_id is null then
      raise exception 'This work order requires a verified prepayment.';
    end if;
    if p.id is null then
      raise exception 'The linked prepayment has not been verified.';
    end if;
  end if;

  if prepaid > expected then
    raise exception 'Verified prepayment exceeds the final work-order total. Resolve the overpayment before completing the sale.';
  end if;

  balance_due := expected - prepaid;
  checkout_paid := coalesce(paid_amount_cents,balance_due);

  if checkout_paid < 0 then raise exception 'Paid amount cannot be negative.'; end if;
  if checkout_paid <> balance_due then
    raise exception 'Checkout amount must equal the remaining balance after verified prepayment.';
  end if;

  if balance_due > 0 then
    if tender not in ('external_pos_card','external_pos_cash','external_pos_other') then
      raise exception 'Choose a valid external POS tender for the remaining balance.';
    end if;
    if reference_text is null then
      raise exception 'Enter the external POS receipt or transaction reference.';
    end if;
  else
    tender := 'prepaid';
    reference_text := null;
  end if;

  select * into c from public.customers where id = t.customer_id;
  select * into d from public.devices where id = t.device_id;
  biz_date := public.current_business_date(loc);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type',w.item_type,'sku',w.sku,'description',w.description,'quantity',w.quantity,
    'unit_price_cents',coalesce(w.unit_price_cents,0),'unit_cost_cents',coalesce(w.unit_cost_cents,0),
    'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,
    'part_pricing_mode',w.part_pricing_mode
  ) order by w.created_at),'[]'::jsonb) into lines
  from public.work_order_items w where w.ticket_id = t.id;

  combined_method := case
    when prepaid > 0 and checkout_paid > 0 then 'split'
    when prepaid > 0 then coalesce(p.payment_method,'prepaid')
    else tender
  end;
  combined_reference := case
    when prepaid > 0 and checkout_paid > 0 then concat_ws(' | ',
      case when p.payment_reference is not null then 'Prepay ' || p.payment_reference end,
      case when reference_text is not null then 'Checkout ' || reference_text end)
    when prepaid > 0 then p.payment_reference
    else reference_text
  end;

  update public.repair_tickets set
    payment_status = 'paid',
    amount_paid_cents = expected,
    payment_method = combined_method,
    payment_reference = combined_reference,
    paid_at = now(),
    status = 'sale_complete',
    pickup_at = coalesce(pickup_at,now()),
    completed_at = coalesce(completed_at,now()),
    sale_completed_at = now(),
    sale_business_date = biz_date,
    updated_at = now()
  where id = t.id;

  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility)
  values(
    t.id,auth.uid(),'sale_complete',
    'Sale complete · total ' || (expected::numeric/100)::text ||
      ' · prepayment ' || (prepaid::numeric/100)::text ||
      ' · checkout ' || (checkout_paid::numeric/100)::text,
    'internal'
  );

  insert into public.receipts(
    location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,
    subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by,
    prepayment_amount_cents,prepayment_method,prepayment_reference,
    checkout_amount_cents,checkout_payment_method,checkout_payment_reference
  ) values(
    loc,t.id,t.ticket_number,biz_date,t.customer_id,
    trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),nullif(trim(c.email),''),
    nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),
    coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,expected,
    combined_method,combined_reference,lines,auth.uid(),
    prepaid,case when p.id is null then null else p.payment_method end,case when p.id is null then null else p.payment_reference end,
    checkout_paid,case when checkout_paid > 0 then tender else null end,case when checkout_paid > 0 then reference_text else null end
  ) returning * into r;

  return jsonb_build_object(
    'receipt_id',r.id,'receipt_number',r.receipt_number,'ticket_id',r.ticket_id,'ticket_number',r.ticket_number,
    'business_date',r.business_date,'customer_name',r.customer_name,'customer_email',r.customer_email,
    'device_description',r.device_description,'subtotal_cents',r.subtotal_cents,'tax_cents',r.tax_cents,
    'total_cents',r.total_cents,'amount_paid_cents',r.amount_paid_cents,'payment_method',r.payment_method,
    'payment_reference',r.payment_reference,'line_items',r.line_items,'created_at',r.created_at,
    'prepayment_amount_cents',r.prepayment_amount_cents,'prepayment_method',r.prepayment_method,
    'prepayment_reference',r.prepayment_reference,'checkout_amount_cents',r.checkout_amount_cents,
    'checkout_payment_method',r.checkout_payment_method,'checkout_payment_reference',r.checkout_payment_reference
  );
end;
$$;

revoke all on function public.get_checkout_payment_summary(uuid) from public, anon;
revoke all on function public.finalize_external_pos_sale(uuid,text,text,integer) from public, anon;
grant execute on function public.get_checkout_payment_summary(uuid) to authenticated;
grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;
