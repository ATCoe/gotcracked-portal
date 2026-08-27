-- Accuracy hardening: historical timing benchmarks only learn from repairs that
-- actually reached Repaired/Ready/Completed. Incomplete repairs remain useful for
-- live remaining-work forecasts but never become historical duration samples.

create or replace function public.expected_repair_minutes_for_service(
  p_category text,p_manufacturer text default null,p_model text default null,p_service text default null,p_days integer default 180
)
returns integer language plpgsql stable security definer set search_path='public' as $function$
declare
  loc uuid:=public.current_location_id(); cls text; exact_minutes numeric; model_minutes numeric; class_minutes numeric;
  fallback integer:=480; days_back integer:=greatest(30,least(365,coalesce(p_days,180))); service_key text:=lower(trim(coalesce(p_service,'')));
begin
  if loc is null then return 480; end if;
  cls:=public.normalize_repair_device_class(p_category,p_manufacturer,p_model);
  select coalesce((repair_time_defaults->>cls)::integer,(repair_time_defaults->>'other')::integer,480) into fallback
  from public.business_settings where location_id=loc;
  with ticket_time as (
    select t.id,d.manufacturer,d.model,lower(trim(coalesce(string_agg(distinct case when w.item_type='service' then w.description end,' | '),''))) services,
      sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null left join public.work_order_items w on w.ticket_id=t.id
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>days_back)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into exact_minutes from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,'')) and lower(coalesce(model,''))=lower(coalesce(p_model,''))
    and service_key<>'' and services like '%'||service_key||'%' having count(*)>=3;
  if exact_minutes is not null then return greatest(15,round(exact_minutes)::integer); end if;
  with ticket_time as (
    select t.id,d.manufacturer,d.model,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices d on d.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>days_back)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into model_minutes from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,'')) and lower(coalesce(model,''))=lower(coalesce(p_model,'')) having count(*)>=3;
  if model_minutes is not null then return greatest(15,round(model_minutes)::integer); end if;
  with ticket_time as (
    select t.id,public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices d on d.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>days_back)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.category,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into class_minutes from ticket_time where device_class=cls having count(*)>=5;
  return greatest(15,coalesce(round(class_minutes)::integer,fallback,480));
end;$function$;
grant execute on function public.expected_repair_minutes_for_service(text,text,text,text,integer) to authenticated,service_role;

create or replace function public.get_repair_timing_report(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); d integer:=greatest(30,least(365,coalesce(p_days,90))); by_class jsonb; by_model jsonb; by_service jsonb; recent jsonb; overall jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  with completed_ticket_times as (
    select t.id,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed') and i.started_at>=now()-make_interval(days=>d)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'sample_size',sample_size,'avg_active_minutes',avg_minutes,'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes) order by device_class),'[]'::jsonb)
  into by_class from (select device_class,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes from completed_ticket_times where active_minutes>=5 group by device_class) x;
  with completed_ticket_times as (
    select t.id,dv.manufacturer,dv.model,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed') and i.started_at>=now()-make_interval(days=>d)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'manufacturer',manufacturer,'model',model,'sample_size',sample_size,'avg_active_minutes',avg_minutes,'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes) order by sample_size desc,manufacturer,model),'[]'::jsonb)
  into by_model from (select device_class,manufacturer,model,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes from completed_ticket_times where active_minutes>=5 group by device_class,manufacturer,model) x;
  with completed_ticket_times as (
    select t.id,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,lower(trim(w.description)) service,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    join public.work_order_items w on w.ticket_id=t.id and w.item_type='service'
    where t.location_id=loc and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed') and i.started_at>=now()-make_interval(days=>d)
      and nullif(trim(w.description),'') is not null and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,dv.category,dv.manufacturer,dv.model,w.description
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'service',service,'sample_size',sample_size,'avg_active_minutes',avg_minutes,'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes) order by sample_size desc,device_class,service),'[]'::jsonb)
  into by_service from (select device_class,service,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes from completed_ticket_times where active_minutes>=5 group by device_class,service) x;
  with ticket_times as (
    select t.id,t.ticket_number,t.status::text status,dv.manufacturer,dv.model,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,
      sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes,
      count(i.id) intervals,max(coalesce(i.ended_at,now())) last_work_at
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>d)
    group by t.id,t.ticket_number,t.status,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('ticket_id',id,'ticket_number',ticket_number,'status',status,'completed_sample',status in ('repaired','ready_for_pickup','sale_complete','completed'),'device_class',device_class,'manufacturer',manufacturer,'model',model,'active_minutes',round(active_minutes,1),'work_intervals',intervals,'last_work_at',last_work_at) order by last_work_at desc),'[]'::jsonb)
  into recent from (select * from ticket_times order by last_work_at desc limit 30) x;
  select jsonb_build_object('tracked_intervals',count(*),'completed_intervals',count(*) filter(where ended_at is not null),'active_seconds',coalesce(sum(coalesce(active_seconds,case when ended_at is null then greatest(0,floor(extract(epoch from (now()-started_at)))::integer) else 0 end)),0))
  into overall from public.repair_work_intervals where location_id=loc and started_at>=now()-make_interval(days=>d);
  return jsonb_build_object('days',d,'generated_at',now(),'measurement','Only time while ticket status is repair_in_progress. Time in parts/customer/approval/other statuses is excluded.',
    'sample_policy','Historical averages and medians use only repairs that reached Repaired/Ready/Completed with no open active interval. Unfinished repairs are used only for live workload remaining-time calculations.',
    'learning_hierarchy','Model + service median after 3 completed samples; model median after 3 completed samples; device-class median after 5 completed samples; otherwise conservative configured defaults.',
    'overall',overall,'by_device_class',by_class,'by_model',by_model,'by_service',by_service,'recent_tickets',recent);
end;$function$;
grant execute on function public.get_repair_timing_report(integer) to authenticated,service_role;

-- Employee active repair averages also use completed timing samples only.
create or replace function public.get_employee_recognition(p_days integer default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); days_back integer:=30; start_date date; end_date date; sw numeric:=.5; rw numeric:=.5; payload jsonb;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  select coalesce(recognition_window_days,30),coalesce(recognition_sales_weight,.5),coalesce(recognition_repairs_weight,.5) into days_back,sw,rw from public.business_settings where location_id=loc;
  days_back:=greatest(7,least(365,coalesce(p_days,days_back,30))); if sw+rw<=0 then sw:=.5; rw:=.5; end if; sw:=sw/(sw+rw); rw:=1-sw;
  end_date:=public.current_business_date(loc); start_date:=end_date-(days_back-1);
  with staff as (select id,display_name,role::text role,coalesce(avatar_url,discord_avatar_url) avatar_url,badge_label,badge_icon,badge_tone from public.profiles where location_id=loc and active=true and role::text<>'owner'),
  sales as (select created_by profile_id,count(*)::integer checkout_count,coalesce(sum(total_cents),0)::bigint checkout_sales_cents from public.receipts where location_id=loc and business_date between start_date and end_date and created_by is not null group by created_by),
  repairs as (select t.assigned_user_id profile_id,count(*)::integer completed_repairs,coalesce(sum(r.total_cents),0)::bigint repair_revenue_cents,
    round(coalesce(avg(extract(epoch from (coalesce(t.sale_completed_at,t.completed_at,t.ready_for_pickup_at)-coalesce(t.checked_in_at,t.created_at)))/3600.0),0)::numeric,1) avg_turnaround_hours
    from public.repair_tickets t left join public.receipts r on r.ticket_id=t.id and r.location_id=loc
    where t.location_id=loc and t.assigned_user_id is not null and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date,t.ready_for_pickup_at::date) between start_date and end_date group by t.assigned_user_id),
  active_time as (select t.assigned_user_id profile_id,round(coalesce(avg(x.active_minutes),0)::numeric,1) avg_active_repair_minutes,round(coalesce(sum(x.active_minutes),0)::numeric,1) total_active_repair_minutes,count(*)::integer timed_repairs
    from (select i.ticket_id,sum(coalesce(i.active_seconds,0))/60.0 active_minutes from public.repair_work_intervals i join public.repair_tickets tt on tt.id=i.ticket_id
      where i.location_id=loc and i.started_at::date between start_date and end_date and i.ended_at is not null and tt.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
        and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=i.ticket_id and oi.ended_at is null) group by i.ticket_id) x
    join public.repair_tickets t on t.id=x.ticket_id where t.assigned_user_id is not null group by t.assigned_user_id),
  active as (select assigned_user_id profile_id,count(*)::integer active_repairs from public.repair_tickets where location_id=loc and assigned_user_id is not null and status not in ('sale_complete','completed','cancelled','customer_declined','unrepairable','abandoned') group by assigned_user_id),
  base as (select s.*,coalesce(sa.checkout_count,0) checkout_count,coalesce(sa.checkout_sales_cents,0)::bigint checkout_sales_cents,coalesce(rp.completed_repairs,0) completed_repairs,coalesce(rp.repair_revenue_cents,0)::bigint repair_revenue_cents,coalesce(rp.avg_turnaround_hours,0) avg_turnaround_hours,coalesce(at.avg_active_repair_minutes,0) avg_active_repair_minutes,coalesce(at.total_active_repair_minutes,0) total_active_repair_minutes,coalesce(at.timed_repairs,0) timed_repairs,coalesce(a.active_repairs,0) active_repairs from staff s left join sales sa on sa.profile_id=s.id left join repairs rp on rp.profile_id=s.id left join active_time at on at.profile_id=s.id left join active a on a.profile_id=s.id),
  mx as (select greatest(coalesce(max(checkout_sales_cents),0),1)::numeric ms,greatest(coalesce(max(completed_repairs),0),1)::numeric mr from base),
  scored as (select b.*,round(100*(sw*(b.checkout_sales_cents::numeric/mx.ms)+rw*(b.completed_repairs::numeric/mx.mr)),1) recognition_score from base b cross join mx),
  ranked as (select *,dense_rank() over(order by recognition_score desc,checkout_sales_cents desc,completed_repairs desc,display_name) rank from scored),
  decorated as (select *,case when rank=1 and (checkout_sales_cents>0 or completed_repairs>0) then 'Top Contributor' when checkout_sales_cents=(select max(checkout_sales_cents) from ranked) and checkout_sales_cents>0 then 'Sales Leader' when completed_repairs=(select max(completed_repairs) from ranked) and completed_repairs>0 then 'Repair Leader' else null end recognition_label from ranked)
  select jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'sales_weight',sw,'repairs_weight',rw,
    'score_explanation','Recognition score normalizes checkout sales and completed repairs to the highest active employee in the same period, then applies configured weights. Active repair time uses completed timing samples only and is shown for coaching/throughput context but is not scored. This is for recognition, not compensation or discipline.',
    'employees',coalesce(jsonb_agg(jsonb_build_object('profile_id',id,'display_name',display_name,'role',role,'avatar_url',avatar_url,'badge_label',badge_label,'badge_icon',badge_icon,'badge_tone',badge_tone,'rank',rank,'recognition_score',recognition_score,'recognition_label',recognition_label,'checkout_sales_cents',checkout_sales_cents,'checkout_count',checkout_count,'completed_repairs',completed_repairs,'repair_revenue_cents',repair_revenue_cents,'avg_turnaround_hours',avg_turnaround_hours,'avg_active_repair_minutes',avg_active_repair_minutes,'total_active_repair_minutes',total_active_repair_minutes,'timed_repairs',timed_repairs,'active_repairs',active_repairs) order by rank,display_name),'[]'::jsonb)) into payload from decorated;
  return coalesce(payload,jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'employees','[]'::jsonb));
end;$function$;
grant execute on function public.get_employee_recognition(integer) to authenticated,service_role;
