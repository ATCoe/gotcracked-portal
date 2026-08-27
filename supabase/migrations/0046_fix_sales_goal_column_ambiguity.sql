-- GotCracked Portal v1.1 production fix:
-- eliminate the PL/pgSQL goal_cents variable/column collision in sales reporting.

create or replace function public.get_sales_day_summary(target_date date default null::date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid := public.current_location_id();
  biz_date date;
  current_sales integer := 0;
  sale_count integer := 0;
  part_cost integer := 0;
  part_revenue integer := 0;
  part_margin integer := 0;
  bundled_part_cost integer := 0;
  is_closed boolean := false;
  close_status text;
  closed_at_value timestamptz;
  manual_goal integer;
  launch_goal integer;
  adaptive boolean := true;
  growth_pct numeric := 0;
  week_id uuid;
  weekly_forecast integer := 0;
  target_splh numeric := 0;
  today_hours numeric := 0;
  week_hours numeric := 0;
  schedule_goal numeric := 0;
  schedule_method text := 'unset';
  history_count integer := 0;
  same_weekday_avg numeric;
  trailing30_avg numeric;
  ytd_avg numeric;
  history_goal numeric := 0;
  history_weight numeric := 0;
  goal_value numeric := 0;
  goal_method text := 'unset';
  computed_goal_cents integer := 0;
  remaining integer := 0;
  percent numeric := 0;
  charge_parts boolean := false;
begin
  if loc is null or not coalesce(public.has_permission('dashboard.view'),false) then
    raise exception 'You do not have permission to view sales reporting.';
  end if;

  biz_date := coalesce(target_date,public.current_business_date(loc));
  select coalesce(bs.charge_parts_to_customer,false) into charge_parts
  from public.business_settings bs where bs.location_id=loc;

  select dc.status,dc.portal_sales_cents,dc.portal_sale_count,dc.portal_part_cost_cents,
         dc.portal_part_revenue_cents,dc.portal_part_margin_cents,dc.portal_bundled_part_cost_cents,dc.closed_at
    into close_status,current_sales,sale_count,part_cost,part_revenue,part_margin,bundled_part_cost,closed_at_value
  from public.daily_closeouts dc
  where dc.location_id=loc and dc.business_date=biz_date
  limit 1;

  if close_status='closed' then
    is_closed := true;
  else
    select coalesce(sum(t.total_cents),0)::integer,count(*)::integer
      into current_sales,sale_count
    from public.repair_tickets t
    where t.location_id=loc
      and t.sale_business_date=biz_date
      and t.sale_completed_at is not null;

    select
      coalesce(round(sum(w.quantity*coalesce(w.unit_cost_cents,0))),0)::integer,
      coalesce(round(sum(w.quantity*coalesce(w.unit_price_cents,0))),0)::integer,
      coalesce(round(sum(case when w.part_pricing_mode='standard' then w.quantity*(coalesce(w.unit_price_cents,0)-coalesce(w.unit_cost_cents,0)) else 0 end)),0)::integer,
      coalesce(round(sum(case when w.part_pricing_mode='bundled_service' then w.quantity*coalesce(w.unit_cost_cents,0) else 0 end)),0)::integer
      into part_cost,part_revenue,part_margin,bundled_part_cost
    from public.work_order_items w
    join public.repair_tickets t on t.id=w.ticket_id
    where t.location_id=loc and t.sale_business_date=biz_date and t.sale_completed_at is not null
      and w.item_type='part';
  end if;

  current_sales := coalesce(current_sales,0);
  sale_count := coalesce(sale_count,0);
  part_cost := coalesce(part_cost,0);
  part_revenue := coalesce(part_revenue,0);
  part_margin := coalesce(part_margin,0);
  bundled_part_cost := coalesce(bundled_part_cost,0);

  select o.goal_cents into manual_goal
  from public.daily_sales_goal_overrides o
  where o.location_id=loc and o.business_date=biz_date;

  select sg.launch_daily_goal_cents,sg.adaptive_enabled,sg.growth_target_pct
    into launch_goal,adaptive,growth_pct
  from public.sales_goal_settings sg where sg.location_id=loc;
  adaptive := coalesce(adaptive,true);
  growth_pct := coalesce(growth_pct,0);

  select sw.id,coalesce(sw.forecast_sales_cents,0),coalesce(sw.target_splh,0)
    into week_id,weekly_forecast,target_splh
  from public.schedule_weeks sw
  where sw.location_id=loc and biz_date between sw.week_start and (sw.week_start+6)
  order by sw.week_start desc limit 1;

  select coalesce(sum(greatest(
    ((extract(hour from s.ends_at)::numeric*60+extract(minute from s.ends_at)::numeric)
     -(extract(hour from s.starts_at)::numeric*60+extract(minute from s.starts_at)::numeric)
     -coalesce(s.break_minutes,0))/60.0,0)),0)
  into today_hours
  from public.shifts s
  where s.location_id=loc and s.shift_date=biz_date;

  if week_id is not null then
    select coalesce(sum(greatest(
      ((extract(hour from s.ends_at)::numeric*60+extract(minute from s.ends_at)::numeric)
       -(extract(hour from s.starts_at)::numeric*60+extract(minute from s.starts_at)::numeric)
       -coalesce(s.break_minutes,0))/60.0,0)),0)
    into week_hours
    from public.shifts s where s.schedule_week_id=week_id;
  end if;

  if target_splh>0 and today_hours>0 then
    schedule_goal:=target_splh*100*today_hours;
    schedule_method:='scheduled_labor_x_splh';
  elsif weekly_forecast>0 and today_hours>0 and week_hours>0 then
    schedule_goal:=weekly_forecast*(today_hours/week_hours);
    schedule_method:='weekly_forecast_by_labor_share';
  elsif coalesce(launch_goal,0)>0 then
    schedule_goal:=launch_goal;
    schedule_method:='launch_baseline';
  end if;

  select count(*) into history_count
  from public.daily_closeouts c
  where c.location_id=loc and c.status='closed' and c.business_date<biz_date;

  select avg(x.sales) into same_weekday_avg from (
    select coalesce(nullif(c.portal_sales_cents,0),c.pos_net_sales_cents,0) sales
    from public.daily_closeouts c
    where c.location_id=loc and c.status='closed' and c.business_date<biz_date
      and extract(isodow from c.business_date)=extract(isodow from biz_date)
    order by c.business_date desc limit 8
  ) x;

  select avg(x.sales) into trailing30_avg from (
    select coalesce(nullif(c.portal_sales_cents,0),c.pos_net_sales_cents,0) sales
    from public.daily_closeouts c
    where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    order by c.business_date desc limit 30
  ) x;

  select avg(coalesce(nullif(c.portal_sales_cents,0),c.pos_net_sales_cents,0)) into ytd_avg
  from public.daily_closeouts c
  where c.location_id=loc and c.status='closed' and c.business_date<biz_date
    and extract(year from c.business_date)=extract(year from biz_date);

  if same_weekday_avg is not null then history_goal:=history_goal+same_weekday_avg*.50; history_weight:=history_weight+.50; end if;
  if trailing30_avg is not null then history_goal:=history_goal+trailing30_avg*.35; history_weight:=history_weight+.35; end if;
  if ytd_avg is not null then history_goal:=history_goal+ytd_avg*.15; history_weight:=history_weight+.15; end if;
  if history_weight>0 then history_goal:=(history_goal/history_weight)*(1+growth_pct/100.0); end if;

  if manual_goal is not null then
    goal_value:=manual_goal; goal_method:='manual_override';
  elsif not adaptive or history_count<10 then
    if schedule_goal>0 then goal_value:=schedule_goal; goal_method:=schedule_method;
    elsif history_goal>0 then goal_value:=history_goal; goal_method:='history_only'; end if;
  elsif history_count<30 and schedule_goal>0 and history_goal>0 then
    goal_value:=schedule_goal*.70+history_goal*.30; goal_method:='adaptive_launch';
  elsif schedule_goal>0 and history_goal>0 then
    goal_value:=schedule_goal*.40+history_goal*.60; goal_method:='adaptive_history';
  elsif schedule_goal>0 then goal_value:=schedule_goal; goal_method:=schedule_method;
  elsif history_goal>0 then goal_value:=history_goal; goal_method:='history_only';
  end if;

  computed_goal_cents:=greatest(0,round(coalesce(goal_value,0))::integer);
  remaining:=greatest(computed_goal_cents-current_sales,0);
  if computed_goal_cents>0 then percent:=round((current_sales::numeric/computed_goal_cents::numeric)*100,1); end if;

  return jsonb_build_object(
    'business_date',biz_date,
    'current_sales_cents',current_sales,
    'sale_complete_count',sale_count,
    'goal_cents',computed_goal_cents,
    'remaining_cents',remaining,
    'percent_to_goal',percent,
    'goal_method',goal_method,
    'schedule_method',schedule_method,
    'scheduled_hours',round(today_hours,2),
    'target_splh',target_splh,
    'weekly_forecast_cents',weekly_forecast,
    'history_days',history_count,
    'same_weekday_avg_cents',round(coalesce(same_weekday_avg,0))::integer,
    'trailing30_avg_cents',round(coalesce(trailing30_avg,0))::integer,
    'ytd_avg_cents',round(coalesce(ytd_avg,0))::integer,
    'part_cost_cents',part_cost,
    'part_revenue_cents',part_revenue,
    'part_margin_cents',part_margin,
    'bundled_part_cost_cents',bundled_part_cost,
    'charge_parts_to_customer',charge_parts,
    'is_closed',is_closed,
    'close_status',close_status,
    'last_updated_at',case when is_closed then closed_at_value else now() end
  );
end;
$$;
