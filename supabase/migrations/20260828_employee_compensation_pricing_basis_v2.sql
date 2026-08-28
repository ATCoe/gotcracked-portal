create or replace function public.calculate_part_repair_pricing(target_ticket uuid,target_inventory_item uuid,line_quantity numeric default 1)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid;
  device_category text;
  part public.inventory_items;
  bs public.business_settings;
  guide_minutes integer;
  fallback_minutes numeric;
  minutes integer;
  qty numeric:=greatest(coalesce(line_quantity,1),0.01);
  gm numeric;
  labor_cost_hourly_cents numeric;
  labor_cost_source text:='splh_target_fallback';
  estimated_labor_cost_cents integer;
  part_cost_total_cents integer;
  direct_cost_cents integer;
  target_total_cents integer;
  part_revenue_cents integer;
  service_charge_cents integer;
begin
  select t.location_id,d.category into loc,device_category
  from public.repair_tickets t left join public.devices d on d.id=t.device_id where t.id=target_ticket;
  if loc is null then raise exception 'Work order not found.'; end if;

  select * into part from public.inventory_items where id=target_inventory_item and location_id=loc and active;  if part.id is null then raise exception 'Inventory item is unavailable.'; end if;
  select * into bs from public.business_settings where location_id=loc;
  gm:=greatest(0,least(94,coalesce(bs.target_gross_margin_percent,50)));

  if part.repair_guide_id is not null then
    select bench_time_minutes into guide_minutes from public.repair_guides where id=part.repair_guide_id and active;
  end if;
  if part.estimated_repair_minutes is not null then minutes:=part.estimated_repair_minutes;
  elsif guide_minutes is not null then minutes:=guide_minutes;
  else
    select percentile_cont(0.5) within group(order by bench_time_minutes) into fallback_minutes
    from public.repair_guides where active and bench_time_minutes is not null
      and (device_category is null or lower(device_category)=lower(coalesce(repair_guides.device_category,'')));
    minutes:=coalesce(round(fallback_minutes)::integer,60);
  end if;

  select avg(rate) into labor_cost_hourly_cents from (
    select case
      when sc.employment_type='hourly' and sc.hourly_rate_cents>0 then sc.hourly_rate_cents::numeric
      when sc.employment_type='salary' and sc.weekly_salary_cents>0 then sc.weekly_salary_cents::numeric/40.0
      else null end rate
    from public.staff_compensation sc
    join public.profiles p on p.id=sc.profile_id and p.location_id=sc.location_id
    where sc.location_id=loc and p.active=true
      and (p.role::text in ('technician','manager') or (p.role::text='owner' and sc.employment_type in ('hourly','salary')))
      and sc.effective_at<=public.current_business_date(loc)
  ) r where rate>0;

  if labor_cost_hourly_cents is not null and labor_cost_hourly_cents>0 then    labor_cost_source:='blended_employee_compensation';
  else
    labor_cost_hourly_cents:=coalesce(bs.target_splh,125)*100*coalesce(bs.target_labor_percent,0.18);
    labor_cost_source:='splh_target_fallback';
  end if;

  estimated_labor_cost_cents:=round(labor_cost_hourly_cents*minutes/60.0)::integer;
  part_cost_total_cents:=round(coalesce(part.cost_cents,0)*qty)::integer;
  direct_cost_cents:=greatest(0,part_cost_total_cents+estimated_labor_cost_cents);
  target_total_cents:=case when gm>=94 then direct_cost_cents else ceil(direct_cost_cents/greatest(0.06,1-(gm/100.0)))::integer end;
  part_revenue_cents:=case when coalesce(bs.charge_parts_to_customer,false)
    then round(coalesce(part.sell_price_cents,0)*qty)::integer else 0 end;
  service_charge_cents:=greatest(0,target_total_cents-part_revenue_cents);

  return jsonb_build_object(
    'charge_parts_to_customer',coalesce(bs.charge_parts_to_customer,false),
    'target_gross_margin_percent',gm,
    'estimated_repair_minutes',minutes,
    'labor_cost_hourly_cents',round(labor_cost_hourly_cents)::integer,
    'labor_cost_source',labor_cost_source,
    'estimated_labor_cost_cents',estimated_labor_cost_cents,
    'part_cost_total_cents',part_cost_total_cents,
    'direct_cost_cents',direct_cost_cents,
    'inventory_sell_revenue_cents',part_revenue_cents,
    'target_repair_total_cents',target_total_cents,
    'service_charge_cents',service_charge_cents,
    'auto_service_taxable',coalesce(bs.auto_service_taxable,true),
    'repair_guide_id',part.repair_guide_id
  );
end;$$;
revoke all on function public.calculate_part_repair_pricing(uuid,uuid,numeric) from public,anon;
grant execute on function public.calculate_part_repair_pricing(uuid,uuid,numeric) to authenticated;

create or replace function public.get_pricing_labor_basis()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  bs public.business_settings;
  basis numeric;
  rate_count integer:=0;
  source_name text:='splh_target_fallback';
begin
  if auth.uid() is null or loc is null then raise exception 'Active staff access is required.'; end if;
  select * into bs from public.business_settings where location_id=loc;
  with rates as (
    select case
      when sc.employment_type='hourly' and sc.hourly_rate_cents>0 then sc.hourly_rate_cents::numeric
      when sc.employment_type='salary' and sc.weekly_salary_cents>0 then sc.weekly_salary_cents::numeric/40.0
      else null end as hourly_cents
    from public.staff_compensation sc
    join public.profiles p on p.id=sc.profile_id and p.location_id=sc.location_id
    where sc.location_id=loc and p.active=true
      and (p.role::text in ('technician','manager') or (p.role::text='owner' and sc.employment_type in ('hourly','salary')))
      and sc.effective_at<=public.current_business_date(loc)
  )  select avg(hourly_cents),count(hourly_cents) into basis,rate_count from rates where hourly_cents>0;
  if basis is not null and basis>0 then
    source_name:='blended_employee_compensation';
  else
    basis:=coalesce(bs.target_splh,125)*100*coalesce(bs.target_labor_percent,0.18);
    rate_count:=0;
  end if;
  return jsonb_build_object(
    'hourly_cents',round(coalesce(basis,0))::integer,
    'source',source_name,
    'employee_count',rate_count,
    'salary_hours_per_week',40
  );
end;
$$;
revoke all on function public.get_pricing_labor_basis() from public,anon;
grant execute on function public.get_pricing_labor_basis() to authenticated;