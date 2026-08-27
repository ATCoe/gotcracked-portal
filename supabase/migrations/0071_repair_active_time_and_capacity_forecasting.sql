-- Hidden active-repair timing log and conservative workload/booking forecast.
-- Only Repair in Progress time is counted. Leaving that status pauses the clock;
-- re-entering it creates a new interval. Same-day eligibility is phone-only and
-- requires both parts and conservative staffed capacity.

alter table public.business_settings
  add column if not exists repair_capacity_utilization numeric not null default 0.70,
  add column if not exists same_day_phone_buffer_percent numeric not null default 15,
  add column if not exists non_phone_min_lead_days integer not null default 2,
  add column if not exists repair_time_defaults jsonb not null default '{"phone":90,"tablet":180,"computer":360,"console":360,"other":480}'::jsonb;

alter table public.business_settings drop constraint if exists business_settings_repair_capacity_utilization_check;
alter table public.business_settings add constraint business_settings_repair_capacity_utilization_check check (repair_capacity_utilization between 0.25 and 1.0);
alter table public.business_settings drop constraint if exists business_settings_same_day_phone_buffer_check;
alter table public.business_settings add constraint business_settings_same_day_phone_buffer_check check (same_day_phone_buffer_percent between 0 and 100);
alter table public.business_settings drop constraint if exists business_settings_non_phone_min_lead_days_check;
alter table public.business_settings add constraint business_settings_non_phone_min_lead_days_check check (non_phone_min_lead_days between 1 and 30);

create table if not exists public.repair_work_intervals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.repair_tickets(id) on delete cascade,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds integer,
  paused_to_status text,
  source text not null default 'status_transition',
  created_at timestamptz not null default now(),
  check (active_seconds is null or active_seconds>=0),
  check (ended_at is null or ended_at>=started_at)
);
create unique index if not exists repair_work_intervals_one_open_idx on public.repair_work_intervals(ticket_id) where ended_at is null;
create index if not exists repair_work_intervals_location_started_idx on public.repair_work_intervals(location_id,started_at desc);
create index if not exists repair_work_intervals_ticket_idx on public.repair_work_intervals(ticket_id,started_at);
alter table public.repair_work_intervals enable row level security;
drop policy if exists repair_work_intervals_staff_read on public.repair_work_intervals;
create policy repair_work_intervals_staff_read on public.repair_work_intervals for select to authenticated using (
  location_id=public.current_location_id() and (coalesce(public.has_permission('reports.view'),false) or coalesce(public.has_permission('repairs.view'),false))
);
grant select on public.repair_work_intervals to authenticated;

create or replace function public.normalize_repair_device_class(p_category text,p_manufacturer text default null,p_model text default null)
returns text language sql immutable as $function$
  select case
    when lower(coalesce(p_category,'')||' '||coalesce(p_manufacturer,'')||' '||coalesce(p_model,'')) ~ '(phone|smartphone|iphone|galaxy s|galaxy note|pixel)' then 'phone'
    when lower(coalesce(p_category,'')||' '||coalesce(p_model,'')) ~ '(tablet|ipad|surface go)' then 'tablet'
    when lower(coalesce(p_category,'')||' '||coalesce(p_model,'')) ~ '(laptop|notebook|desktop|computer|pc|macbook|imac)' then 'computer'
    when lower(coalesce(p_category,'')||' '||coalesce(p_model,'')) ~ '(console|playstation|xbox|nintendo|switch|steam deck)' then 'console'
    else 'other' end;
$function$;
grant execute on function public.normalize_repair_device_class(text,text,text) to authenticated,service_role;

create or replace function public.repair_work_interval_status_trigger()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare now_at timestamptz:=clock_timestamp();
begin
  if tg_op='INSERT' then
    if new.status::text='repair_in_progress' then
      insert into public.repair_work_intervals(location_id,ticket_id,assigned_user_id,started_at,source)
      values(new.location_id,new.id,new.assigned_user_id,now_at,'ticket_created_in_progress') on conflict do nothing;
    end if;
    return new;
  end if;
  if old.status::text<>'repair_in_progress' and new.status::text='repair_in_progress' then
    insert into public.repair_work_intervals(location_id,ticket_id,assigned_user_id,started_at,source)
    values(new.location_id,new.id,new.assigned_user_id,now_at,'status_transition') on conflict do nothing;
  elsif old.status::text='repair_in_progress' and new.status::text<>'repair_in_progress' then
    update public.repair_work_intervals
    set ended_at=now_at,active_seconds=greatest(0,floor(extract(epoch from (now_at-started_at)))::integer),
        paused_to_status=new.status::text,assigned_user_id=coalesce(assigned_user_id,new.assigned_user_id)
    where ticket_id=new.id and ended_at is null;
  elsif old.status::text='repair_in_progress' and new.status::text='repair_in_progress' and old.assigned_user_id is distinct from new.assigned_user_id then
    update public.repair_work_intervals set assigned_user_id=new.assigned_user_id where ticket_id=new.id and ended_at is null;
  end if;
  return new;
end;$function$;

drop trigger if exists repair_work_interval_status_trigger on public.repair_tickets;
create trigger repair_work_interval_status_trigger after insert or update of status,assigned_user_id on public.repair_tickets
for each row execute function public.repair_work_interval_status_trigger();

-- Do not invent history. Existing in-progress repairs begin measuring at migration time.
insert into public.repair_work_intervals(location_id,ticket_id,assigned_user_id,started_at,source)
select location_id,id,assigned_user_id,now(),'migration_current_state'
from public.repair_tickets where status::text='repair_in_progress' on conflict do nothing;

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
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    left join public.work_order_items w on w.ticket_id=t.id
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>days_back)
    group by t.id,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into exact_minutes from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,'')) and lower(coalesce(model,''))=lower(coalesce(p_model,''))
    and service_key<>'' and services like '%'||service_key||'%' having count(*)>=3;
  if exact_minutes is not null then return greatest(15,round(exact_minutes)::integer); end if;

  with ticket_time as (
    select t.id,d.manufacturer,d.model,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>days_back)
    group by t.id,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into model_minutes from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,'')) and lower(coalesce(model,''))=lower(coalesce(p_model,'')) having count(*)>=3;
  if model_minutes is not null then return greatest(15,round(model_minutes)::integer); end if;

  with ticket_time as (
    select t.id,public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>days_back)
    group by t.id,d.category,d.manufacturer,d.model having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into class_minutes from ticket_time where device_class=cls having count(*)>=5;
  return greatest(15,coalesce(round(class_minutes)::integer,fallback,480));
end;$function$;
grant execute on function public.expected_repair_minutes_for_service(text,text,text,text,integer) to authenticated,service_role;

-- Compatibility helper for callers that do not supply a service yet.
create or replace function public.expected_repair_minutes(p_category text,p_manufacturer text default null,p_model text default null,p_days integer default 180)
returns integer language sql stable security definer set search_path='public' as $function$
  select public.expected_repair_minutes_for_service(p_category,p_manufacturer,p_model,null,p_days);
$function$;
grant execute on function public.expected_repair_minutes(text,text,text,integer) to authenticated,service_role;

create or replace function public.get_repair_timing_report(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); d integer:=greatest(30,least(365,coalesce(p_days,90))); by_class jsonb; by_model jsonb; by_service jsonb; recent jsonb; overall jsonb;
begin
  if loc is null or not coalesce(public.has_permission('reports.view'),false) then raise exception 'Reports permission required.'; end if;
  with ticket_times as (
    select t.id,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,
      sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>d) group by t.id,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'sample_size',sample_size,'avg_active_minutes',avg_minutes,
    'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes) order by device_class),'[]'::jsonb) into by_class
  from (select device_class,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes
    from ticket_times where active_minutes>=5 group by device_class) x;

  with ticket_times as (
    select t.id,dv.manufacturer,dv.model,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,
      sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>d) group by t.id,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'manufacturer',manufacturer,'model',model,'sample_size',sample_size,
    'avg_active_minutes',avg_minutes,'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes)
    order by sample_size desc,manufacturer,model),'[]'::jsonb) into by_model
  from (select device_class,manufacturer,model,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes
    from ticket_times where active_minutes>=5 group by device_class,manufacturer,model) x;

  with ticket_times as (
    select t.id,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,lower(trim(w.description)) service,
      sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id
    join public.work_order_items w on w.ticket_id=t.id and w.item_type='service'
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>d) and nullif(trim(w.description),'') is not null
    group by t.id,dv.category,dv.manufacturer,dv.model,w.description
  )
  select coalesce(jsonb_agg(jsonb_build_object('device_class',device_class,'service',service,'sample_size',sample_size,
    'avg_active_minutes',avg_minutes,'median_active_minutes',median_minutes,'p80_active_minutes',p80_minutes)
    order by sample_size desc,device_class,service),'[]'::jsonb) into by_service
  from (select device_class,service,count(*) sample_size,round(avg(active_minutes),1) avg_minutes,
    round(percentile_cont(.5) within group(order by active_minutes)::numeric,1) median_minutes,
    round(percentile_cont(.8) within group(order by active_minutes)::numeric,1) p80_minutes
    from ticket_times where active_minutes>=5 group by device_class,service) x;

  with ticket_times as (
    select t.id,t.ticket_number,dv.manufacturer,dv.model,public.normalize_repair_device_class(dv.category,dv.manufacturer,dv.model) device_class,
      sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes,
      count(i.id) intervals,max(coalesce(i.ended_at,now())) last_work_at
    from public.repair_tickets t join public.devices dv on dv.id=t.device_id join public.repair_work_intervals i on i.ticket_id=t.id
    where t.location_id=loc and i.started_at>=now()-make_interval(days=>d)
    group by t.id,t.ticket_number,dv.category,dv.manufacturer,dv.model
  )
  select coalesce(jsonb_agg(jsonb_build_object('ticket_id',id,'ticket_number',ticket_number,'device_class',device_class,'manufacturer',manufacturer,
    'model',model,'active_minutes',round(active_minutes,1),'work_intervals',intervals,'last_work_at',last_work_at) order by last_work_at desc),'[]'::jsonb)
  into recent from (select * from ticket_times order by last_work_at desc limit 30) x;

  select jsonb_build_object('tracked_intervals',count(*),'completed_intervals',count(*) filter(where ended_at is not null),
    'active_seconds',coalesce(sum(coalesce(active_seconds,case when ended_at is null then greatest(0,floor(extract(epoch from (now()-started_at)))::integer) else 0 end)),0))
  into overall from public.repair_work_intervals where location_id=loc and started_at>=now()-make_interval(days=>d);

  return jsonb_build_object('days',d,'generated_at',now(),
    'measurement','Only time while ticket status is repair_in_progress. Time in parts/customer/approval/other statuses is excluded.',
    'learning_hierarchy','Model + service median after 3 samples; model median after 3 samples; device-class median after 5 samples; otherwise conservative configured defaults.',
    'overall',overall,'by_device_class',by_class,'by_model',by_model,'by_service',by_service,'recent_tickets',recent);
end;$function$;
grant execute on function public.get_repair_timing_report(integer) to authenticated,service_role;

create or replace function public.get_repair_workload_forecast(p_target_date date default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); target date; utilization numeric:=.70; scheduled integer:=0; usable integer:=0;
  queued_minutes integer:=0; blocked_minutes integer:=0; appointment_minutes integer:=0; remaining integer:=0; queue_json jsonb; appointment_json jsonb;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  target:=coalesce(p_target_date,public.current_business_date(loc));
  select coalesce(repair_capacity_utilization,.70) into utilization from public.business_settings where location_id=loc;
  select coalesce(sum(greatest(0,(extract(epoch from (s.ends_at-s.starts_at))/60)::integer-coalesce(s.break_minutes,0))),0)::integer into scheduled
  from public.shifts s join public.profiles p on p.id=s.employee_id
  where s.location_id=loc and s.shift_date=target and p.active=true and p.role::text in ('technician','manager');
  usable:=floor(scheduled*utilization)::integer;

  with q as (
    select t.id,t.ticket_number,t.status::text status,t.parts_status,d.category,d.manufacturer,d.model,
      public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,
      coalesce((select string_agg(w.description,' | ' order by w.created_at) from public.work_order_items w where w.ticket_id=t.id and w.item_type='service'),t.customer_issue,'') service_text,
      coalesce((select sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60
        from public.repair_work_intervals i where i.ticket_id=t.id),0)::integer worked_minutes,
      (t.status::text in ('need_to_order_parts','awaiting_parts','waiting_on_parts','awaiting_customer','awaiting_approval') or t.parts_status in ('need_to_order','ordered','awaiting_parts')) is_blocked
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    where t.location_id=loc and t.status::text not in ('repaired','ready_for_pickup','sale_complete','completed','cancelled','customer_declined','unrepairable','abandoned')
  ), calc as (
    select q.*,public.expected_repair_minutes_for_service(q.category,q.manufacturer,q.model,q.service_text,180) expected_minutes from q
  ), final as (
    select c.*,greatest(15,c.expected_minutes-c.worked_minutes) remaining_minutes from calc c
  )
  select coalesce(sum(f.remaining_minutes) filter(where not f.is_blocked),0)::integer,
         coalesce(sum(f.remaining_minutes) filter(where f.is_blocked),0)::integer,
         coalesce(jsonb_agg(jsonb_build_object('ticket_id',f.id,'ticket_number',f.ticket_number,'status',f.status,'parts_status',f.parts_status,
           'device_class',f.device_class,'manufacturer',f.manufacturer,'model',f.model,'service',f.service_text,'expected_minutes',f.expected_minutes,
           'worked_minutes',f.worked_minutes,'remaining_minutes',f.remaining_minutes,'blocked',f.is_blocked) order by f.is_blocked,f.remaining_minutes desc),'[]'::jsonb)
  into queued_minutes,blocked_minutes,queue_json from final f;

  with a as (
    select ap.id,ap.starts_at,ap.preferred_date,ap.preferred_time,ap.device_description,ap.service_requested,ap.parts_status,
      public.normalize_repair_device_class(ap.device_description,null,ap.device_description) device_class,
      public.expected_repair_minutes_for_service(ap.device_description,null,ap.device_description,ap.service_requested,180) expected_minutes
    from public.appointments ap
    where ap.location_id=loc and coalesce(ap.starts_at::date,ap.preferred_date)=target and ap.status not in ('cancelled','no_show','completed')
  )
  select coalesce(sum(a.expected_minutes),0)::integer,
         coalesce(jsonb_agg(jsonb_build_object('appointment_id',a.id,'starts_at',a.starts_at,'preferred_time',a.preferred_time,
           'device_description',a.device_description,'service_requested',a.service_requested,'parts_status',a.parts_status,'device_class',a.device_class,
           'expected_minutes',a.expected_minutes) order by a.starts_at nulls last),'[]'::jsonb)
  into appointment_minutes,appointment_json from a;

  remaining:=greatest(0,usable-queued_minutes-appointment_minutes);
  return jsonb_build_object('target_date',target,'scheduled_technician_minutes',scheduled,'capacity_utilization',utilization,'usable_repair_minutes',usable,
    'actionable_queue_minutes',queued_minutes,'blocked_backlog_minutes',blocked_minutes,'appointment_minutes',appointment_minutes,
    'remaining_capacity_minutes',remaining,'capacity_source',case when scheduled>0 then 'published_schedule' else 'no_technician_schedule' end,
    'queue',queue_json,'appointments',appointment_json,'generated_at',now());
end;$function$;
grant execute on function public.get_repair_workload_forecast(date) to authenticated,service_role;

create or replace function public.evaluate_repair_booking(
  p_device_category text,p_manufacturer text default null,p_model text default null,p_service text default null,
  p_parts_available boolean default false,p_requested_date date default null
)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); target date; cls text; estimate integer; forecast jsonb; remaining integer;
  buffer numeric:=15; lead_days integer:=2; required integer; eligible boolean;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  target:=coalesce(p_requested_date,public.current_business_date(loc));
  cls:=public.normalize_repair_device_class(p_device_category,p_manufacturer,p_model);
  estimate:=public.expected_repair_minutes_for_service(p_device_category,p_manufacturer,p_model,p_service,180);
  select coalesce(same_day_phone_buffer_percent,15),coalesce(non_phone_min_lead_days,2) into buffer,lead_days
  from public.business_settings where location_id=loc;
  forecast:=public.get_repair_workload_forecast(target); remaining:=coalesce((forecast->>'remaining_capacity_minutes')::integer,0);
  required:=ceil(estimate*(1+buffer/100.0))::integer;
  eligible:=cls='phone' and coalesce(p_parts_available,false) and remaining>=required and coalesce(forecast->>'capacity_source','')='published_schedule';
  return jsonb_build_object('device_class',cls,'estimated_active_minutes',estimate,'requested_date',target,'parts_available',coalesce(p_parts_available,false),
    'remaining_capacity_minutes',remaining,'buffered_required_minutes',required,'same_day_promise_allowed',eligible,
    'minimum_lead_days',case when eligible then 0 when cls='phone' then 1 else lead_days end,
    'promise_class',case when eligible then 'same_day_phone' when cls='phone' and not coalesce(p_parts_available,false) then 'phone_parts_required'
      when cls='phone' then 'phone_capacity_limited' else 'multi_day' end,
    'customer_message',case when eligible then 'This phone repair is eligible for same-day service because the required parts and repair capacity are available.'
      when cls='phone' and not coalesce(p_parts_available,false) then 'Same-day phone service cannot be guaranteed until the required part is available.'
      when cls='phone' then 'This phone repair cannot be promised for same-day service on the requested date because current repair capacity is already committed.'
      else 'This repair should be scheduled as a multi-day repair. Same-day guarantees are reserved for eligible phone repairs with parts available.' end,
    'forecast',forecast);
end;$function$;
grant execute on function public.evaluate_repair_booking(text,text,text,text,boolean,date) to authenticated,service_role;

create or replace function public.get_marlon_repair_capacity_context(p_days integer default 90,p_date date default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); timing jsonb; forecast jsonb;
begin
  if loc is null then return jsonb_build_object('available',false); end if;
  if coalesce(public.has_permission('reports.view'),false) then timing:=public.get_repair_timing_report(p_days);
  else timing:=jsonb_build_object('available',false,'reason','reports_permission_required'); end if;
  forecast:=public.get_repair_workload_forecast(p_date);
  return jsonb_build_object('available',true,'timing',timing,'forecast',forecast,
    'policy',jsonb_build_object('same_day_category','phone','same_day_requires_parts',true,'same_day_requires_capacity',true,'all_other_device_classes','multi_day'));
end;$function$;
grant execute on function public.get_marlon_repair_capacity_context(integer,date) to authenticated,service_role;

-- Enrich employee recognition with active repair-time metrics. Time is displayed
-- for context/coaching and deliberately does not change the recognition score.
create or replace function public.get_employee_recognition(p_days integer default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $function$
declare loc uuid:=public.current_location_id(); days_back integer:=30; start_date date; end_date date; sw numeric:=.5; rw numeric:=.5; payload jsonb;
begin
  if loc is null then raise exception 'Active staff location required.'; end if;
  select coalesce(recognition_window_days,30),coalesce(recognition_sales_weight,.5),coalesce(recognition_repairs_weight,.5)
    into days_back,sw,rw from public.business_settings where location_id=loc;
  days_back:=greatest(7,least(365,coalesce(p_days,days_back,30))); if sw+rw<=0 then sw:=.5; rw:=.5; end if; sw:=sw/(sw+rw); rw:=1-sw;
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
      and coalesce(t.sale_business_date,t.sale_completed_at::date,t.completed_at::date) between start_date and end_date group by t.assigned_user_id
  ), active_time as (
    select t.assigned_user_id profile_id,round(coalesce(avg(x.active_minutes),0)::numeric,1) avg_active_repair_minutes,
      round(coalesce(sum(x.active_minutes),0)::numeric,1) total_active_repair_minutes,count(*)::integer timed_repairs
    from (select i.ticket_id,sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60.0 active_minutes
      from public.repair_work_intervals i where i.location_id=loc and i.started_at::date between start_date and end_date group by i.ticket_id) x
    join public.repair_tickets t on t.id=x.ticket_id where t.assigned_user_id is not null group by t.assigned_user_id
  ), active as (
    select assigned_user_id profile_id,count(*)::integer active_repairs from public.repair_tickets where location_id=loc and assigned_user_id is not null
      and status not in ('sale_complete','completed','cancelled','customer_declined','unrepairable','abandoned') group by assigned_user_id
  ), base as (
    select s.*,coalesce(sa.checkout_count,0) checkout_count,coalesce(sa.checkout_sales_cents,0)::bigint checkout_sales_cents,
      coalesce(rp.completed_repairs,0) completed_repairs,coalesce(rp.repair_revenue_cents,0)::bigint repair_revenue_cents,
      coalesce(rp.avg_turnaround_hours,0) avg_turnaround_hours,coalesce(at.avg_active_repair_minutes,0) avg_active_repair_minutes,
      coalesce(at.total_active_repair_minutes,0) total_active_repair_minutes,coalesce(at.timed_repairs,0) timed_repairs,coalesce(a.active_repairs,0) active_repairs
    from staff s left join sales sa on sa.profile_id=s.id left join repairs rp on rp.profile_id=s.id left join active_time at on at.profile_id=s.id left join active a on a.profile_id=s.id
  ), mx as (select greatest(coalesce(max(checkout_sales_cents),0),1)::numeric ms,greatest(coalesce(max(completed_repairs),0),1)::numeric mr from base),
  scored as (select b.*,round(100*(sw*(b.checkout_sales_cents::numeric/mx.ms)+rw*(b.completed_repairs::numeric/mx.mr)),1) recognition_score from base b cross join mx),
  ranked as (select *,dense_rank() over(order by recognition_score desc,checkout_sales_cents desc,completed_repairs desc,display_name) rank from scored),
  decorated as (select *,case when rank=1 and (checkout_sales_cents>0 or completed_repairs>0) then 'Top Contributor'
    when checkout_sales_cents=(select max(checkout_sales_cents) from ranked) and checkout_sales_cents>0 then 'Sales Leader'
    when completed_repairs=(select max(completed_repairs) from ranked) and completed_repairs>0 then 'Repair Leader' else null end recognition_label from ranked)
  select jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'sales_weight',sw,'repairs_weight',rw,
    'score_explanation','Recognition score normalizes checkout sales and completed repairs to the highest active employee in the same period, then applies configured weights. Active repair time is shown for coaching/throughput context but is not scored. This is for recognition, not compensation or discipline.',
    'employees',coalesce(jsonb_agg(jsonb_build_object('profile_id',id,'display_name',display_name,'role',role,'avatar_url',avatar_url,
      'badge_label',badge_label,'badge_icon',badge_icon,'badge_tone',badge_tone,'rank',rank,'recognition_score',recognition_score,
      'recognition_label',recognition_label,'checkout_sales_cents',checkout_sales_cents,'checkout_count',checkout_count,
      'completed_repairs',completed_repairs,'repair_revenue_cents',repair_revenue_cents,'avg_turnaround_hours',avg_turnaround_hours,
      'avg_active_repair_minutes',avg_active_repair_minutes,'total_active_repair_minutes',total_active_repair_minutes,'timed_repairs',timed_repairs,
      'active_repairs',active_repairs) order by rank,display_name),'[]'::jsonb)) into payload from decorated;
  return coalesce(payload,jsonb_build_object('range_start',start_date,'range_end',end_date,'days',days_back,'employees','[]'::jsonb));
end;$function$;
grant execute on function public.get_employee_recognition(integer) to authenticated,service_role;
