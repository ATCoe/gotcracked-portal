-- Extend the read-only bookkeeping audit across sales ledger, payments,
-- purchase-order receiving and inventory integrity without modifying source records.

create or replace function public.compute_bookkeeping_audit_v2(p_range_start date,p_range_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $audit$
declare
  loc uuid:=public.current_location_id();
  recon jsonb;
  payload jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  if p_range_start is null or p_range_end is null or p_range_end<p_range_start or p_range_end-p_range_start>366 then raise exception 'Invalid bookkeeping audit range.'; end if;
  recon:=public.get_reconciliation_history(p_range_start,p_range_end);

  with findings as (
    select 'critical'::text severity,'sales_integrity'::text category,'missing-receipt-'||t.id::text finding_key,
      'Completed sale is missing a receipt'::text title,
      'GC-'||lpad(t.ticket_number::text,6,'0')||' is closed as a sale but has no receipt record.' detail,
      'repair_ticket'::text reference_type,t.id::text reference_id,t.total_cents expected_cents,0::integer actual_cents,t.total_cents variance_cents,'{}'::jsonb metadata
    from public.repair_tickets t
    where t.location_id=loc and t.status in ('sale_complete','completed')
      and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date) between p_range_start and p_range_end
      and not exists(select 1 from public.receipts r where r.ticket_id=t.id)

    union all
    select 'critical','sales_integrity','receipt-total-'||r.id::text,'Receipt and work-order totals do not match',
      coalesce(r.receipt_number,'Receipt')||' does not equal its linked repair total.','receipt',r.id::text,
      t.total_cents,r.total_cents,coalesce(r.total_cents,0)-coalesce(t.total_cents,0),'{}'::jsonb
    from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
    where r.location_id=loc and r.business_date between p_range_start and p_range_end and coalesce(r.total_cents,0)<>coalesce(t.total_cents,0)

    union all
    select 'warning','payments','receipt-paid-'||r.id::text,'Payment total differs between receipt and repair',
      coalesce(r.receipt_number,'Receipt')||' has a different paid amount than its repair record.','receipt',r.id::text,
      r.amount_paid_cents,t.amount_paid_cents,coalesce(t.amount_paid_cents,0)-coalesce(r.amount_paid_cents,0),'{}'::jsonb
    from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
    where r.location_id=loc and r.business_date between p_range_start and p_range_end and coalesce(r.amount_paid_cents,0)<>coalesce(t.amount_paid_cents,0)

    union all
    select 'warning','sales_integrity','receipt-date-'||r.id::text,'Receipt and repair use different business dates',
      coalesce(r.receipt_number,'Receipt')||' is posted to a different business date than its linked repair sale.','receipt',r.id::text,
      null::integer,null::integer,null::integer,jsonb_build_object('receipt_business_date',r.business_date,'repair_business_date',t.sale_business_date)
    from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
    where r.location_id=loc and r.business_date between p_range_start and p_range_end and t.sale_business_date is not null and r.business_date<>t.sale_business_date

    union all
    select case when x.ledger_count=0 then 'critical' else 'warning' end,'ledger','receipt-ledger-'||x.receipt_id::text,
      case when x.ledger_count=0 then 'Receipt is missing from the sales ledger' else 'Receipt and sales ledger do not reconcile' end,
      coalesce(x.receipt_number,'Receipt')||' does not match its posted sales-ledger net, tax, or collected amount.','receipt',x.receipt_id::text,
      x.amount_paid_cents,x.ledger_collected,x.ledger_collected-coalesce(x.amount_paid_cents,0),
      jsonb_build_object('receipt_net_cents',x.subtotal_cents,'ledger_net_cents',x.ledger_net,'receipt_tax_cents',x.tax_cents,'ledger_tax_cents',x.ledger_tax,'ledger_entries',x.ledger_count)
    from (
      select r.id receipt_id,r.receipt_number,r.subtotal_cents,r.tax_cents,r.amount_paid_cents,count(l.id)::integer ledger_count,
        coalesce(sum(l.net_sales_cents),0)::integer ledger_net,coalesce(sum(l.tax_cents),0)::integer ledger_tax,coalesce(sum(l.collected_cents),0)::integer ledger_collected
      from public.receipts r left join public.sales_ledger_entries l on l.receipt_id=r.id and l.location_id=loc and l.entry_type='sale'
      where r.location_id=loc and r.business_date between p_range_start and p_range_end
      group by r.id,r.receipt_number,r.subtotal_cents,r.tax_cents,r.amount_paid_cents
      having count(l.id)=0 or coalesce(sum(l.net_sales_cents),0)<>coalesce(r.subtotal_cents,0)
        or coalesce(sum(l.tax_cents),0)<>coalesce(r.tax_cents,0) or coalesce(sum(l.collected_cents),0)<>coalesce(r.amount_paid_cents,0)
    ) x

    union all
    select 'warning','sales_integrity','duplicate-receipts-'||x.ticket_id::text,'Multiple receipts exist for one repair',
      x.receipt_count::text||' receipts are linked to the same repair. Confirm the duplicates are intentional.','repair_ticket',x.ticket_id::text,
      null::integer,null::integer,null::integer,jsonb_build_object('receipt_count',x.receipt_count)
    from (
      select ticket_id,count(*)::integer receipt_count from public.receipts
      where location_id=loc and business_date between p_range_start and p_range_end and ticket_id is not null
      group by ticket_id having count(*)>1
    ) x

    union all
    select 'warning','payments','payment-over-ticket-'||pr.id::text,'Verified payment exceeds repair total',
      'A verified payment request is larger than the current linked repair total.','payment_request',pr.id::text,
      t.total_cents,pr.amount_verified_cents,coalesce(pr.amount_verified_cents,0)-coalesce(t.total_cents,0),'{}'::jsonb
    from public.payment_requests pr join public.repair_tickets t on t.id=pr.ticket_id
    where pr.location_id=loc and pr.status='verified' and pr.verified_at::date between p_range_start and p_range_end
      and coalesce(pr.amount_verified_cents,0)>coalesce(t.total_cents,0)

    union all
    select 'critical','purchasing','po-over-received-'||poi.id::text,'Purchase order line is over-received',
      'Received quantity exceeds ordered quantity for PO-'||lpad(po.po_number::text,6,'0')||' - '||coalesce(poi.description,'PO line')||'.','purchase_order_item',poi.id::text,
      null::integer,null::integer,null::integer,jsonb_build_object('quantity_ordered',poi.quantity_ordered,'quantity_received',poi.quantity_received,'po_number',po.po_number)
    from public.purchase_order_items poi join public.purchase_orders po on po.id=poi.purchase_order_id
    where po.location_id=loc and coalesce(po.ordered_at::date,po.created_at::date) between p_range_start and p_range_end
      and coalesce(poi.quantity_received,0)>coalesce(poi.quantity_ordered,0)

    union all
    select 'critical','inventory','missing-consume-'||w.id::text,'Applied repair part is missing inventory consumption',
      coalesce(w.description,'Part')||' is marked applied to a repair but no matching inventory consume transaction exists.','work_order_item',w.id::text,
      round(w.quantity*w.unit_cost_cents)::integer,null::integer,null::integer,jsonb_build_object('ticket_id',w.ticket_id,'inventory_item_id',w.inventory_item_id,'quantity',w.quantity)
    from public.work_order_items w join public.repair_tickets t on t.id=w.ticket_id
    where t.location_id=loc and w.item_type='part' and w.inventory_applied=true and w.inventory_item_id is not null
      and w.created_at::date between p_range_start and p_range_end
      and not exists(select 1 from public.inventory_transactions it where it.work_order_item_id=w.id and it.transaction_type='consume')

    union all
    select 'critical','inventory','inventory-balance-'||v.id::text,'Inventory commitment exceeds physical stock',
      coalesce(v.name,v.sku,'Inventory item')||' has more active reservations than physical on-hand quantity.','inventory_item',v.id::text,
      null::integer,null::integer,null::integer,jsonb_build_object('quantity_on_hand',v.quantity_on_hand,'reserved_quantity',v.reserved_quantity,'available_quantity',v.available_quantity)
    from public.inventory_commitment_summary v
    where v.location_id=loc and (coalesce(v.quantity_on_hand,0)<0 or coalesce(v.reserved_quantity,0)>coalesce(v.quantity_on_hand,0))

    union all
    select case when abs((j.value->>'portal_pos_variance_cents')::integer)>500 then 'warning' else 'info' end,
      'reconciliation','pos-variance-'||(j.value->>'business_date'),'External POS variance on '||(j.value->>'business_date'),
      'Portal-expected external sales and the printed POS total differ.','business_date',j.value->>'business_date',
      (j.value->>'portal_external_expected_cents')::integer,(j.value->>'pos_net_sales_cents')::integer,(j.value->>'portal_pos_variance_cents')::integer,'{}'::jsonb
    from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) j(value)
    where coalesce((j.value->>'portal_pos_variance_cents')::integer,0)<>0

    union all
    select case when abs((j.value->>'cash_over_short_cents')::integer)>500 then 'warning' else 'info' end,
      'cash','cash-variance-'||(j.value->>'business_date'),'Cash drawer variance on '||(j.value->>'business_date'),
      'The reconciled drawer closed with a non-zero over/short amount.','business_date',j.value->>'business_date',
      null::integer,null::integer,(j.value->>'cash_over_short_cents')::integer,'{}'::jsonb
    from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) j(value)
    where coalesce((j.value->>'cash_over_short_cents')::integer,0)<>0
  ), totals as (
    select count(*)::integer finding_count,count(*) filter(where severity='critical')::integer critical_count,
      count(*) filter(where severity='warning')::integer warning_count,count(*) filter(where severity='info')::integer info_count,
      coalesce(jsonb_agg(jsonb_build_object('severity',severity,'category',category,'finding_key',finding_key,'title',title,'detail',detail,
        'reference_type',reference_type,'reference_id',reference_id,'expected_cents',expected_cents,'actual_cents',actual_cents,
        'variance_cents',variance_cents,'metadata',metadata) order by case severity when 'critical' then 1 when 'warning' then 2 else 3 end,category,title),'[]'::jsonb) findings
    from findings
  )
  select jsonb_build_object('range_start',p_range_start,'range_end',p_range_end,'generated_at',now(),
    'critical_count',critical_count,'warning_count',warning_count,'info_count',info_count,'finding_count',finding_count,
    'status',case when critical_count>0 then 'critical' when warning_count>0 then 'review' when info_count>0 then 'minor' else 'clean' end,
    'checks',jsonb_build_array('completed_sale_receipt','receipt_ticket_total','receipt_ticket_paid','business_date','sales_ledger_net_tax_collected',
      'duplicate_receipts','verified_payment_bounds','po_receiving_bounds','inventory_consumption','inventory_commitments','external_pos_variance','cash_over_short'),
    'findings',findings) into payload from totals;
  return payload;
end;
$audit$;

grant execute on function public.compute_bookkeeping_audit_v2(date,date) to authenticated,service_role;

create or replace function public.compute_bookkeeping_audit(p_range_start date,p_range_end date)
returns jsonb
language sql
stable
security definer
set search_path='public'
as $wrapper$
  select public.compute_bookkeeping_audit_v2(p_range_start,p_range_end);
$wrapper$;

grant execute on function public.compute_bookkeeping_audit(date,date) to authenticated,service_role;
