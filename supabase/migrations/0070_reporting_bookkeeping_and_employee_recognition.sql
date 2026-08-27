-- GotCracked Reporting overhaul: bookkeeping-grade cross audits, management
-- reporting, and transparent employee recognition. Marlon remains read/audit
-- focused: these functions do not edit sales, payments, receipts, or closeouts.

alter table public.business_settings
  add column if not exists recognition_window_days integer not null default 30,
  add column if not exists recognition_sales_weight numeric not null default 0.50,
  add column if not exists recognition_repairs_weight numeric not null default 0.50;

alter table public.business_settings drop constraint if exists business_settings_recognition_window_days_check;
alter table public.business_settings add constraint business_settings_recognition_window_days_check
  check (recognition_window_days between 7 and 365);
alter table public.business_settings drop constraint if exists business_settings_recognition_sales_weight_check;
alter table public.business_settings add constraint business_settings_recognition_sales_weight_check
  check (recognition_sales_weight between 0 and 1);
alter table public.business_settings drop constraint if exists business_settings_recognition_repairs_weight_check;
alter table public.business_settings add constraint business_settings_recognition_repairs_weight_check
  check (recognition_repairs_weight between 0 and 1);

create table if not exists public.bookkeeping_audit_runs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  range_start date not null,
  range_end date not null,
  finding_count integer not null default 0,
  critical_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  status text not null default 'complete' check (status in ('complete','error')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bookkeeping_audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.bookkeeping_audit_runs(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  severity text not null check (severity in ('critical','warning','info')),
  category text not null,
  finding_key text not null,
  title text not null,
  detail text not null,
  reference_type text,
  reference_id text,
  expected_cents integer,
  actual_cents integer,
  variance_cents integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(audit_run_id,finding_key)
);

create index if not exists bookkeeping_audit_runs_location_created_idx
  on public.bookkeeping_audit_runs(location_id,created_at desc);
create index if not exists bookkeeping_audit_findings_run_idx
  on public.bookkeeping_audit_findings(audit_run_id,severity,category);

alter table public.bookkeeping_audit_runs enable row level security;
alter table public.bookkeeping_audit_findings enable row level security;

drop policy if exists bookkeeping_audit_runs_reports_read on public.bookkeeping_audit_runs;
create policy bookkeeping_audit_runs_reports_read on public.bookkeeping_audit_runs
for select to authenticated
using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));

drop policy if exists bookkeeping_audit_findings_reports_read on public.bookkeeping_audit_findings;
create policy bookkeeping_audit_findings_reports_read on public.bookkeeping_audit_findings
for select to authenticated
using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));

grant select on public.bookkeeping_audit_runs,public.bookkeeping_audit_findings to authenticated;

create or replace function public.get_employee_recognition(p_days integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  days_back integer;
  start_date date;
  end_date date;
  sales_weight numeric:=0.50;
  repairs_weight numeric:=0.50;
  result jsonb;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  select
    coalesce(recognition_window_days,30),
    coalesce(recognition_sales_weight,0.50),
    coalesce(recognition_repairs_weight,0.50)
  into days_back,sales_weight,repairs_weight
  from public.business_settings where location_id=loc;
  days_back:=greatest(7,least(365,coalesce(p_days,days_back,30)));
  if sales_weight+repairs_weight<=0 then sales_weight:=0.5; repairs_weight:=0.5; end if;
  sales_weight:=sales_weight/(sales_weight+repairs_weight);
  repairs_weight:=1-sales_weight;
  end_date:=public.current_business_date(loc);
  start_date:=end_date-(days_back-1);

  with staff as (
    select p.id,p.display_name,p.role::text as role,p.avatar_url,p.discord_avatar_url,p.badge_label,p.badge_icon,p.badge_tone
    from public.profiles p
    where p.location_id=loc and p.active=true
  ), sales as (
    select r.created_by as profile_id,
           coalesce(sum(r.total_cents),0)::bigint as checkout_sales_cents,
           count(*)::integer as checkout_count
    from public.receipts r
    where r.location_id=loc and r.business_date between start_date and end_date
      and r.created_by is not null
    group by r.created_by
  ), repairs as (
    select t.assigned_user_id as profile_id,
           count(*) filter (where t.status in ('sale_complete','completed'))::integer as completed_repairs,
           coalesce(sum(r.total_cents),0)::bigint as repair_revenue_cents,
           avg(extract(epoch from (coalesce(t.completed_at,t.sale_completed_at)-coalesce(t.checked_in_at,t.created_at)))/3600.0)
             filter (where coalesce(t.completed_at,t.sale_completed_at) is not null) as avg_turnaround_hours
    from public.repair_tickets t
    left join public.receipts r on r.ticket_id=t.id and r.location_id=loc
    where t.location_id=loc and t.assigned_user_id is not null
      and coalesce(t.sale_business_date, t.sale_completed_at::date, t.completed_at::date, t.updated_at::date) between start_date and end_date
      and t.status in ('sale_complete','completed')
    group by t.assigned_user_id
  ), active_repairs as (
    select assigned_user_id as profile_id,count(*)::integer as active_repairs
    from public.repair_tickets
    where location_id=loc and assigned_user_id is not null
      and status not in ('sale_complete','completed','cancelled','customer_declined','unrepairable')
    group by assigned_user_id
  ), base as (
    select s.*,
      coalesce(sa.checkout_sales_cents,0)::bigint as checkout_sales_cents,
      coalesce(sa.checkout_count,0)::integer as checkout_count,
      coalesce(rp.completed_repairs,0)::integer as completed_repairs,
      coalesce(rp.repair_revenue_cents,0)::bigint as repair_revenue_cents,
      round(coalesce(rp.avg_turnaround_hours,0)::numeric,1) as avg_turnaround_hours,
      coalesce(ar.active_repairs,0)::integer as active_repairs
    from staff s
    left join sales sa on sa.profile_id=s.id
    left join repairs rp on rp.profile_id=s.id
    left join active_repairs ar on ar.profile_id=s.id
  ), maxima as (
    select greatest(max(checkout_sales_cents),1)::numeric as max_sales,
           greatest(max(completed_repairs),1)::numeric as max_repairs
    from base
  ), scored as (
    select b.*,
      round(100*(sales_weight*(b.checkout_sales_cents::numeric/m.max_sales)+repairs_weight*(b.completed_repairs::numeric/m.max_repairs)),1) as recognition_score
    from base b cross join maxima m
  ), ranked as (
    select *,dense_rank() over(order by recognition_score desc,checkout_sales_cents desc,completed_repairs desc,display_name) as rank
    from scored
  ), decorated as (
    select *,
      case
        when rank=1 and (checkout_sales_cents>0 or completed_repairs>0) then 'Top Contributor'
        when checkout_sales_cents=(select max(checkout_sales_cents) from ranked) and checkout_sales_cents>0 then 'Sales Leader'
        when completed_repairs=(select max(completed_repairs) from ranked) and completed_repairs>0 then 'Repair Leader'
        else null
      end as recognition_label
    from ranked
  )
  select jsonb_build_object(
    'range_start',start_date,'range_end',end_date,'days',days_back,
    'sales_weight',sales_weight,'repairs_weight',repairs_weight,
    'score_explanation','Recognition score normalizes checkout sales and completed repairs to the highest active employee in the same period, then applies the configured weights. It is a recognition metric, not a disciplinary or compensation decision.',
    'employees',coalesce(jsonb_agg(jsonb_build_object(
      'profile_id',id,'display_name',display_name,'role',role,'avatar_url',coalesce(avatar_url,discord_avatar_url),
      'badge_label',badge_label,'badge_icon',badge_icon,'badge_tone',badge_tone,
      'rank',rank,'recognition_score',recognition_score,'recognition_label',recognition_label,
      'checkout_sales_cents',checkout_sales_cents,'checkout_count',checkout_count,
      'completed_repairs',completed_repairs,'repair_revenue_cents',repair_revenue_cents,
      'avg_turnaround_hours',avg_turnaround_hours,'active_repairs',active_repairs
    ) order by rank,display_name),'[]'::jsonb)
  ) into result
  from decorated;

  return coalesce(result,jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'employees','[]'::jsonb));
end;
$function$;

grant execute on function public.get_employee_recognition(integer) to authenticated,service_role;

create or replace function public.compute_bookkeeping_audit(
  p_range_start date,
  p_range_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  findings jsonb:='[]'::jsonb;
  item record;
  recon jsonb;
  critical_count integer:=0;
  warning_count integer:=0;
  info_count integer:=0;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then
    raise exception 'Reports permission required.';
  end if;
  if p_range_start is null or p_range_end is null or p_range_end<p_range_start or p_range_end-p_range_start>366 then
    raise exception 'Invalid bookkeeping audit range.';
  end if;

  -- Sale-complete work orders should have a receipt.
  for item in
    select t.id,t.ticket_number,t.total_cents,t.amount_paid_cents,t.sale_business_date
    from public.repair_tickets t
    where t.location_id=loc and t.status in ('sale_complete','completed')
      and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date) between p_range_start and p_range_end
      and not exists(select 1 from public.receipts r where r.ticket_id=t.id)
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity','critical','category','sales_integrity','finding_key','missing-receipt-'||item.id,
      'title','Completed sale is missing a receipt','detail','GC-'||lpad(item.ticket_number::text,6,'0')||' is closed as a sale but has no receipt record.',
      'reference_type','repair_ticket','reference_id',item.id,'expected_cents',item.total_cents,'actual_cents',0,'variance_cents',item.total_cents
    )); critical_count:=critical_count+1;
  end loop;

  -- Ticket / receipt totals must agree exactly.
  for item in
    select r.id as receipt_id,r.receipt_number,r.ticket_id,r.total_cents as receipt_total,t.total_cents as ticket_total
    from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
    where r.location_id=loc and r.business_date between p_range_start and p_range_end
      and coalesce(r.total_cents,0)<>coalesce(t.total_cents,0)
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity','critical','category','sales_integrity','finding_key','receipt-ticket-total-'||item.receipt_id,
      'title','Receipt and work-order totals do not match','detail',coalesce(item.receipt_number,'Receipt')||' does not equal the linked work-order total.',
      'reference_type','receipt','reference_id',item.receipt_id,'expected_cents',item.ticket_total,'actual_cents',item.receipt_total,
      'variance_cents',coalesce(item.receipt_total,0)-coalesce(item.ticket_total,0)
    )); critical_count:=critical_count+1;
  end loop;

  -- Payment amounts recorded on receipt and repair should agree.
  for item in
    select r.id as receipt_id,r.receipt_number,r.amount_paid_cents as receipt_paid,t.amount_paid_cents as ticket_paid
    from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
    where r.location_id=loc and r.business_date between p_range_start and p_range_end
      and coalesce(r.amount_paid_cents,0)<>coalesce(t.amount_paid_cents,0)
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity','warning','category','payments','finding_key','receipt-ticket-paid-'||item.receipt_id,
      'title','Payment total differs between receipt and repair','detail',coalesce(item.receipt_number,'Receipt')||' has a different paid amount than its repair record.',
      'reference_type','receipt','reference_id',item.receipt_id,'expected_cents',item.receipt_paid,'actual_cents',item.ticket_paid,
      'variance_cents',coalesce(item.ticket_paid,0)-coalesce(item.receipt_paid,0)
    )); warning_count:=warning_count+1;
  end loop;

  -- A posted receipt should have sales-ledger coverage. Compare collected totals.
  for item in
    select r.id as receipt_id,r.receipt_number,r.amount_paid_cents,
           coalesce(sum(l.collected_cents),0)::integer as ledger_collected
    from public.receipts r
    left join public.sales_ledger_entries l on l.receipt_id=r.id and l.location_id=loc
    where r.location_id=loc and r.business_date between p_range_start and p_range_end
    group by r.id,r.receipt_number,r.amount_paid_cents
    having coalesce(sum(l.collected_cents),0)<>coalesce(r.amount_paid_cents,0)
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity',case when item.ledger_collected=0 then 'critical' else 'warning' end,
      'category','ledger','finding_key','receipt-ledger-'||item.receipt_id,
      'title',case when item.ledger_collected=0 then 'Receipt is missing sales-ledger collection' else 'Receipt and sales ledger do not reconcile' end,
      'detail',coalesce(item.receipt_number,'Receipt')||' collected amount does not equal the posted ledger collection.',
      'reference_type','receipt','reference_id',item.receipt_id,'expected_cents',item.amount_paid_cents,'actual_cents',item.ledger_collected,
      'variance_cents',coalesce(item.ledger_collected,0)-coalesce(item.amount_paid_cents,0)
    ));
    if item.ledger_collected=0 then critical_count:=critical_count+1; else warning_count:=warning_count+1; end if;
  end loop;

  -- Duplicate receipts for one ticket are suspicious and need review.
  for item in
    select ticket_id,count(*)::integer as receipt_count,min(receipt_number) as example
    from public.receipts
    where location_id=loc and business_date between p_range_start and p_range_end and ticket_id is not null
    group by ticket_id having count(*)>1
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity','warning','category','sales_integrity','finding_key','duplicate-receipts-'||item.ticket_id,
      'title','Multiple receipts exist for one repair','detail',item.receipt_count||' receipts are linked to the same repair ticket. Confirm this is intentional.',
      'reference_type','repair_ticket','reference_id',item.ticket_id,'metadata',jsonb_build_object('receipt_count',item.receipt_count,'example_receipt',item.example)
    )); warning_count:=warning_count+1;
  end loop;

  -- Verified payment requests should not exceed the ticket total.
  for item in
    select pr.id,pr.ticket_id,pr.amount_verified_cents,t.total_cents
    from public.payment_requests pr join public.repair_tickets t on t.id=pr.ticket_id
    where pr.location_id=loc and pr.status='verified' and pr.verified_at::date between p_range_start and p_range_end
      and coalesce(pr.amount_verified_cents,0)>coalesce(t.total_cents,0)
  loop
    findings:=findings||jsonb_build_array(jsonb_build_object(
      'severity','warning','category','payments','finding_key','verified-payment-over-ticket-'||item.id,
      'title','Verified payment exceeds the repair total','detail','A verified payment request is larger than the current work-order total.',
      'reference_type','payment_request','reference_id',item.id,'expected_cents',item.total_cents,'actual_cents',item.amount_verified_cents,
      'variance_cents',item.amount_verified_cents-item.total_cents
    )); warning_count:=warning_count+1;
  end loop;

  -- End-day reconciliation variances remain authoritative for POS/cash cross-audit.
  recon:=public.get_reconciliation_history(p_range_start,p_range_end);
  for item in
    select value as row from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb))
  loop
    if coalesce((item.row->>'portal_pos_variance_cents')::integer,0)<>0 then
      findings:=findings||jsonb_build_array(jsonb_build_object(
        'severity',case when abs((item.row->>'portal_pos_variance_cents')::integer)>500 then 'warning' else 'info' end,
        'category','reconciliation','finding_key','pos-variance-'||(item.row->>'business_date'),
        'title','External POS variance on '||(item.row->>'business_date'),
        'detail','Portal expected external sales and the printed POS total differ for this closed business day.',
        'reference_type','business_date','reference_id',item.row->>'business_date',
        'expected_cents',(item.row->>'portal_external_expected_cents')::integer,
        'actual_cents',(item.row->>'pos_net_sales_cents')::integer,
        'variance_cents',(item.row->>'portal_pos_variance_cents')::integer
      ));
      if abs((item.row->>'portal_pos_variance_cents')::integer)>500 then warning_count:=warning_count+1; else info_count:=info_count+1; end if;
    end if;
    if coalesce((item.row->>'cash_over_short_cents')::integer,0)<>0 then
      findings:=findings||jsonb_build_array(jsonb_build_object(
        'severity',case when abs((item.row->>'cash_over_short_cents')::integer)>500 then 'warning' else 'info' end,
        'category','cash','finding_key','cash-variance-'||(item.row->>'business_date'),
        'title','Cash drawer variance on '||(item.row->>'business_date'),
        'detail','The reconciled drawer had a non-zero over/short amount.',
        'reference_type','business_date','reference_id',item.row->>'business_date',
        'variance_cents',(item.row->>'cash_over_short_cents')::integer
      ));
      if abs((item.row->>'cash_over_short_cents')::integer)>500 then warning_count:=warning_count+1; else info_count:=info_count+1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'range_start',p_range_start,'range_end',p_range_end,
    'finding_count',critical_count+warning_count+info_count,
    'critical_count',critical_count,'warning_count',warning_count,'info_count',info_count,
    'status',case when critical_count>0 then 'critical' when warning_count>0 then 'review' when info_count>0 then 'minor' else 'clean' end,
    'findings',findings,'generated_at',now()
  );
end;
$function$;

grant execute on function public.compute_bookkeeping_audit(date,date) to authenticated,service_role;

create or replace function public.run_bookkeeping_cross_audit(
  p_range_start date default null,
  p_range_end date default null,
  p_persist boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  end_date date;
  start_date date;
  audit jsonb;
  run_id uuid;
  f jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  end_date:=coalesce(p_range_end,public.current_business_date(loc));
  start_date:=coalesce(p_range_start,end_date-29);
  audit:=public.compute_bookkeeping_audit(start_date,end_date);
  if p_persist then
    insert into public.bookkeeping_audit_runs(location_id,range_start,range_end,finding_count,critical_count,warning_count,info_count,status,summary,created_by)
    values(loc,start_date,end_date,coalesce((audit->>'finding_count')::integer,0),coalesce((audit->>'critical_count')::integer,0),coalesce((audit->>'warning_count')::integer,0),coalesce((audit->>'info_count')::integer,0),'complete',audit,auth.uid())
    returning id into run_id;
    for f in select value from jsonb_array_elements(coalesce(audit->'findings','[]'::jsonb)) loop
      insert into public.bookkeeping_audit_findings(
        audit_run_id,location_id,severity,category,finding_key,title,detail,reference_type,reference_id,
        expected_cents,actual_cents,variance_cents,metadata
      ) values(
        run_id,loc,f->>'severity',f->>'category',f->>'finding_key',f->>'title',f->>'detail',f->>'reference_type',f->>'reference_id',
        nullif(f->>'expected_cents','')::integer,nullif(f->>'actual_cents','')::integer,nullif(f->>'variance_cents','')::integer,coalesce(f->'metadata','{}'::jsonb)
      );
    end loop;
    audit:=audit||jsonb_build_object('audit_run_id',run_id,'persisted',true);
  else
    audit:=audit||jsonb_build_object('persisted',false);
  end if;
  return audit;
end;
$function$;

grant execute on function public.run_bookkeeping_cross_audit(date,date,boolean) to authenticated,service_role;

create or replace function public.get_bookkeeping_report(
  p_range_start date default null,
  p_range_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  end_date date;
  start_date date;
  day_count integer;
  profile_role text;
  receipt_subtotal bigint:=0;
  receipt_tax bigint:=0;
  receipt_total bigint:=0;
  receipt_paid bigint:=0;
  receipt_count integer:=0;
  reconciled_sales bigint:=0;
  closed_days integer:=0;
  cogs bigint:=0;
  shipping_expense bigint:=0;
  inventory_loss bigint:=0;
  inventory_cost_value bigint:=0;
  inventory_retail_value bigint:=0;
  purchases_ordered bigint:=0;
  open_po_value bigint:=0;
  labor_hours numeric:=0;
  estimated_labor bigint:=null;
  daily jsonb:='[]'::jsonb;
  tenders jsonb:='[]'::jsonb;
  purchase_rows jsonb:='[]'::jsonb;
  inventory_rows jsonb:='[]'::jsonb;
  audit jsonb;
  recognition jsonb;
  recon jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  end_date:=coalesce(p_range_end,public.current_business_date(loc));
  start_date:=coalesce(p_range_start,end_date-29);
  if end_date<start_date or end_date-start_date>366 then raise exception 'Invalid report range.'; end if;
  day_count:=end_date-start_date+1;
  select role::text into profile_role from public.profiles where id=auth.uid();

  select coalesce(sum(subtotal_cents),0),coalesce(sum(tax_cents),0),coalesce(sum(total_cents),0),coalesce(sum(amount_paid_cents),0),count(*)
  into receipt_subtotal,receipt_tax,receipt_total,receipt_paid,receipt_count
  from public.receipts where location_id=loc and business_date between start_date and end_date;

  recon:=public.get_reconciliation_history(start_date,end_date);
  select coalesce(sum((x->>'reconciled_total_sales_cents')::bigint),0),count(*)
  into reconciled_sales,closed_days
  from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) x
  where x->>'status'='closed';

  select coalesce(sum(round(woi.quantity*woi.unit_cost_cents)),0)::bigint into cogs
  from public.work_order_items woi
  where exists(
    select 1 from public.receipts r
    where r.ticket_id=woi.ticket_id and r.location_id=loc and r.business_date between start_date and end_date
  );

  select coalesce(sum(postage_cents+insurance_cents),0)::bigint into shipping_expense
  from public.shipping_shipments
  where location_id=loc and purchased_at::date between start_date and end_date and status<>'voided';

  select coalesce(sum(loss_amount_cents),0)::bigint into inventory_loss
  from public.inventory_transactions
  where location_id=loc and transaction_type='write_off' and created_at::date between start_date and end_date;

  select coalesce(sum(quantity_on_hand*cost_cents),0)::bigint,coalesce(sum(quantity_on_hand*sell_price_cents),0)::bigint
  into inventory_cost_value,inventory_retail_value
  from public.inventory_items where location_id=loc and active=true;

  select coalesce(sum(poi.quantity_ordered*poi.unit_cost_cents+case when row_number() over(partition by po.id order by poi.id)=1 then coalesce(po.supplier_shipping_cost_cents,0) else 0 end),0)::bigint
  into purchases_ordered
  from public.purchase_orders po join public.purchase_order_items poi on poi.purchase_order_id=po.id
  where po.location_id=loc and po.ordered_at::date between start_date and end_date and po.status not in ('draft','cancelled');

  select coalesce(sum(greatest(poi.quantity_ordered-poi.quantity_received,0)*poi.unit_cost_cents),0)::bigint into open_po_value
  from public.purchase_orders po join public.purchase_order_items poi on poi.purchase_order_id=po.id
  where po.location_id=loc and po.status in ('ordered','partial','partially_received');

  select coalesce(sum(greatest(extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))/3600.0-coalesce(te.break_minutes,0)/60.0,0)),0)
  into labor_hours
  from public.time_entries te where te.location_id=loc and te.clock_in::date between start_date and end_date;

  if profile_role='owner' then
    with employee_hours as (
      select te.employee_id,sum(greatest(extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))/3600.0-coalesce(te.break_minutes,0)/60.0,0)) as hours
      from public.time_entries te where te.location_id=loc and te.clock_in::date between start_date and end_date group by te.employee_id
    ), latest_comp as (
      select distinct on (sc.profile_id) sc.profile_id,sc.employment_type,sc.hourly_rate_cents,sc.weekly_salary_cents
      from public.staff_compensation sc where sc.location_id=loc and sc.effective_at<=end_date
      order by sc.profile_id,sc.effective_at desc
    )
    select coalesce(sum(
      case when lc.employment_type='salary' and coalesce(lc.weekly_salary_cents,0)>0
        then lc.weekly_salary_cents*(day_count::numeric/7.0)
        else coalesce(eh.hours,0)*coalesce(lc.hourly_rate_cents,0)
      end
    ),0)::bigint into estimated_labor
    from latest_comp lc left join employee_hours eh on eh.employee_id=lc.profile_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'business_date',c.business_date,'status',c.status,'reconciliation_status',c.reconciliation_status,
    'reconciled_sales_cents',c.reconciled_total_sales_cents,'tax_cents',c.tax_collected_cents,
    'transaction_count',c.transaction_count,'goal_cents',c.goal_cents,'pos_variance_cents',c.portal_pos_variance_cents,
    'cash_over_short_cents',c.cash_over_short_cents,'part_cost_cents',c.portal_part_cost_cents,'part_margin_cents',c.portal_part_margin_cents
  ) order by c.business_date),'[]'::jsonb) into daily
  from public.daily_closeouts c where c.location_id=loc and c.business_date between start_date and end_date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method',payment_method,'receipt_count',receipt_count,'collected_cents',collected_cents
  ) order by collected_cents desc),'[]'::jsonb) into tenders
  from (
    select coalesce(nullif(payment_method,''),'unspecified') payment_method,count(*)::integer receipt_count,sum(amount_paid_cents)::bigint collected_cents
    from public.receipts where location_id=loc and business_date between start_date and end_date
    group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'po_number',po_number,'supplier_name',supplier_name,'status',status,'ordered_at',ordered_at,'received_at',received_at,
    'merchandise_cents',merchandise_cents,'shipping_cents',shipping_cents,'total_cents',merchandise_cents+shipping_cents
  ) order by coalesce(ordered_at,created_at) desc),'[]'::jsonb) into purchase_rows
  from (
    select po.id,po.po_number,po.supplier_name,po.status,po.ordered_at,po.received_at,po.created_at,
      coalesce(sum(poi.quantity_ordered*poi.unit_cost_cents),0)::bigint merchandise_cents,
      coalesce(po.supplier_shipping_cost_cents,0)::bigint shipping_cents
    from public.purchase_orders po left join public.purchase_order_items poi on poi.purchase_order_id=po.id
    where po.location_id=loc and coalesce(po.ordered_at::date,po.created_at::date) between start_date and end_date
    group by po.id
  ) p;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name',name,'sku',sku,'quantity_on_hand',quantity_on_hand,'reorder_point',reorder_point,
    'cost_value_cents',quantity_on_hand*cost_cents,'retail_value_cents',quantity_on_hand*sell_price_cents
  ) order by quantity_on_hand*cost_cents desc),'[]'::jsonb) into inventory_rows
  from public.inventory_items where location_id=loc and active=true;

  audit:=public.compute_bookkeeping_audit(start_date,end_date);
  recognition:=public.get_employee_recognition(day_count);

  return jsonb_build_object(
    'range_start',start_date,'range_end',end_date,'days',day_count,'generated_at',now(),
    'scope_note','Management reporting from GotCracked Portal records. This is not a complete GAAP income statement until non-Portal expenses such as rent, utilities, banking fees, depreciation, and other overhead are entered or integrated.',
    'summary',jsonb_build_object(
      'receipt_subtotal_cents',receipt_subtotal,'receipt_tax_cents',receipt_tax,'receipt_total_cents',receipt_total,'receipt_collected_cents',receipt_paid,'receipt_count',receipt_count,
      'reconciled_sales_cents',reconciled_sales,'closed_business_days',closed_days,
      'cogs_cents',cogs,'gross_profit_cents',receipt_subtotal-cogs,'gross_margin_percent',case when receipt_subtotal>0 then round(((receipt_subtotal-cogs)::numeric/receipt_subtotal)*100,1) else 0 end,
      'shipping_expense_cents',shipping_expense,'inventory_loss_cents',inventory_loss,
      'known_operating_expense_cents',shipping_expense+inventory_loss,
      'known_operating_income_before_labor_overhead_cents',receipt_subtotal-cogs-shipping_expense-inventory_loss,
      'estimated_labor_cents',estimated_labor,'labor_hours',round(labor_hours,2),
      'inventory_cost_value_cents',inventory_cost_value,'inventory_retail_value_cents',inventory_retail_value,
      'inventory_purchases_ordered_cents',purchases_ordered,'open_po_value_cents',open_po_value
    ),
    'profit_and_loss',jsonb_build_object(
      'revenue_cents',receipt_subtotal,'cogs_cents',cogs,'gross_profit_cents',receipt_subtotal-cogs,
      'shipping_expense_cents',shipping_expense,'inventory_loss_cents',inventory_loss,
      'estimated_labor_cents',estimated_labor,
      'tracked_operating_income_cents',receipt_subtotal-cogs-shipping_expense-inventory_loss-coalesce(estimated_labor,0),
      'labor_note',case when profile_role='owner' then 'Estimated from current compensation records and Portal time entries; salary is prorated by report days.' else 'Labor cost is hidden outside the Owner role; labor hours remain available.' end,
      'limitations','Does not include overhead that is not tracked in Portal.'
    ),
    'tax',jsonb_build_object('receipt_tax_cents',receipt_tax,'closeout_tax_cents',coalesce((select sum((x->>'tax_collected_cents')::bigint) from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) x where x->>'status'='closed'),0)),
    'daily',daily,'payments',tenders,
    'inventory',jsonb_build_object('cost_value_cents',inventory_cost_value,'retail_value_cents',inventory_retail_value,'loss_cents',inventory_loss,'items',inventory_rows),
    'purchasing',jsonb_build_object('ordered_cents',purchases_ordered,'open_po_value_cents',open_po_value,'orders',purchase_rows),
    'employee_recognition',recognition,'audit',audit,'reconciliation',recon
  );
end;
$function$;

grant execute on function public.get_bookkeeping_report(date,date) to authenticated,service_role;

create or replace function public.get_marlon_reporting_context(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare
  loc uuid:=public.current_location_id();
  end_date date;
  start_date date;
  days_back integer:=greatest(7,least(365,coalesce(p_days,30)));
  report jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then return jsonb_build_object('available',false,'reason','reports_permission_required'); end if;
  end_date:=public.current_business_date(loc); start_date:=end_date-(days_back-1);
  report:=public.get_bookkeeping_report(start_date,end_date);
  return jsonb_build_object(
    'available',true,'range_start',start_date,'range_end',end_date,'days',days_back,
    'summary',report->'summary','profit_and_loss',report->'profit_and_loss','tax',report->'tax',
    'payments',report->'payments','audit',report->'audit','employee_recognition',report->'employee_recognition',
    'daily',coalesce(report->'daily','[]'::jsonb),'scope_note',report->>'scope_note'
  );
end;
$function$;

grant execute on function public.get_marlon_reporting_context(integer) to authenticated,service_role;
