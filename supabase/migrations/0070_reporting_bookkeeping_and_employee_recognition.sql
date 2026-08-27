-- Reporting foundation: read-only bookkeeping/cross-audit data and employee recognition.
-- Marlon may analyze these results but these functions do not alter sales, receipts,
-- payments, closeouts, purchase orders, or inventory quantities.

alter table public.business_settings
  add column if not exists recognition_window_days integer not null default 30,
  add column if not exists recognition_sales_weight numeric not null default 0.50,
  add column if not exists recognition_repairs_weight numeric not null default 0.50;

alter table public.business_settings drop constraint if exists business_settings_recognition_window_days_check;
alter table public.business_settings add constraint business_settings_recognition_window_days_check check (recognition_window_days between 7 and 365);
alter table public.business_settings drop constraint if exists business_settings_recognition_sales_weight_check;
alter table public.business_settings add constraint business_settings_recognition_sales_weight_check check (recognition_sales_weight between 0 and 1);
alter table public.business_settings drop constraint if exists business_settings_recognition_repairs_weight_check;
alter table public.business_settings add constraint business_settings_recognition_repairs_weight_check check (recognition_repairs_weight between 0 and 1);

create table if not exists public.bookkeeping_audit_runs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  range_start date not null,
  range_end date not null,
  status text not null default 'complete' check (status in ('complete','error')),
  critical_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  finding_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bookkeeping_audit_runs_location_created_idx on public.bookkeeping_audit_runs(location_id,created_at desc);
alter table public.bookkeeping_audit_runs enable row level security;
drop policy if exists bookkeeping_audit_runs_reports_read on public.bookkeeping_audit_runs;
create policy bookkeeping_audit_runs_reports_read on public.bookkeeping_audit_runs for select to authenticated
  using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));
grant select on public.bookkeeping_audit_runs to authenticated;

create or replace function public.get_employee_recognition(p_days integer default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); days_back integer:=30; start_date date; end_date date; sw numeric:=.5; rw numeric:=.5; payload jsonb;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  select coalesce(recognition_window_days,30),coalesce(recognition_sales_weight,.5),coalesce(recognition_repairs_weight,.5)
  into days_back,sw,rw from public.business_settings where location_id=loc;
  days_back:=greatest(7,least(365,coalesce(p_days,days_back,30)));
  if sw+rw<=0 then sw:=.5; rw:=.5; end if; sw:=sw/(sw+rw); rw:=1-sw;
  end_date:=public.current_business_date(loc); start_date:=end_date-(days_back-1);
  with staff as (
    select id,display_name,role::text role,coalesce(avatar_url,discord_avatar_url) avatar_url,badge_label,badge_icon,badge_tone
    from public.profiles where location_id=loc and active=true and role::text<>'owner'
  ), sales as (
    select created_by profile_id,count(*)::integer checkout_count,coalesce(sum(total_cents),0)::bigint checkout_sales_cents
    from public.receipts where location_id=loc and business_date between start_date and end_date and created_by is not null group by created_by
  ), repairs as (
    select t.assigned_user_id profile_id,count(*)::integer completed_repairs,coalesce(sum(r.total_cents),0)::bigint repair_revenue_cents,
      round(coalesce(avg(extract(epoch from (coalesce(t.sale_completed_at,t.completed_at)-coalesce(t.checked_in_at,t.created_at)))/3600.0),0)::numeric,1) avg_turnaround_hours
    from public.repair_tickets t left join public.receipts r on r.ticket_id=t.id and r.location_id=loc
    where t.location_id=loc and t.assigned_user_id is not null and t.status in ('sale_complete','completed')
      and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date) between start_date and end_date
    group by t.assigned_user_id
  ), active as (
    select assigned_user_id profile_id,count(*)::integer active_repairs from public.repair_tickets
    where location_id=loc and assigned_user_id is not null
      and status not in ('sale_complete','completed','cancelled','customer_declined','unrepairable','abandoned') group by assigned_user_id
  ), base as (
    select s.*,coalesce(sa.checkout_count,0) checkout_count,coalesce(sa.checkout_sales_cents,0)::bigint checkout_sales_cents,
      coalesce(rp.completed_repairs,0) completed_repairs,coalesce(rp.repair_revenue_cents,0)::bigint repair_revenue_cents,
      coalesce(rp.avg_turnaround_hours,0) avg_turnaround_hours,coalesce(a.active_repairs,0) active_repairs
    from staff s left join sales sa on sa.profile_id=s.id left join repairs rp on rp.profile_id=s.id left join active a on a.profile_id=s.id
  ), mx as (
    select greatest(coalesce(max(checkout_sales_cents),0),1)::numeric ms,greatest(coalesce(max(completed_repairs),0),1)::numeric mr from base
  ), scored as (
    select b.*,round(100*(sw*(b.checkout_sales_cents::numeric/mx.ms)+rw*(b.completed_repairs::numeric/mx.mr)),1) recognition_score from base b cross join mx
  ), ranked as (
    select *,dense_rank() over(order by recognition_score desc,checkout_sales_cents desc,completed_repairs desc,display_name) rank from scored
  ), decorated as (
    select *,case when rank=1 and (checkout_sales_cents>0 or completed_repairs>0) then 'Top Contributor'
      when checkout_sales_cents=(select max(checkout_sales_cents) from ranked) and checkout_sales_cents>0 then 'Sales Leader'
      when completed_repairs=(select max(completed_repairs) from ranked) and completed_repairs>0 then 'Repair Leader' else null end recognition_label from ranked
  )
  select jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'sales_weight',sw,'repairs_weight',rw,
    'score_explanation','Recognition score normalizes checkout sales and completed repairs to the highest active employee in the same period, then applies configured weights. It is for recognition, not compensation or discipline.',
    'employees',coalesce(jsonb_agg(jsonb_build_object('profile_id',id,'display_name',display_name,'role',role,'avatar_url',avatar_url,
      'badge_label',badge_label,'badge_icon',badge_icon,'badge_tone',badge_tone,'rank',rank,'recognition_score',recognition_score,
      'recognition_label',recognition_label,'checkout_sales_cents',checkout_sales_cents,'checkout_count',checkout_count,
      'completed_repairs',completed_repairs,'repair_revenue_cents',repair_revenue_cents,'avg_turnaround_hours',avg_turnaround_hours,
      'active_repairs',active_repairs) order by rank,display_name),'[]'::jsonb)) into payload from decorated;
  return coalesce(payload,jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'employees','[]'::jsonb));
end;$function$;
grant execute on function public.get_employee_recognition(integer) to authenticated,service_role;

create or replace function public.compute_bookkeeping_audit(p_range_start date,p_range_end date)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); findings jsonb:='[]'::jsonb; chunk jsonb; recon jsonb; c integer:=0; w integer:=0; i integer:=0;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  if p_range_start is null or p_range_end is null or p_range_end<p_range_start or p_range_end-p_range_start>366 then raise exception 'Invalid bookkeeping audit range.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('severity','critical','category','sales_integrity','finding_key','missing-receipt-'||t.id,
    'title','Completed sale is missing a receipt','detail','GC-'||lpad(t.ticket_number::text,6,'0')||' is closed as a sale but has no receipt record.',
    'reference_type','repair_ticket','reference_id',t.id,'expected_cents',t.total_cents,'actual_cents',0,'variance_cents',t.total_cents)),'[]'::jsonb)
  into chunk from public.repair_tickets t where t.location_id=loc and t.status in ('sale_complete','completed')
    and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date) between p_range_start and p_range_end
    and not exists(select 1 from public.receipts r where r.ticket_id=t.id);
  findings:=findings||chunk; c:=c+jsonb_array_length(chunk);
  select coalesce(jsonb_agg(jsonb_build_object('severity','critical','category','sales_integrity','finding_key','receipt-total-'||r.id,
    'title','Receipt and work-order totals do not match','detail',coalesce(r.receipt_number,'Receipt')||' does not equal its linked repair total.',
    'reference_type','receipt','reference_id',r.id,'expected_cents',t.total_cents,'actual_cents',r.total_cents,
    'variance_cents',coalesce(r.total_cents,0)-coalesce(t.total_cents,0))),'[]'::jsonb)
  into chunk from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
  where r.location_id=loc and r.business_date between p_range_start and p_range_end and coalesce(r.total_cents,0)<>coalesce(t.total_cents,0);
  findings:=findings||chunk; c:=c+jsonb_array_length(chunk);
  select coalesce(jsonb_agg(jsonb_build_object('severity','warning','category','payments','finding_key','receipt-paid-'||r.id,
    'title','Payment total differs between receipt and repair','detail',coalesce(r.receipt_number,'Receipt')||' has a different paid amount than its repair record.',
    'reference_type','receipt','reference_id',r.id,'expected_cents',r.amount_paid_cents,'actual_cents',t.amount_paid_cents,
    'variance_cents',coalesce(t.amount_paid_cents,0)-coalesce(r.amount_paid_cents,0))),'[]'::jsonb)
  into chunk from public.receipts r join public.repair_tickets t on t.id=r.ticket_id
  where r.location_id=loc and r.business_date between p_range_start and p_range_end and coalesce(r.amount_paid_cents,0)<>coalesce(t.amount_paid_cents,0);
  findings:=findings||chunk; w:=w+jsonb_array_length(chunk);
  recon:=public.get_reconciliation_history(p_range_start,p_range_end);
  select coalesce(jsonb_agg(jsonb_build_object('severity',case when abs((x->>'portal_pos_variance_cents')::integer)>500 then 'warning' else 'info' end,
    'category','reconciliation','finding_key','pos-variance-'||(x->>'business_date'),'title','External POS variance on '||(x->>'business_date'),
    'detail','Portal expected external sales and the printed POS total differ.','reference_type','business_date','reference_id',x->>'business_date',
    'expected_cents',(x->>'portal_external_expected_cents')::integer,'actual_cents',(x->>'pos_net_sales_cents')::integer,
    'variance_cents',(x->>'portal_pos_variance_cents')::integer)),'[]'::jsonb) into chunk
  from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) x where coalesce((x->>'portal_pos_variance_cents')::integer,0)<>0;
  findings:=findings||chunk; w:=w+(select count(*) from jsonb_array_elements(chunk) f where f->>'severity'='warning'); i:=i+(select count(*) from jsonb_array_elements(chunk) f where f->>'severity'='info');
  select coalesce(jsonb_agg(jsonb_build_object('severity',case when abs((x->>'cash_over_short_cents')::integer)>500 then 'warning' else 'info' end,
    'category','cash','finding_key','cash-variance-'||(x->>'business_date'),'title','Cash drawer variance on '||(x->>'business_date'),
    'detail','The reconciled drawer closed with a non-zero over/short amount.','reference_type','business_date','reference_id',x->>'business_date',
    'variance_cents',(x->>'cash_over_short_cents')::integer)),'[]'::jsonb) into chunk
  from jsonb_array_elements(coalesce(recon->'rows','[]'::jsonb)) x where coalesce((x->>'cash_over_short_cents')::integer,0)<>0;
  findings:=findings||chunk; w:=w+(select count(*) from jsonb_array_elements(chunk) f where f->>'severity'='warning'); i:=i+(select count(*) from jsonb_array_elements(chunk) f where f->>'severity'='info');
  return jsonb_build_object('range_start',p_range_start,'range_end',p_range_end,'generated_at',now(),'critical_count',c,'warning_count',w,
    'info_count',i,'finding_count',c+w+i,'status',case when c>0 then 'critical' when w>0 then 'review' when i>0 then 'minor' else 'clean' end,'findings',findings);
end;$function$;
grant execute on function public.compute_bookkeeping_audit(date,date) to authenticated,service_role;

create or replace function public.run_bookkeeping_cross_audit(p_range_start date default null,p_range_end date default null,p_persist boolean default false)
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); e date; s date; a jsonb; rid uuid;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  e:=coalesce(p_range_end,public.current_business_date(loc)); s:=coalesce(p_range_start,e-29); a:=public.compute_bookkeeping_audit(s,e);
  if p_persist then
    insert into public.bookkeeping_audit_runs(location_id,range_start,range_end,critical_count,warning_count,info_count,finding_count,result,created_by)
    values(loc,s,e,(a->>'critical_count')::integer,(a->>'warning_count')::integer,(a->>'info_count')::integer,(a->>'finding_count')::integer,a,auth.uid()) returning id into rid;
    a:=a||jsonb_build_object('audit_run_id',rid,'persisted',true);
  else a:=a||jsonb_build_object('persisted',false); end if;
  return a;
end;$function$;
grant execute on function public.run_bookkeeping_cross_audit(date,date,boolean) to authenticated,service_role;

create or replace function public.get_bookkeeping_report(p_range_start date default null,p_range_end date default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare
  loc uuid:=public.current_location_id(); e date; s date; days integer; role_name text;
  subtotal bigint:=0; tax bigint:=0; invoice_total bigint:=0; paid bigint:=0; receipts_count integer:=0;
  cogs bigint:=0; shipping_expense bigint:=0; inventory_loss bigint:=0; inv_cost bigint:=0; inv_retail bigint:=0;
  po_total bigint:=0; open_po bigint:=0; hours numeric:=0; labor bigint:=null;
  daily jsonb; tenders jsonb; purchases jsonb; audit jsonb; recognition jsonb; recon jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  e:=coalesce(p_range_end,public.current_business_date(loc)); s:=coalesce(p_range_start,e-29);
  if e<s or e-s>366 then raise exception 'Invalid report range.'; end if; days:=e-s+1;
  select role::text into role_name from public.profiles where id=auth.uid();
  select coalesce(sum(r.subtotal_cents),0),coalesce(sum(r.tax_cents),0),coalesce(sum(r.total_cents),0),coalesce(sum(r.amount_paid_cents),0),count(*)
    into subtotal,tax,invoice_total,paid,receipts_count from public.receipts r where r.location_id=loc and r.business_date between s and e;
  select coalesce(sum(round(w.quantity*w.unit_cost_cents)),0)::bigint into cogs from public.work_order_items w
    where exists(select 1 from public.receipts r where r.ticket_id=w.ticket_id and r.location_id=loc and r.business_date between s and e);
  select coalesce(sum(coalesce(ss.postage_cents,0)+coalesce(ss.insurance_cents,0)),0)::bigint into shipping_expense
    from public.shipping_shipments ss where ss.location_id=loc and ss.purchased_at::date between s and e and ss.status<>'voided';
  select coalesce(sum(it.loss_amount_cents),0)::bigint into inventory_loss from public.inventory_transactions it
    where it.location_id=loc and it.transaction_type='write_off' and it.created_at::date between s and e;
  select coalesce(sum(ii.quantity_on_hand*ii.cost_cents),0)::bigint,coalesce(sum(ii.quantity_on_hand*ii.sell_price_cents),0)::bigint
    into inv_cost,inv_retail from public.inventory_items ii where ii.location_id=loc and ii.active=true;
  select coalesce(sum(x.merchandise_cents+x.shipping_cost_cents),0)::bigint into po_total from (
    select po.id,coalesce(sum(poi.quantity_ordered*poi.unit_cost_cents),0)::bigint merchandise_cents,coalesce(po.supplier_shipping_cost_cents,0)::bigint shipping_cost_cents
    from public.purchase_orders po left join public.purchase_order_items poi on poi.purchase_order_id=po.id
    where po.location_id=loc and po.ordered_at::date between s and e and po.status not in ('draft','cancelled') group by po.id
  ) x;
  select coalesce(sum(greatest(poi.quantity_ordered-poi.quantity_received,0)*poi.unit_cost_cents),0)::bigint into open_po
    from public.purchase_orders po join public.purchase_order_items poi on poi.purchase_order_id=po.id where po.location_id=loc and po.status in ('ordered','partial','partially_received');
  select coalesce(sum(greatest(extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))/3600.0-coalesce(te.break_minutes,0)/60.0,0)),0)
    into hours from public.time_entries te where te.location_id=loc and te.clock_in::date between s and e;
  if role_name='owner' then
    with hb as (
      select te.employee_id,sum(greatest(extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))/3600.0-coalesce(te.break_minutes,0)/60.0,0)) h
      from public.time_entries te where te.location_id=loc and te.clock_in::date between s and e group by te.employee_id
    ), cp as (
      select distinct on(sc.profile_id) sc.profile_id,sc.employment_type,sc.hourly_rate_cents,sc.weekly_salary_cents
      from public.staff_compensation sc where sc.location_id=loc and sc.effective_at<=e order by sc.profile_id,sc.effective_at desc
    )
    select coalesce(sum(case when cp.employment_type='salary' and coalesce(cp.weekly_salary_cents,0)>0 then cp.weekly_salary_cents*(days::numeric/7.0)
      else coalesce(hb.h,0)*coalesce(cp.hourly_rate_cents,0) end),0)::bigint into labor from cp left join hb on hb.employee_id=cp.profile_id;
  end if;
  recon:=public.get_reconciliation_history(s,e); audit:=public.compute_bookkeeping_audit(s,e); recognition:=public.get_employee_recognition(days);
  select coalesce(jsonb_agg(jsonb_build_object('business_date',dc.business_date,'sales_cents',dc.reconciled_total_sales_cents,'tax_cents',dc.tax_collected_cents,
    'transactions',dc.transaction_count,'goal_cents',dc.goal_cents,'pos_variance_cents',dc.portal_pos_variance_cents,'cash_over_short_cents',dc.cash_over_short_cents)
    order by dc.business_date),'[]'::jsonb) into daily from public.daily_closeouts dc where dc.location_id=loc and dc.business_date between s and e;
  select coalesce(jsonb_agg(jsonb_build_object('payment_method',p.payment_method,'receipt_count',p.cnt,'collected_cents',p.collected) order by p.collected desc),'[]'::jsonb)
    into tenders from (select coalesce(nullif(r.payment_method,''),'unspecified') payment_method,count(*)::integer cnt,coalesce(sum(r.amount_paid_cents),0)::bigint collected
    from public.receipts r where r.location_id=loc and r.business_date between s and e group by 1) p;
  select coalesce(jsonb_agg(jsonb_build_object('po_number',p.po_number,'supplier_name',p.supplier_name,'status',p.status,'ordered_at',p.ordered_at,
    'received_at',p.received_at,'merchandise_cents',p.merchandise_cents,'shipping_cents',p.shipping_cost_cents,'total_cents',p.merchandise_cents+p.shipping_cost_cents)
    order by coalesce(p.ordered_at,p.created_at) desc),'[]'::jsonb) into purchases from (
      select po.id,po.po_number,po.supplier_name,po.status,po.ordered_at,po.received_at,po.created_at,
        coalesce(sum(poi.quantity_ordered*poi.unit_cost_cents),0)::bigint merchandise_cents,coalesce(po.supplier_shipping_cost_cents,0)::bigint shipping_cost_cents
      from public.purchase_orders po left join public.purchase_order_items poi on poi.purchase_order_id=po.id
      where po.location_id=loc and coalesce(po.ordered_at::date,po.created_at::date) between s and e group by po.id) p;
  return jsonb_build_object('range_start',s,'range_end',e,'days',days,'generated_at',now(),
    'scope_note','Management reporting from GotCracked Portal records. It is not a complete GAAP income statement until non-Portal overhead such as rent, utilities, bank fees, depreciation, insurance, and other expenses are entered or integrated.',
    'summary',jsonb_build_object('sales_subtotal_cents',subtotal,'tax_cents',tax,'invoice_total_cents',invoice_total,'collected_cents',paid,'receipt_count',receipts_count,
      'cogs_cents',cogs,'gross_profit_cents',subtotal-cogs,'gross_margin_percent',case when subtotal>0 then round(((subtotal-cogs)::numeric/subtotal)*100,1) else 0 end,
      'shipping_expense_cents',shipping_expense,'inventory_loss_cents',inventory_loss,'tracked_operating_income_before_labor_overhead_cents',subtotal-cogs-shipping_expense-inventory_loss,
      'estimated_labor_cents',labor,'labor_hours',round(hours,2),'inventory_cost_value_cents',inv_cost,'inventory_retail_value_cents',inv_retail,
      'purchases_ordered_cents',po_total,'open_po_value_cents',open_po),
    'profit_and_loss',jsonb_build_object('revenue_cents',subtotal,'cogs_cents',cogs,'gross_profit_cents',subtotal-cogs,'shipping_expense_cents',shipping_expense,
      'inventory_loss_cents',inventory_loss,'estimated_labor_cents',labor,'tracked_operating_income_cents',subtotal-cogs-shipping_expense-inventory_loss-coalesce(labor,0),
      'limitations','Does not include overhead that is not tracked in Portal.'),
    'tax',jsonb_build_object('receipt_tax_cents',tax),'daily',daily,'payments',tenders,
    'purchasing',jsonb_build_object('ordered_cents',po_total,'open_po_value_cents',open_po,'orders',purchases),
    'employee_recognition',recognition,'audit',audit,'reconciliation',recon);
end;$function$;
grant execute on function public.get_bookkeeping_report(date,date) to authenticated,service_role;

create or replace function public.get_marlon_reporting_context(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); e date; s date; d integer:=greatest(7,least(365,coalesce(p_days,30))); r jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then return jsonb_build_object('available',false,'reason','reports_permission_required'); end if;
  e:=public.current_business_date(loc); s:=e-(d-1); r:=public.get_bookkeeping_report(s,e);
  return jsonb_build_object('available',true,'range_start',s,'range_end',e,'days',d,'summary',r->'summary','profit_and_loss',r->'profit_and_loss',
    'tax',r->'tax','payments',r->'payments','audit',r->'audit','employee_recognition',r->'employee_recognition','daily',r->'daily','scope_note',r->>'scope_note');
end;$function$;
grant execute on function public.get_marlon_reporting_context(integer) to authenticated,service_role;
