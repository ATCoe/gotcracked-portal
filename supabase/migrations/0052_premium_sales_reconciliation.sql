-- GotCracked Portal: premium dual-channel sales ledger, predictive daily goals,
-- business-day opening controls, and end-of-day reconciliation.

-- ---------------------------------------------------------------------------
-- 1. Payment routing is explicit and immutable per posted ledger entry.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_method_routes (
  location_id uuid not null references public.locations(id) on delete cascade,
  payment_method text not null,
  payment_channel text not null check (payment_channel in ('external_pos','internal')),
  requires_reference boolean not null default true,
  cash_drawer boolean not null default false,
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(location_id,payment_method)
);

insert into public.payment_method_routes(location_id,payment_method,payment_channel,requires_reference,cash_drawer)
select l.id,v.payment_method,v.payment_channel,v.requires_reference,v.cash_drawer
from public.locations l
cross join (values
  ('cash','external_pos',true,true),
  ('external_pos_cash','external_pos',true,true),
  ('external_pos_card','external_pos',true,false),
  ('external_pos_other','external_pos',true,false),
  ('cash_app','internal',true,false),
  ('zelle','internal',true,false),
  ('chime','internal',true,false),
  ('paypal','internal',true,false)
) as v(payment_method,payment_channel,requires_reference,cash_drawer)
on conflict(location_id,payment_method) do nothing;

alter table public.payment_method_routes enable row level security;
drop policy if exists payment_method_routes_staff_read on public.payment_method_routes;
create policy payment_method_routes_staff_read on public.payment_method_routes
for select to authenticated
using (location_id=public.current_location_id());
revoke all on public.payment_method_routes from anon;
grant select on public.payment_method_routes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Immutable sales ledger. Revenue is posted when the work-order sale closes.
--    Each tender component is classified as external POS or internal/direct.
-- ---------------------------------------------------------------------------
create table if not exists public.sales_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  ticket_id uuid references public.repair_tickets(id) on delete set null,
  receipt_id uuid references public.receipts(id) on delete set null,
  entry_type text not null default 'sale' check (entry_type in ('sale','refund','adjustment')),
  source_component text not null default 'checkout',
  payment_method text not null,
  payment_channel text not null check (payment_channel in ('external_pos','internal')),
  net_sales_cents integer not null default 0,
  tax_cents integer not null default 0,
  collected_cents integer not null default 0,
  payment_reference text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sales_ledger_amount_consistency check (
    (entry_type='sale' and net_sales_cents>=0 and tax_cents>=0 and collected_cents>=0)
    or entry_type in ('refund','adjustment')
  ),
  unique(receipt_id,source_component)
);
create index if not exists sales_ledger_location_date_idx on public.sales_ledger_entries(location_id,business_date,occurred_at);
create index if not exists sales_ledger_receipt_idx on public.sales_ledger_entries(receipt_id);
create index if not exists sales_ledger_ticket_idx on public.sales_ledger_entries(ticket_id);

alter table public.sales_ledger_entries enable row level security;
drop policy if exists sales_ledger_dashboard_read on public.sales_ledger_entries;
create policy sales_ledger_dashboard_read on public.sales_ledger_entries
for select to authenticated
using (
  location_id=public.current_location_id()
  and (
    coalesce(public.has_permission('dashboard.view'),false)
    or coalesce(public.has_permission('reports.view'),false)
    or coalesce(public.has_permission('settings.manage'),false)
  )
);
revoke all on public.sales_ledger_entries from anon;
grant select on public.sales_ledger_entries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily goals are predicted, then locked when Start Day is performed.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_sales_goals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  predicted_goal_cents integer not null default 0 check (predicted_goal_cents>=0),
  final_goal_cents integer not null default 0 check (final_goal_cents>=0),
  goal_method text not null,
  formula_inputs jsonb not null default '{}'::jsonb,
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  is_locked boolean not null default false,
  locked_at timestamptz,
  override_reason text,
  overridden_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id,business_date)
);
create index if not exists daily_sales_goals_location_date_idx on public.daily_sales_goals(location_id,business_date);

alter table public.daily_sales_goals enable row level security;
drop policy if exists daily_sales_goals_staff_read on public.daily_sales_goals;
create policy daily_sales_goals_staff_read on public.daily_sales_goals
for select to authenticated
using (location_id=public.current_location_id() and coalesce(public.has_permission('dashboard.view'),false));
revoke all on public.daily_sales_goals from anon;
grant select on public.daily_sales_goals to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Business day / closeout extensions and reconciliation audit trail.
-- ---------------------------------------------------------------------------
alter table public.business_day_sessions
  add column if not exists opening_cash_cents integer not null default 0,
  add column if not exists opening_note text;

alter table public.business_day_sessions
  drop constraint if exists business_day_sessions_opening_cash_nonnegative;
alter table public.business_day_sessions
  add constraint business_day_sessions_opening_cash_nonnegative check (opening_cash_cents>=0);

alter table public.daily_closeouts
  add column if not exists portal_external_expected_cents integer not null default 0,
  add column if not exists portal_internal_sales_cents integer not null default 0,
  add column if not exists portal_external_tax_cents integer not null default 0,
  add column if not exists portal_internal_tax_cents integer not null default 0,
  add column if not exists reconciled_total_sales_cents integer not null default 0,
  add column if not exists reconciliation_status text,
  add column if not exists reconciliation_confidence integer,
  add column if not exists goal_formula_inputs jsonb not null default '{}'::jsonb;

create table if not exists public.reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  event_type text not null check (event_type in ('started','closed','reopened','goal_override','adjustment')),
  actor_user_id uuid references public.profiles(id),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reconciliation_events_location_date_idx on public.reconciliation_events(location_id,business_date,created_at);
alter table public.reconciliation_events enable row level security;
drop policy if exists reconciliation_events_reports_read on public.reconciliation_events;
create policy reconciliation_events_reports_read on public.reconciliation_events
for select to authenticated
using (
  location_id=public.current_location_id()
  and (coalesce(public.has_permission('reports.view'),false) or coalesce(public.has_permission('settings.manage'),false))
);
revoke all on public.reconciliation_events from anon;
grant select on public.reconciliation_events to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internal helpers.
-- ---------------------------------------------------------------------------
create or replace function public.payment_channel_for_method(target_location uuid,target_method text)
returns text
language plpgsql
stable
security definer
set search_path=public
as $$
declare result text;
begin
  select r.payment_channel into result
  from public.payment_method_routes r
  where r.location_id=target_location and r.payment_method=target_method and r.active=true;
  if result is null then
    result:=case when target_method in ('cash','external_pos_cash','external_pos_card','external_pos_other') then 'external_pos' else 'internal' end;
  end if;
  return result;
end;
$$;

create or replace function public.is_payment_method_enabled(target_location uuid,target_method text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare cfg public.business_settings;
begin
  select * into cfg from public.business_settings where location_id=target_location;
  if cfg.location_id is null then return false; end if;
  return case target_method
    when 'cash' then coalesce(cfg.payments_cash_enabled,false)
    when 'external_pos_cash' then coalesce(cfg.payments_cash_enabled,false)
    when 'external_pos_card' then coalesce(cfg.payments_external_card_enabled,false)
    when 'external_pos_other' then coalesce(cfg.payments_external_other_enabled,false)
    when 'cash_app' then coalesce(cfg.payments_cash_app_enabled,false)
    when 'zelle' then coalesce(cfg.payments_zelle_enabled,false)
    when 'chime' then coalesce(cfg.payments_chime_enabled,false)
    when 'paypal' then coalesce(cfg.payments_paypal_enabled,false)
    else false
  end;
end;
$$;

create or replace function public.post_receipt_to_sales_ledger(target_receipt uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.receipts;
  total_paid integer;
  prepaid integer;
  checkout_paid integer;
  prepaid_net integer;
  prepaid_tax integer;
  checkout_net integer;
  checkout_tax integer;
  route text;
begin
  select * into r from public.receipts where id=target_receipt for update;
  if r.id is null then raise exception 'Receipt not found.'; end if;

  total_paid:=greatest(coalesce(r.amount_paid_cents,r.total_cents,0),0);
  prepaid:=greatest(coalesce(r.prepayment_amount_cents,0),0);
  checkout_paid:=greatest(coalesce(r.checkout_amount_cents,0),0);

  if prepaid+checkout_paid=0 and total_paid>0 then
    route:=public.payment_channel_for_method(r.location_id,coalesce(r.payment_method,'external_pos_other'));
    insert into public.sales_ledger_entries(
      location_id,business_date,ticket_id,receipt_id,entry_type,source_component,payment_method,payment_channel,
      net_sales_cents,tax_cents,collected_cents,payment_reference,occurred_at,created_by,metadata
    ) values(
      r.location_id,r.business_date,r.ticket_id,r.id,'sale','legacy',coalesce(r.payment_method,'external_pos_other'),route,
      coalesce(r.subtotal_cents,0),coalesce(r.tax_cents,0),total_paid,r.payment_reference,coalesce(r.created_at,now()),r.created_by,
      jsonb_build_object('source','receipt_backfill')
    ) on conflict(receipt_id,source_component) do nothing;
    return;
  end if;

  if prepaid>0 then
    prepaid_net:=case when total_paid>0 then round(coalesce(r.subtotal_cents,0)::numeric*prepaid/total_paid)::integer else 0 end;
    prepaid_tax:=case when total_paid>0 then round(coalesce(r.tax_cents,0)::numeric*prepaid/total_paid)::integer else 0 end;
    route:=public.payment_channel_for_method(r.location_id,coalesce(r.prepayment_method,'external_pos_other'));
    insert into public.sales_ledger_entries(
      location_id,business_date,ticket_id,receipt_id,entry_type,source_component,payment_method,payment_channel,
      net_sales_cents,tax_cents,collected_cents,payment_reference,occurred_at,created_by,metadata
    ) values(
      r.location_id,r.business_date,r.ticket_id,r.id,'sale','prepayment',coalesce(r.prepayment_method,'external_pos_other'),route,
      prepaid_net,prepaid_tax,prepaid,r.prepayment_reference,coalesce(r.created_at,now()),r.created_by,
      jsonb_build_object('source','receipt')
    ) on conflict(receipt_id,source_component) do nothing;
  else
    prepaid_net:=0; prepaid_tax:=0;
  end if;

  if checkout_paid>0 then
    checkout_net:=coalesce(r.subtotal_cents,0)-coalesce(prepaid_net,0);
    checkout_tax:=coalesce(r.tax_cents,0)-coalesce(prepaid_tax,0);
    route:=public.payment_channel_for_method(r.location_id,coalesce(r.checkout_payment_method,r.payment_method,'external_pos_other'));
    insert into public.sales_ledger_entries(
      location_id,business_date,ticket_id,receipt_id,entry_type,source_component,payment_method,payment_channel,
      net_sales_cents,tax_cents,collected_cents,payment_reference,occurred_at,created_by,metadata
    ) values(
      r.location_id,r.business_date,r.ticket_id,r.id,'sale','checkout',coalesce(r.checkout_payment_method,r.payment_method,'external_pos_other'),route,
      checkout_net,checkout_tax,checkout_paid,r.checkout_payment_reference,coalesce(r.created_at,now()),r.created_by,
      jsonb_build_object('source','receipt')
    ) on conflict(receipt_id,source_component) do nothing;
  end if;
end;
$$;

do $$
declare x record;
begin
  for x in select id from public.receipts loop
    perform public.post_receipt_to_sales_ledger(x.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Predictive goal engine.
-- ---------------------------------------------------------------------------
create or replace function public.predict_daily_sales_goal(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  biz_date date;
  bs public.business_settings;
  day_key text;
  hours_json jsonb;
  open_start time;
  open_end time;
  open_hours numeric:=0;
  scheduled_hours numeric:=0;
  week_hours numeric:=0;
  target_splh numeric:=0;
  weekly_forecast integer:=0;
  forecast_day numeric:=0;
  capacity_hours numeric:=0;
  capacity_goal numeric:=0;
  operating_goal numeric:=0;
  history_count integer:=0;
  same_weekday_avg numeric;
  trailing30_avg numeric;
  ytd_avg numeric;
  history_goal numeric:=0;
  history_weight numeric:=0;
  last14_avg numeric;
  prior14_avg numeric;
  trend_factor numeric:=1;
  active_pipeline numeric:=0;
  appointment_count integer:=0;
  historical_aov numeric;
  active_aov numeric;
  predicted_aov numeric:=0;
  appointment_demand numeric:=0;
  demand_signal numeric:=0;
  launch_fallback integer:=0;
  growth_pct numeric:=0;
  adaptive boolean:=true;
  raw_goal numeric:=0;
  rounded_goal integer:=0;
  method text:='predictive_capacity_bootstrap';
  confidence integer:=35;
  sw_id uuid;
begin
  if loc is null or not coalesce(public.has_permission('dashboard.view'),false) then
    raise exception 'You do not have permission to view sales goals.';
  end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  select * into bs from public.business_settings where location_id=loc;
  if bs.location_id is null then raise exception 'Business settings are not configured.'; end if;

  day_key:=case extract(isodow from biz_date)::integer
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed' when 4 then 'thu'
    when 5 then 'fri' when 6 then 'sat' else 'sun' end;
  hours_json:=bs.store_hours->day_key;
  if jsonb_typeof(hours_json)='array' and jsonb_array_length(hours_json)>=2 then
    begin
      open_start:=(hours_json->>0)::time;
      open_end:=(hours_json->>1)::time;
      open_hours:=case when open_end>=open_start
        then extract(epoch from (open_end-open_start))/3600.0
        else (extract(epoch from (open_end-open_start))/3600.0)+24 end;
    exception when others then open_hours:=0;
    end;
  end if;

  select sw.id,coalesce(sw.target_splh,bs.target_splh,125),coalesce(sw.forecast_sales_cents,0)
    into sw_id,target_splh,weekly_forecast
  from public.schedule_weeks sw
  where sw.location_id=loc and biz_date between sw.week_start and sw.week_start+6
  order by sw.week_start desc limit 1;
  target_splh:=coalesce(target_splh,bs.target_splh,125);

  select coalesce(sum(greatest(
    ((extract(hour from s.ends_at)::numeric*60+extract(minute from s.ends_at)::numeric)
     -(extract(hour from s.starts_at)::numeric*60+extract(minute from s.starts_at)::numeric)
     -coalesce(s.break_minutes,0))/60.0,0)),0)
  into scheduled_hours from public.shifts s where s.location_id=loc and s.shift_date=biz_date;

  if sw_id is not null then
    select coalesce(sum(greatest(
      ((extract(hour from s.ends_at)::numeric*60+extract(minute from s.ends_at)::numeric)
       -(extract(hour from s.starts_at)::numeric*60+extract(minute from s.starts_at)::numeric)
       -coalesce(s.break_minutes,0))/60.0,0)),0)
    into week_hours from public.shifts s where s.schedule_week_id=sw_id;
  end if;

  capacity_hours:=case when scheduled_hours>0 then scheduled_hours else open_hours end;
  capacity_goal:=greatest(target_splh,0)*100*greatest(capacity_hours,0);
  if weekly_forecast>0 and scheduled_hours>0 and week_hours>0 then
    forecast_day:=weekly_forecast*(scheduled_hours/week_hours);
  end if;
  operating_goal:=case
    when capacity_goal>0 and forecast_day>0 then capacity_goal*.70+forecast_day*.30
    when capacity_goal>0 then capacity_goal
    when forecast_day>0 then forecast_day
    else 0 end;

  select coalesce(sg.launch_daily_goal_cents,0),coalesce(sg.growth_target_pct,0),coalesce(sg.adaptive_enabled,true)
  into launch_fallback,growth_pct,adaptive
  from public.sales_goal_settings sg where sg.location_id=loc;
  launch_fallback:=coalesce(launch_fallback,0);
  growth_pct:=coalesce(growth_pct,0);
  adaptive:=coalesce(adaptive,true);

  select count(*) into history_count
  from public.daily_closeouts c
  where c.location_id=loc and c.status='closed' and c.business_date<biz_date;

  select avg(x.sales) into same_weekday_avg from (
    select case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents
                else c.pos_net_sales_cents end as sales
    from public.daily_closeouts c
    where c.location_id=loc and c.status='closed' and c.business_date<biz_date
      and extract(isodow from c.business_date)=extract(isodow from biz_date)
    order by c.business_date desc limit 8
  ) x;

  select avg(x.sales) into trailing30_avg from (
    select case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents
                else c.pos_net_sales_cents end as sales
    from public.daily_closeouts c
    where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    order by c.business_date desc limit 30
  ) x;

  select avg(case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                  when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                  when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents
                  else c.pos_net_sales_cents end)
  into ytd_avg from public.daily_closeouts c
  where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    and extract(year from c.business_date)=extract(year from biz_date);

  if same_weekday_avg is not null then history_goal:=history_goal+same_weekday_avg*.50;history_weight:=history_weight+.50;end if;
  if trailing30_avg is not null then history_goal:=history_goal+trailing30_avg*.35;history_weight:=history_weight+.35;end if;
  if ytd_avg is not null then history_goal:=history_goal+ytd_avg*.15;history_weight:=history_weight+.15;end if;
  if history_weight>0 then history_goal:=history_goal/history_weight; end if;

  select avg(sales) into last14_avg from (
    select case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents else c.pos_net_sales_cents end sales
    from public.daily_closeouts c where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    order by c.business_date desc limit 14
  ) q;
  select avg(sales) into prior14_avg from (
    select sales from (
      select case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                  when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                  when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents else c.pos_net_sales_cents end sales,
             row_number() over(order by c.business_date desc) rn
      from public.daily_closeouts c where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    ) ranked where rn between 15 and 28
  ) q;
  if coalesce(last14_avg,0)>0 and coalesce(prior14_avg,0)>0 then
    trend_factor:=greatest(.85,least(1.15,last14_avg/prior14_avg));
    history_goal:=history_goal*trend_factor;
  end if;

  select coalesce(sum(coalesce(t.subtotal_cents,0) * case t.status::text
    when 'repaired' then .95 when 'ready_for_pickup' then .95 when 'quality_inspection' then .90
    when 'testing_in_progress' then .80 when 'repair_in_progress' then .75
    when 'awaiting_parts' then .55 when 'waiting_on_parts' then .55 when 'need_to_order_parts' then .40
    when 'diagnostic_in_progress' then .40 when 'awaiting_diagnostic' then .30 when 'awaiting_repair' then .25
    else .20 end),0)
  into active_pipeline
  from public.repair_tickets t
  where t.location_id=loc and t.status::text not in ('sale_complete','completed','cancelled','unrepairable','customer_declined','abandoned');

  select count(*) into appointment_count from public.appointments a
  where a.location_id=loc
    and coalesce((a.starts_at at time zone coalesce(bs.store_timezone,'America/New_York'))::date,a.preferred_date,(a.created_at at time zone coalesce(bs.store_timezone,'America/New_York'))::date)=biz_date
    and a.status not in ('cancelled','no_show','completed');

  select case when sum(coalesce(c.portal_sale_count,0))>0
         then sum(case when coalesce(c.reconciled_total_sales_cents,0)>0 then c.reconciled_total_sales_cents
                       when coalesce(c.portal_internal_sales_cents,0)>0 then coalesce(c.pos_net_sales_cents,0)+c.portal_internal_sales_cents
                       when coalesce(c.portal_sales_cents,0)>0 then c.portal_sales_cents else c.pos_net_sales_cents end)::numeric
              /sum(c.portal_sale_count) else null end
  into historical_aov
  from public.daily_closeouts c
  where c.location_id=loc and c.status='closed' and c.business_date<biz_date;

  select avg(nullif(t.subtotal_cents,0)) into active_aov from public.repair_tickets t
  where t.location_id=loc and t.status::text not in ('sale_complete','completed','cancelled','unrepairable','customer_declined','abandoned') and coalesce(t.subtotal_cents,0)>0;

  predicted_aov:=coalesce(historical_aov,active_aov,greatest(target_splh,0)*100*1.25,0);
  appointment_demand:=appointment_count*predicted_aov*.55;
  demand_signal:=active_pipeline+appointment_demand;

  if operating_goal<=0 and launch_fallback>0 then operating_goal:=launch_fallback; end if;
  if operating_goal<=0 and demand_signal>0 then operating_goal:=demand_signal; end if;

  if not adaptive then
    raw_goal:=operating_goal;method:='predictive_capacity_fixed';confidence:=case when scheduled_hours>0 then 55 else 40 end;
  elsif history_count=0 then
    raw_goal:=operating_goal;method:='predictive_capacity_bootstrap';confidence:=case when scheduled_hours>0 then 45 else 35 end;
  elsif history_count<10 then
    raw_goal:=case when demand_signal>0 then operating_goal*.75+demand_signal*.25 else operating_goal end;
    method:='predictive_launch_blend';confidence:=50;
  elsif history_count<30 then
    raw_goal:=operating_goal*.45+history_goal*.35+demand_signal*.20;
    method:='predictive_adaptive_blend';confidence:=75;
  else
    raw_goal:=operating_goal*.30+history_goal*.50+demand_signal*.20;
    method:='predictive_history_weighted';confidence:=90;
  end if;

  raw_goal:=greatest(raw_goal*(1+growth_pct/100.0),0);
  if raw_goal>0 then rounded_goal:=greatest(2500,(round(raw_goal/2500.0)*2500)::integer); else rounded_goal:=0; end if;

  return jsonb_build_object(
    'business_date',biz_date,'goal_cents',rounded_goal,'goal_method',method,'confidence_score',confidence,
    'scheduled_hours',round(scheduled_hours,2),'store_open_hours',round(open_hours,2),'capacity_hours',round(capacity_hours,2),
    'target_splh',target_splh,'capacity_goal_cents',round(capacity_goal)::integer,'weekly_forecast_cents',weekly_forecast,
    'forecast_day_cents',round(forecast_day)::integer,'history_days',history_count,
    'same_weekday_avg_cents',round(coalesce(same_weekday_avg,0))::integer,'trailing30_avg_cents',round(coalesce(trailing30_avg,0))::integer,
    'ytd_avg_cents',round(coalesce(ytd_avg,0))::integer,'trend_factor',round(trend_factor,3),
    'active_pipeline_expected_cents',round(active_pipeline)::integer,'appointment_count',appointment_count,
    'predicted_aov_cents',round(predicted_aov)::integer,'appointment_demand_cents',round(appointment_demand)::integer,
    'growth_target_pct',growth_pct
  );
end;
$$;

create or replace function public.lock_daily_sales_goal(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  biz_date date;
  prediction jsonb;
  item public.daily_sales_goals;
begin
  if loc is null or not coalesce(public.has_permission('settings.manage'),false) then
    raise exception 'Management permission required to lock the business-day goal.';
  end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  prediction:=public.predict_daily_sales_goal(biz_date);
  insert into public.daily_sales_goals(location_id,business_date,predicted_goal_cents,final_goal_cents,goal_method,formula_inputs,confidence_score,is_locked,locked_at)
  values(loc,biz_date,(prediction->>'goal_cents')::integer,(prediction->>'goal_cents')::integer,prediction->>'goal_method',prediction,(prediction->>'confidence_score')::integer,true,now())
  on conflict(location_id,business_date) do update set
    predicted_goal_cents=case when public.daily_sales_goals.is_locked then public.daily_sales_goals.predicted_goal_cents else excluded.predicted_goal_cents end,
    final_goal_cents=case when public.daily_sales_goals.is_locked then public.daily_sales_goals.final_goal_cents else excluded.final_goal_cents end,
    goal_method=case when public.daily_sales_goals.is_locked then public.daily_sales_goals.goal_method else excluded.goal_method end,
    formula_inputs=case when public.daily_sales_goals.is_locked then public.daily_sales_goals.formula_inputs else excluded.formula_inputs end,
    confidence_score=case when public.daily_sales_goals.is_locked then public.daily_sales_goals.confidence_score else excluded.confidence_score end,
    is_locked=true,locked_at=coalesce(public.daily_sales_goals.locked_at,now()),updated_at=now()
  returning * into item;
  return jsonb_build_object('business_date',item.business_date,'goal_cents',item.final_goal_cents,'goal_method',item.goal_method,'confidence_score',item.confidence_score,'is_locked',item.is_locked,'formula_inputs',item.formula_inputs);
end;
$$;

drop function if exists public.start_business_day(date);
create or replace function public.start_business_day(target_date date default null, opening_cash_cents integer default 0, opening_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  biz_date date;
  row_item public.business_day_sessions;
  goal jsonb;
begin
  if loc is null or not coalesce(public.has_permission('settings.manage'),false) then raise exception 'Management permission required to start a business day.'; end if;
  if coalesce(opening_cash_cents,0)<0 then raise exception 'Opening cash cannot be negative.'; end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  if exists(select 1 from public.daily_closeouts where location_id=loc and business_date=biz_date and status='closed') then raise exception 'This business day is already closed. Reopen it before starting it again.'; end if;
  goal:=public.lock_daily_sales_goal(biz_date);
  insert into public.business_day_sessions(location_id,business_date,status,started_by,started_at,opening_cash_cents,opening_note,updated_at)
  values(loc,biz_date,'open',auth.uid(),now(),coalesce(opening_cash_cents,0),nullif(trim(opening_note),''),now())
  on conflict(location_id,business_date) do update set status='open',started_by=coalesce(public.business_day_sessions.started_by,excluded.started_by),started_at=coalesce(public.business_day_sessions.started_at,excluded.started_at),opening_cash_cents=case when public.business_day_sessions.started_at is null then excluded.opening_cash_cents else public.business_day_sessions.opening_cash_cents end,opening_note=coalesce(public.business_day_sessions.opening_note,excluded.opening_note),updated_at=now()
  returning * into row_item;
  insert into public.reconciliation_events(location_id,business_date,event_type,actor_user_id,details)
  values(loc,biz_date,'started',auth.uid(),jsonb_build_object('opening_cash_cents',row_item.opening_cash_cents,'goal_cents',goal->>'goal_cents','goal_method',goal->>'goal_method'));
  return jsonb_build_object('business_date',row_item.business_date,'status','open','started_at',row_item.started_at,'started_by',row_item.started_by,'opening_cash_cents',row_item.opening_cash_cents,'opening_note',row_item.opening_note,'goal',goal);
end;
$$;

create or replace function public.get_business_day_state(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare loc uuid:=public.current_location_id();biz_date date;session_row public.business_day_sessions;close_row public.daily_closeouts;goal_row public.daily_sales_goals;
begin
  if loc is null or not coalesce(public.has_permission('dashboard.view'),false) then raise exception 'You do not have permission to view business-day state.'; end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  select * into session_row from public.business_day_sessions where location_id=loc and business_date=biz_date limit 1;
  select * into close_row from public.daily_closeouts where location_id=loc and business_date=biz_date limit 1;
  select * into goal_row from public.daily_sales_goals where location_id=loc and business_date=biz_date limit 1;
  return jsonb_build_object('business_date',biz_date,'status',case when close_row.id is not null and close_row.status='closed' then 'closed' when session_row.id is not null or (close_row.id is not null and close_row.status='reopened') then 'open' else 'not_started' end,'started_at',session_row.started_at,'started_by',session_row.started_by,'opening_cash_cents',coalesce(session_row.opening_cash_cents,0),'opening_note',session_row.opening_note,'closed_at',case when close_row.status='closed' then close_row.closed_at else null end,'reconciliation_status',close_row.reconciliation_status,'goal_locked',coalesce(goal_row.is_locked,false),'goal_cents',goal_row.final_goal_cents,'goal_method',goal_row.goal_method);
end;
$$;

create or replace function public.get_payment_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare cfg public.business_settings;routes jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into cfg from public.business_settings where location_id=public.current_location_id();
  if cfg.location_id is null then raise exception 'Business settings are not configured'; end if;
  select coalesce(jsonb_object_agg(r.payment_method,jsonb_build_object('channel',r.payment_channel,'requires_reference',r.requires_reference,'cash_drawer',r.cash_drawer)),'{}'::jsonb) into routes from public.payment_method_routes r where r.location_id=cfg.location_id and r.active=true;
  return jsonb_build_object('prepay_required',false,'routing_mode',cfg.payment_routing_mode,'methods',jsonb_build_object('cash',cfg.payments_cash_enabled,'external_pos_card',cfg.payments_external_card_enabled,'external_pos_other',cfg.payments_external_other_enabled,'cash_app',cfg.payments_cash_app_enabled,'zelle',cfg.payments_zelle_enabled,'chime',cfg.payments_chime_enabled,'paypal',cfg.payments_paypal_enabled),'routes',routes,'paypal_automatic_verification',cfg.paypal_automatic_verification_enabled);
end;
$$;

create or replace function public.finalize_repair_sale(target_ticket uuid,payment_method text,payment_reference text default null,paid_amount_cents integer default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();t public.repair_tickets;c public.customers;d public.devices;p public.payment_requests;r public.receipts;biz_date date;expected integer:=0;prepaid integer:=0;balance_due integer:=0;checkout_paid integer:=0;tender text:=coalesce(nullif(trim(payment_method),''),'external_pos_card');reference_text text:=nullif(trim(coalesce(payment_reference,'')),'');combined_method text;combined_reference text;lines jsonb;route_row public.payment_method_routes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if loc is null or not coalesce(public.has_permission('ready_pickup.checkout'),false) then raise exception 'Checkout permission required.'; end if;
  select * into t from public.repair_tickets where id=target_ticket and location_id=loc for update;
  if not found then raise exception 'Work order not found.'; end if;
  if t.status::text not in ('repaired','ready_for_pickup') then raise exception 'Work order must be Ready for Pickup before Sale Complete.'; end if;
  if exists(select 1 from public.receipts where ticket_id=t.id) then raise exception 'This work order already has a completed sale receipt.'; end if;
  expected:=greatest(coalesce(t.total_cents,0),0);
  if t.payment_request_id is not null then select * into p from public.payment_requests where id=t.payment_request_id and location_id=loc and ticket_id=t.id and status='verified' for update;if p.id is not null then prepaid:=greatest(coalesce(p.amount_verified_cents,0),0); end if;end if;
  if prepaid>expected then raise exception 'Verified prepayment exceeds the final work-order total. Resolve the overpayment before completing the sale.'; end if;
  balance_due:=expected-prepaid;checkout_paid:=coalesce(paid_amount_cents,balance_due);
  if checkout_paid<0 or checkout_paid<>balance_due then raise exception 'Checkout amount must equal the remaining balance after verified prepayment.'; end if;
  if balance_due>0 then
    if not public.is_payment_method_enabled(loc,tender) then raise exception 'That payment method is not enabled for this location.'; end if;
    select * into route_row from public.payment_method_routes where location_id=loc and payment_method=tender and active=true;
    if route_row.payment_method is null then raise exception 'Payment route is not configured for this method.'; end if;
    if route_row.requires_reference and reference_text is null then if route_row.payment_channel='external_pos' then raise exception 'Enter the external POS receipt or transaction reference.'; else raise exception 'Enter the payment confirmation or transaction reference.'; end if;end if;
  else tender:='prepaid';reference_text:=null;end if;
  select * into c from public.customers where id=t.customer_id;select * into d from public.devices where id=t.device_id;biz_date:=public.current_business_date(loc);
  select coalesce(jsonb_agg(jsonb_build_object('item_type',w.item_type,'sku',w.sku,'description',w.description,'quantity',w.quantity,'unit_price_cents',coalesce(w.unit_price_cents,0),'unit_cost_cents',coalesce(w.unit_cost_cents,0),'line_total_cents',round(coalesce(w.quantity,1)*coalesce(w.unit_price_cents,0))::integer,'part_pricing_mode',w.part_pricing_mode) order by w.created_at),'[]'::jsonb) into lines from public.work_order_items w where w.ticket_id=t.id;
  combined_method:=case when prepaid>0 and checkout_paid>0 then 'split' when prepaid>0 then coalesce(p.payment_method,'prepaid') else tender end;
  combined_reference:=case when prepaid>0 and checkout_paid>0 then concat_ws(' | ',case when p.payment_reference is not null then 'Prepay '||p.payment_reference end,case when reference_text is not null then 'Checkout '||reference_text end) when prepaid>0 then p.payment_reference else reference_text end;
  perform set_config('app.repair_status_advance','allowed',true);
  update public.repair_tickets set payment_status='paid',amount_paid_cents=expected,payment_method=combined_method,payment_reference=combined_reference,paid_at=now(),status='sale_complete',pickup_at=coalesce(pickup_at,now()),completed_at=coalesce(completed_at,now()),sale_completed_at=now(),sale_business_date=biz_date,updated_at=now() where id=t.id;
  insert into public.ticket_events(ticket_id,actor_user_id,event_type,message,visibility) values(t.id,auth.uid(),'sale_complete','Sale complete · total '||(expected::numeric/100)::text||' · prepayment '||(prepaid::numeric/100)::text||' · checkout '||(checkout_paid::numeric/100)::text,'internal');
  insert into public.receipts(location_id,ticket_id,ticket_number,business_date,customer_id,customer_name,customer_email,device_description,subtotal_cents,tax_cents,total_cents,amount_paid_cents,payment_method,payment_reference,line_items,created_by,prepayment_amount_cents,prepayment_method,prepayment_reference,checkout_amount_cents,checkout_payment_method,checkout_payment_reference)
  values(loc,t.id,t.ticket_number,biz_date,t.customer_id,trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),nullif(trim(c.email),''),nullif(trim(concat_ws(' ',d.manufacturer,d.model)),''),coalesce(t.subtotal_cents,0),coalesce(t.tax_cents,0),expected,expected,combined_method,combined_reference,lines,auth.uid(),prepaid,case when p.id is null then null else p.payment_method end,case when p.id is null then null else p.payment_reference end,checkout_paid,case when checkout_paid>0 then tender else null end,case when checkout_paid>0 then reference_text else null end) returning * into r;
  perform public.post_receipt_to_sales_ledger(r.id);
  return jsonb_build_object('receipt_id',r.id,'receipt_number',r.receipt_number,'ticket_id',r.ticket_id,'ticket_number',r.ticket_number,'business_date',r.business_date,'customer_name',r.customer_name,'customer_email',r.customer_email,'device_description',r.device_description,'subtotal_cents',r.subtotal_cents,'tax_cents',r.tax_cents,'total_cents',r.total_cents,'amount_paid_cents',r.amount_paid_cents,'payment_method',r.payment_method,'payment_reference',r.payment_reference,'line_items',r.line_items,'created_at',r.created_at,'prepayment_amount_cents',r.prepayment_amount_cents,'prepayment_method',r.prepayment_method,'prepayment_reference',r.prepayment_reference,'checkout_amount_cents',r.checkout_amount_cents,'checkout_payment_method',r.checkout_payment_method,'checkout_payment_reference',r.checkout_payment_reference,'checkout_payment_channel',case when checkout_paid>0 then public.payment_channel_for_method(loc,tender) else null end);
end;
$$;

create or replace function public.finalize_external_pos_sale(target_ticket uuid,pos_reference text default null,pos_tender text default 'external_pos_card',paid_amount_cents integer default null)
returns jsonb language sql security definer set search_path=public as $$ select public.finalize_repair_sale(target_ticket,pos_tender,pos_reference,paid_amount_cents); $$;

create or replace function public.get_sales_day_summary(target_date date default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();biz_date date;external_sales integer:=0;internal_sales integer:=0;external_tax integer:=0;internal_tax integer:=0;current_sales integer:=0;sale_count integer:=0;part_cost integer:=0;part_revenue integer:=0;part_margin integer:=0;bundled_part_cost integer:=0;is_closed boolean:=false;close_status text;closed_at_value timestamptz;recon_status text;goal_row public.daily_sales_goals;manual_goal integer;prediction jsonb;goal_value integer:=0;goal_method text:='unset';confidence integer:=0;goal_inputs jsonb:='{}'::jsonb;goal_locked boolean:=false;remaining integer:=0;percent numeric:=0;last_update timestamptz;charge_parts boolean:=false;closed_total integer:=0;
begin
  if loc is null or not coalesce(public.has_permission('dashboard.view'),false) then raise exception 'You do not have permission to view sales reporting.'; end if;
  biz_date:=coalesce(target_date,public.current_business_date(loc));
  select coalesce(bs.charge_parts_to_customer,false) into charge_parts from public.business_settings bs where bs.location_id=loc;
  select dc.status,dc.closed_at,dc.reconciliation_status,dc.portal_external_expected_cents,dc.portal_internal_sales_cents,dc.portal_external_tax_cents,dc.portal_internal_tax_cents,dc.reconciled_total_sales_cents into close_status,closed_at_value,recon_status,external_sales,internal_sales,external_tax,internal_tax,closed_total from public.daily_closeouts dc where dc.location_id=loc and dc.business_date=biz_date limit 1;
  if close_status='closed' then is_closed:=true;current_sales:=coalesce(closed_total,0);else
    select coalesce(sum(case when e.payment_channel='external_pos' then e.net_sales_cents else 0 end),0)::integer,coalesce(sum(case when e.payment_channel='internal' then e.net_sales_cents else 0 end),0)::integer,coalesce(sum(case when e.payment_channel='external_pos' then e.tax_cents else 0 end),0)::integer,coalesce(sum(case when e.payment_channel='internal' then e.tax_cents else 0 end),0)::integer,max(e.occurred_at) into external_sales,internal_sales,external_tax,internal_tax,last_update from public.sales_ledger_entries e where e.location_id=loc and e.business_date=biz_date;
    current_sales:=coalesce(external_sales,0)+coalesce(internal_sales,0);
  end if;
  select count(*)::integer into sale_count from public.receipts r where r.location_id=loc and r.business_date=biz_date;
  select coalesce(round(sum(w.quantity*coalesce(w.unit_cost_cents,0))),0)::integer,coalesce(round(sum(w.quantity*coalesce(w.unit_price_cents,0))),0)::integer,coalesce(round(sum(case when w.part_pricing_mode='standard' then w.quantity*(coalesce(w.unit_price_cents,0)-coalesce(w.unit_cost_cents,0)) else 0 end)),0)::integer,coalesce(round(sum(case when w.part_pricing_mode='bundled_service' then w.quantity*coalesce(w.unit_cost_cents,0) else 0 end)),0)::integer into part_cost,part_revenue,part_margin,bundled_part_cost from public.work_order_items w join public.repair_tickets t on t.id=w.ticket_id where t.location_id=loc and t.sale_business_date=biz_date and t.sale_completed_at is not null and w.item_type='part';
  select * into goal_row from public.daily_sales_goals where location_id=loc and business_date=biz_date limit 1;
  if goal_row.id is not null then goal_value:=goal_row.final_goal_cents;goal_method:=goal_row.goal_method;confidence:=goal_row.confidence_score;goal_inputs:=goal_row.formula_inputs;goal_locked:=goal_row.is_locked;else
    select o.goal_cents into manual_goal from public.daily_sales_goal_overrides o where o.location_id=loc and o.business_date=biz_date;
    if manual_goal is not null then goal_value:=manual_goal;goal_method:='manual_override';confidence:=100;goal_inputs:=jsonb_build_object('legacy_override',true);else prediction:=public.predict_daily_sales_goal(biz_date);goal_value:=coalesce((prediction->>'goal_cents')::integer,0);goal_method:=coalesce(prediction->>'goal_method','predictive');confidence:=coalesce((prediction->>'confidence_score')::integer,0);goal_inputs:=prediction;end if;
  end if;
  remaining:=greatest(goal_value-current_sales,0);if goal_value>0 then percent:=round(current_sales::numeric/goal_value*100,1);end if;
  return jsonb_build_object('business_date',biz_date,'current_sales_cents',coalesce(current_sales,0),'external_expected_cents',coalesce(external_sales,0),'internal_sales_cents',coalesce(internal_sales,0),'external_tax_cents',coalesce(external_tax,0),'internal_tax_cents',coalesce(internal_tax,0),'collected_total_cents',coalesce(current_sales,0)+coalesce(external_tax,0)+coalesce(internal_tax,0),'sale_complete_count',coalesce(sale_count,0),'goal_cents',coalesce(goal_value,0),'remaining_cents',remaining,'percent_to_goal',percent,'goal_method',goal_method,'goal_confidence',confidence,'goal_locked',goal_locked,'goal_formula_inputs',goal_inputs,'part_cost_cents',coalesce(part_cost,0),'part_revenue_cents',coalesce(part_revenue,0),'part_margin_cents',coalesce(part_margin,0),'bundled_part_cost_cents',coalesce(bundled_part_cost,0),'charge_parts_to_customer',charge_parts,'is_closed',is_closed,'close_status',close_status,'reconciliation_status',recon_status,'last_updated_at',case when is_closed then closed_at_value else coalesce(last_update,now()) end);
end;
$$;

create or replace function public.save_predictive_sales_settings(target_splh_value numeric,growth_target_pct numeric default 0,adaptive_enabled boolean default true)
returns void language plpgsql security definer set search_path=public as $$
declare loc uuid:=public.current_location_id();
begin
  if loc is null or not public.has_permission('settings.manage') then raise exception 'Management permission required.'; end if;
  if target_splh_value is null or target_splh_value<=0 or target_splh_value>10000 then raise exception 'Target sales per labor hour must be greater than zero.'; end if;
  if growth_target_pct<-50 or growth_target_pct>200 then raise exception 'Growth target is outside the allowed range.'; end if;
  update public.business_settings set target_splh=target_splh_value,updated_at=now() where location_id=loc;
  insert into public.sales_goal_settings(location_id,launch_daily_goal_cents,adaptive_enabled,growth_target_pct,updated_by,updated_at) values(loc,null,coalesce(adaptive_enabled,true),coalesce(growth_target_pct,0),auth.uid(),now()) on conflict(location_id) do update set launch_daily_goal_cents=null,adaptive_enabled=excluded.adaptive_enabled,growth_target_pct=excluded.growth_target_pct,updated_by=auth.uid(),updated_at=now();
end;
$$;

create or replace function public.set_daily_sales_goal(target_date date,goal_cents integer,reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare loc uuid:=public.current_location_id();prediction jsonb;
begin
  if loc is null or not public.has_permission('settings.manage') then raise exception 'Management permission required.'; end if;
  if target_date is null or goal_cents is null or goal_cents<0 then raise exception 'A valid date and goal are required.'; end if;
  if nullif(trim(reason),'') is null then raise exception 'A reason is required for a manual daily-goal override.'; end if;
  prediction:=public.predict_daily_sales_goal(target_date);
  insert into public.daily_sales_goals(location_id,business_date,predicted_goal_cents,final_goal_cents,goal_method,formula_inputs,confidence_score,is_locked,locked_at,override_reason,overridden_by,updated_at) values(loc,target_date,coalesce((prediction->>'goal_cents')::integer,goal_cents),goal_cents,'manual_override',prediction,100,true,now(),trim(reason),auth.uid(),now()) on conflict(location_id,business_date) do update set final_goal_cents=excluded.final_goal_cents,goal_method='manual_override',is_locked=true,locked_at=coalesce(public.daily_sales_goals.locked_at,now()),override_reason=excluded.override_reason,overridden_by=auth.uid(),updated_at=now();
  insert into public.daily_sales_goal_overrides(location_id,business_date,goal_cents,reason,set_by,set_at) values(loc,target_date,goal_cents,trim(reason),auth.uid(),now()) on conflict(location_id,business_date) do update set goal_cents=excluded.goal_cents,reason=excluded.reason,set_by=excluded.set_by,set_at=now();
  insert into public.reconciliation_events(location_id,business_date,event_type,actor_user_id,reason,details) values(loc,target_date,'goal_override',auth.uid(),trim(reason),jsonb_build_object('goal_cents',goal_cents,'predicted_goal_cents',prediction->>'goal_cents'));
end;
$$;

create or replace function public.close_business_day(target_date date,pos_reference text,pos_gross_sales_cents integer,pos_discount_cents integer,pos_refund_cents integer,pos_net_sales_cents integer,tax_collected_cents integer,cash_tender_cents integer,card_tender_cents integer,other_tender_cents integer,transaction_count integer,opening_cash_cents integer,cash_paid_out_cents integer,actual_drawer_cents integer,notes text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();existing public.daily_closeouts;result public.daily_closeouts;summary jsonb;session_row public.business_day_sessions;expected_drawer integer;cash_variance integer;tender_variance integer;external_variance integer;collected integer;external_expected integer;internal_sales integer;external_tax integer;internal_tax integer;portal_total integer;reconciled_total integer;portal_count integer;portal_part_cost integer;portal_part_revenue integer;portal_part_margin integer;bundled_part_cost integer;goal_value integer;goal_source text;goal_inputs jsonb;confidence integer;opening_value integer;recon_status text;has_adjustments boolean:=false;
begin
  if loc is null or not coalesce(public.has_permission('settings.manage'),false) then raise exception 'Management permission required to close a business day.'; end if;
  if target_date is null then raise exception 'Business date is required.'; end if;
  if least(coalesce(pos_gross_sales_cents,0),coalesce(pos_discount_cents,0),coalesce(pos_refund_cents,0),coalesce(pos_net_sales_cents,0),coalesce(tax_collected_cents,0),coalesce(cash_tender_cents,0),coalesce(card_tender_cents,0),coalesce(other_tender_cents,0),coalesce(opening_cash_cents,0),coalesce(cash_paid_out_cents,0),coalesce(actual_drawer_cents,0))<0 then raise exception 'Closeout monetary values cannot be negative.'; end if;
  if transaction_count is not null and transaction_count<0 then raise exception 'Transaction count cannot be negative.'; end if;
  select * into existing from public.daily_closeouts where location_id=loc and business_date=target_date for update;if found and existing.status='closed' then raise exception 'This business day is already closed.'; end if;
  select * into session_row from public.business_day_sessions where location_id=loc and business_date=target_date for update;opening_value:=coalesce(session_row.opening_cash_cents,opening_cash_cents,0);
  summary:=public.get_sales_day_summary(target_date);external_expected:=coalesce((summary->>'external_expected_cents')::integer,0);internal_sales:=coalesce((summary->>'internal_sales_cents')::integer,0);external_tax:=coalesce((summary->>'external_tax_cents')::integer,0);internal_tax:=coalesce((summary->>'internal_tax_cents')::integer,0);portal_total:=external_expected+internal_sales;portal_count:=coalesce((summary->>'sale_complete_count')::integer,0);portal_part_cost:=coalesce((summary->>'part_cost_cents')::integer,0);portal_part_revenue:=coalesce((summary->>'part_revenue_cents')::integer,0);portal_part_margin:=coalesce((summary->>'part_margin_cents')::integer,0);bundled_part_cost:=coalesce((summary->>'bundled_part_cost_cents')::integer,0);goal_value:=coalesce((summary->>'goal_cents')::integer,0);goal_source:=summary->>'goal_method';goal_inputs:=coalesce(summary->'goal_formula_inputs','{}'::jsonb);confidence:=coalesce((summary->>'goal_confidence')::integer,0);
  expected_drawer:=opening_value+coalesce(cash_tender_cents,0)-coalesce(cash_paid_out_cents,0);cash_variance:=coalesce(actual_drawer_cents,0)-expected_drawer;collected:=coalesce(pos_net_sales_cents,0)+coalesce(tax_collected_cents,0);tender_variance:=coalesce(cash_tender_cents,0)+coalesce(card_tender_cents,0)+coalesce(other_tender_cents,0)-collected;external_variance:=coalesce(pos_net_sales_cents,0)-external_expected;reconciled_total:=coalesce(pos_net_sales_cents,0)+internal_sales;
  select exists(select 1 from public.sales_ledger_entries where location_id=loc and business_date=target_date and entry_type='adjustment') into has_adjustments;
  recon_status:=case when has_adjustments then 'manager_adjusted' when greatest(abs(cash_variance),abs(tender_variance),abs(external_variance))<=1 then 'perfect' when greatest(abs(cash_variance),abs(tender_variance),abs(external_variance))<=100 then 'minor_variance' else 'needs_review' end;
  if recon_status='needs_review' and nullif(trim(notes),'') is null then raise exception 'A closeout note is required when a reconciliation variance exceeds $1.00.'; end if;
  insert into public.daily_closeouts(location_id,business_date,status,pos_reference,pos_gross_sales_cents,pos_discount_cents,pos_refund_cents,pos_net_sales_cents,tax_collected_cents,cash_tender_cents,card_tender_cents,other_tender_cents,transaction_count,opening_cash_cents,cash_paid_out_cents,expected_drawer_cents,actual_drawer_cents,cash_over_short_cents,tender_variance_cents,notes,closed_by,closed_at,reopened_by,reopened_at,reopen_reason,updated_at,portal_sales_cents,portal_sale_count,portal_part_cost_cents,portal_part_revenue_cents,portal_part_margin_cents,portal_bundled_part_cost_cents,portal_pos_variance_cents,goal_cents,goal_method,portal_external_expected_cents,portal_internal_sales_cents,portal_external_tax_cents,portal_internal_tax_cents,reconciled_total_sales_cents,reconciliation_status,reconciliation_confidence,goal_formula_inputs)
  values(loc,target_date,'closed',nullif(trim(pos_reference),''),coalesce(pos_gross_sales_cents,0),coalesce(pos_discount_cents,0),coalesce(pos_refund_cents,0),coalesce(pos_net_sales_cents,0),coalesce(tax_collected_cents,0),coalesce(cash_tender_cents,0),coalesce(card_tender_cents,0),coalesce(other_tender_cents,0),coalesce(transaction_count,0),opening_value,coalesce(cash_paid_out_cents,0),expected_drawer,coalesce(actual_drawer_cents,0),cash_variance,tender_variance,nullif(trim(notes),''),auth.uid(),now(),null,null,null,now(),portal_total,portal_count,portal_part_cost,portal_part_revenue,portal_part_margin,bundled_part_cost,external_variance,goal_value,goal_source,external_expected,internal_sales,external_tax,internal_tax,reconciled_total,recon_status,confidence,goal_inputs)
  on conflict(location_id,business_date) do update set status='closed',pos_reference=excluded.pos_reference,pos_gross_sales_cents=excluded.pos_gross_sales_cents,pos_discount_cents=excluded.pos_discount_cents,pos_refund_cents=excluded.pos_refund_cents,pos_net_sales_cents=excluded.pos_net_sales_cents,tax_collected_cents=excluded.tax_collected_cents,cash_tender_cents=excluded.cash_tender_cents,card_tender_cents=excluded.card_tender_cents,other_tender_cents=excluded.other_tender_cents,transaction_count=excluded.transaction_count,opening_cash_cents=excluded.opening_cash_cents,cash_paid_out_cents=excluded.cash_paid_out_cents,expected_drawer_cents=excluded.expected_drawer_cents,actual_drawer_cents=excluded.actual_drawer_cents,cash_over_short_cents=excluded.cash_over_short_cents,tender_variance_cents=excluded.tender_variance_cents,notes=excluded.notes,closed_by=auth.uid(),closed_at=now(),reopened_by=null,reopened_at=null,reopen_reason=null,updated_at=now(),portal_sales_cents=excluded.portal_sales_cents,portal_sale_count=excluded.portal_sale_count,portal_part_cost_cents=excluded.portal_part_cost_cents,portal_part_revenue_cents=excluded.portal_part_revenue_cents,portal_part_margin_cents=excluded.portal_part_margin_cents,portal_bundled_part_cost_cents=excluded.portal_bundled_part_cost_cents,portal_pos_variance_cents=excluded.portal_pos_variance_cents,goal_cents=excluded.goal_cents,goal_method=excluded.goal_method,portal_external_expected_cents=excluded.portal_external_expected_cents,portal_internal_sales_cents=excluded.portal_internal_sales_cents,portal_external_tax_cents=excluded.portal_external_tax_cents,portal_internal_tax_cents=excluded.portal_internal_tax_cents,reconciled_total_sales_cents=excluded.reconciled_total_sales_cents,reconciliation_status=excluded.reconciliation_status,reconciliation_confidence=excluded.reconciliation_confidence,goal_formula_inputs=excluded.goal_formula_inputs returning * into result;
  update public.business_day_sessions set status='closed',updated_at=now() where location_id=loc and business_date=target_date;
  insert into public.daily_sales_snapshots(location_id,business_date,net_sales_cents,transaction_count,note,captured_by,captured_at) values(loc,target_date,coalesce(pos_net_sales_cents,0),transaction_count,'Final external POS closeout',auth.uid(),now());
  insert into public.reconciliation_events(location_id,business_date,event_type,actor_user_id,reason,details) values(loc,target_date,'closed',auth.uid(),nullif(trim(notes),''),jsonb_build_object('status',recon_status,'external_expected_cents',external_expected,'pos_net_sales_cents',pos_net_sales_cents,'external_variance_cents',external_variance,'internal_sales_cents',internal_sales,'reconciled_total_sales_cents',reconciled_total,'cash_over_short_cents',cash_variance,'tender_variance_cents',tender_variance));
  return jsonb_build_object('id',result.id,'business_date',result.business_date,'reconciliation_status',recon_status,'portal_external_expected_cents',external_expected,'portal_internal_sales_cents',internal_sales,'portal_sales_cents',portal_total,'pos_net_sales_cents',result.pos_net_sales_cents,'portal_pos_variance_cents',external_variance,'reconciled_total_sales_cents',reconciled_total,'goal_cents',result.goal_cents,'goal_method',result.goal_method,'expected_drawer_cents',result.expected_drawer_cents,'actual_drawer_cents',result.actual_drawer_cents,'cash_over_short_cents',result.cash_over_short_cents,'tender_variance_cents',result.tender_variance_cents,'closed_at',result.closed_at);
end;
$$;

create or replace function public.reopen_business_day(target_date date,reason text)
returns void language plpgsql security definer set search_path=public as $$
declare loc uuid:=public.current_location_id();
begin
  if loc is null or not public.has_permission('settings.manage') then raise exception 'Management permission required.'; end if;
  if nullif(trim(reason),'') is null then raise exception 'A reopen reason is required.'; end if;
  update public.daily_closeouts set status='reopened',reconciliation_status='reopened',reopened_by=auth.uid(),reopened_at=now(),reopen_reason=trim(reason),updated_at=now() where location_id=loc and business_date=target_date and status='closed';
  if not found then raise exception 'Closed business day not found.'; end if;
  update public.business_day_sessions set status='open',updated_at=now() where location_id=loc and business_date=target_date;
  insert into public.reconciliation_events(location_id,business_date,event_type,actor_user_id,reason) values(loc,target_date,'reopened',auth.uid(),trim(reason));
end;
$$;

create or replace function public.add_reconciliation_adjustment(target_date date,payment_channel text,amount_cents integer,reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare loc uuid:=public.current_location_id();entry public.sales_ledger_entries;
begin
  if loc is null or not public.has_permission('settings.manage') then raise exception 'Management permission required.'; end if;
  if payment_channel not in ('external_pos','internal') then raise exception 'Choose external POS or internal.'; end if;
  if amount_cents is null or amount_cents=0 then raise exception 'Adjustment amount cannot be zero.'; end if;
  if nullif(trim(reason),'') is null then raise exception 'An adjustment reason is required.'; end if;
  if exists(select 1 from public.daily_closeouts where location_id=loc and business_date=target_date and status='closed') then raise exception 'Reopen the business day before posting an adjustment.'; end if;
  insert into public.sales_ledger_entries(location_id,business_date,entry_type,source_component,payment_method,payment_channel,net_sales_cents,tax_cents,collected_cents,payment_reference,occurred_at,created_by,metadata) values(loc,target_date,'adjustment','manager_adjustment','manager_adjustment',payment_channel,amount_cents,0,amount_cents,null,now(),auth.uid(),jsonb_build_object('reason',trim(reason))) returning * into entry;
  insert into public.reconciliation_events(location_id,business_date,event_type,actor_user_id,reason,details) values(loc,target_date,'adjustment',auth.uid(),trim(reason),jsonb_build_object('entry_id',entry.id,'payment_channel',payment_channel,'amount_cents',amount_cents));
  return jsonb_build_object('id',entry.id,'business_date',entry.business_date,'payment_channel',entry.payment_channel,'amount_cents',entry.net_sales_cents);
end;
$$;

create or replace function public.get_reconciliation_history(range_start date default null,range_end date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare loc uuid:=public.current_location_id();from_date date;to_date date;rows jsonb;
begin
  if loc is null or not (coalesce(public.has_permission('reports.view'),false) or coalesce(public.has_permission('settings.manage'),false)) then raise exception 'Reports permission required.'; end if;
  to_date:=coalesce(range_end,public.current_business_date(loc));from_date:=coalesce(range_start,to_date-30);
  if to_date<from_date or to_date-from_date>366 then raise exception 'Invalid reconciliation history range.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'reconciliation_status',c.reconciliation_status,'goal_cents',c.goal_cents,'goal_method',c.goal_method,'portal_external_expected_cents',c.portal_external_expected_cents,'portal_internal_sales_cents',c.portal_internal_sales_cents,'portal_sales_cents',c.portal_sales_cents,'pos_net_sales_cents',c.pos_net_sales_cents,'portal_pos_variance_cents',c.portal_pos_variance_cents,'reconciled_total_sales_cents',c.reconciled_total_sales_cents,'tax_collected_cents',c.tax_collected_cents,'cash_over_short_cents',c.cash_over_short_cents,'tender_variance_cents',c.tender_variance_cents,'transaction_count',c.transaction_count,'pos_reference',c.pos_reference,'notes',c.notes,'closed_at',c.closed_at,'closed_by_name',p.display_name,'reopened_at',c.reopened_at,'reopen_reason',c.reopen_reason) order by c.business_date desc),'[]'::jsonb) into rows from public.daily_closeouts c left join public.profiles p on p.id=c.closed_by where c.location_id=loc and c.business_date between from_date and to_date;
  return jsonb_build_object('range_start',from_date,'range_end',to_date,'rows',rows);
end;
$$;

revoke all on function public.payment_channel_for_method(uuid,text) from public,anon,authenticated;
revoke all on function public.is_payment_method_enabled(uuid,text) from public,anon,authenticated;
revoke all on function public.post_receipt_to_sales_ledger(uuid) from public,anon,authenticated;
revoke all on function public.predict_daily_sales_goal(date) from public,anon;
revoke all on function public.lock_daily_sales_goal(date) from public,anon;
revoke all on function public.start_business_day(date,integer,text) from public,anon;
revoke all on function public.get_business_day_state(date) from public,anon;
revoke all on function public.get_payment_configuration() from public,anon;
revoke all on function public.finalize_repair_sale(uuid,text,text,integer) from public,anon;
revoke all on function public.finalize_external_pos_sale(uuid,text,text,integer) from public,anon;
revoke all on function public.get_sales_day_summary(date) from public,anon;
revoke all on function public.save_predictive_sales_settings(numeric,numeric,boolean) from public,anon;
revoke all on function public.set_daily_sales_goal(date,integer,text) from public,anon;
revoke all on function public.close_business_day(date,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text) from public,anon;
revoke all on function public.reopen_business_day(date,text) from public,anon;
revoke all on function public.add_reconciliation_adjustment(date,text,integer,text) from public,anon;
revoke all on function public.get_reconciliation_history(date,date) from public,anon;

grant execute on function public.predict_daily_sales_goal(date) to authenticated;
grant execute on function public.start_business_day(date,integer,text) to authenticated;
grant execute on function public.get_business_day_state(date) to authenticated;
grant execute on function public.get_payment_configuration() to authenticated;
grant execute on function public.finalize_repair_sale(uuid,text,text,integer) to authenticated;
grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;
grant execute on function public.get_sales_day_summary(date) to authenticated;
grant execute on function public.save_predictive_sales_settings(numeric,numeric,boolean) to authenticated;
grant execute on function public.set_daily_sales_goal(date,integer,text) to authenticated;
grant execute on function public.close_business_day(date,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text) to authenticated;
grant execute on function public.reopen_business_day(date,text) to authenticated;
grant execute on function public.add_reconciliation_adjustment(date,text,integer,text) to authenticated;
grant execute on function public.get_reconciliation_history(date,date) to authenticated;
