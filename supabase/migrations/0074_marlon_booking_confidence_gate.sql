-- Marlon confidence-gated public booking intelligence.
-- Public timing guidance progresses Shadow -> Advisory -> Active only after
-- enough completed phone repairs, verified part mappings, shadow evaluations,
-- adjudicated outcomes, strong accuracy, and low false-positive same-day calls.

alter table public.business_settings
  add column if not exists public_booking_intelligence_mode text not null default 'shadow',
  add column if not exists marlon_public_booking_auto_enable boolean not null default true,
  add column if not exists booking_readiness_min_completed_phone_samples integer not null default 20,
  add column if not exists booking_readiness_min_shadow_evaluations integer not null default 30,
  add column if not exists booking_readiness_min_adjudicated integer not null default 15,
  add column if not exists booking_readiness_min_positive_predictions integer not null default 5,
  add column if not exists booking_readiness_min_accuracy numeric not null default 0.90,
  add column if not exists booking_readiness_min_part_mapping_rate numeric not null default 0.90,
  add column if not exists booking_readiness_max_false_positive_rate numeric not null default 0.05,
  add column if not exists booking_readiness_advisory_days integer not null default 14,
  add column if not exists booking_advisory_started_at timestamptz,
  add column if not exists booking_active_started_at timestamptz;

alter table public.business_settings drop constraint if exists business_settings_public_booking_intelligence_mode_check;
alter table public.business_settings add constraint business_settings_public_booking_intelligence_mode_check
  check (public_booking_intelligence_mode in ('off','shadow','advisory','active'));
alter table public.business_settings drop constraint if exists business_settings_booking_readiness_thresholds_check;
alter table public.business_settings add constraint business_settings_booking_readiness_thresholds_check check (
  booking_readiness_min_completed_phone_samples >= 3 and
  booking_readiness_min_shadow_evaluations >= 5 and
  booking_readiness_min_adjudicated >= 3 and
  booking_readiness_min_accuracy between 0 and 1 and
  booking_readiness_min_part_mapping_rate between 0 and 1 and
  booking_readiness_max_false_positive_rate between 0 and 1 and
  booking_readiness_advisory_days between 1 and 90
);
alter table public.business_settings drop constraint if exists business_settings_booking_positive_prediction_check;
alter table public.business_settings add constraint business_settings_booking_positive_prediction_check
  check (booking_readiness_min_positive_predictions >= 1);

create table if not exists public.repair_part_requirement_rules (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  device_class text not null,
  model_key text not null,
  service_key text not null,
  manufacturer text,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  registry_part_id uuid references public.parts_registry(id) on delete set null,
  quantity_required integer not null default 1 check (quantity_required > 0),
  confidence_score numeric not null default 0 check (confidence_score between 0 and 1),
  observed_samples integer not null default 0 check (observed_samples >= 0),
  verified boolean not null default false,
  source text not null default 'marlon_learning',
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (inventory_item_id is not null or registry_part_id is not null)
);

alter table public.repair_part_requirement_rules drop constraint if exists repair_part_requirement_rules_location_id_device_class_mode_key;
create unique index if not exists repair_part_requirement_rules_inventory_unique
  on public.repair_part_requirement_rules(location_id,device_class,model_key,service_key,inventory_item_id)
  where inventory_item_id is not null;
create unique index if not exists repair_part_requirement_rules_registry_unique
  on public.repair_part_requirement_rules(location_id,device_class,model_key,service_key,registry_part_id)
  where inventory_item_id is null and registry_part_id is not null;
create index if not exists repair_part_requirement_rules_match_idx
  on public.repair_part_requirement_rules(location_id,device_class,model_key,service_key)
  where active and verified;

create table if not exists public.booking_shadow_evaluations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  requested_date date,
  device_type text,
  device_model text,
  device_class text,
  service_key text,
  part_rule_id uuid references public.repair_part_requirement_rules(id) on delete set null,
  part_mapping_verified boolean not null default false,
  parts_available boolean not null default false,
  expected_active_minutes integer,
  remaining_capacity_minutes integer,
  capacity_source text,
  predicted_same_day boolean not null default false,
  prediction_confidence numeric not null default 0 check (prediction_confidence between 0 and 1),
  recommendation jsonb not null default '{}'::jsonb,
  forecast jsonb not null default '{}'::jsonb,
  mode_at_evaluation text not null default 'shadow',
  part_mapping jsonb not null default '{}'::jsonb,
  actual_ticket_id uuid references public.repair_tickets(id) on delete set null,
  actual_ready_at timestamptz,
  actual_active_minutes integer,
  actual_same_day boolean,
  outcome_comparable boolean,
  prediction_correct boolean,
  adjudicated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.booking_shadow_evaluations add column if not exists part_mapping jsonb not null default '{}'::jsonb;
create index if not exists booking_shadow_eval_location_created_idx on public.booking_shadow_evaluations(location_id,created_at desc);
create index if not exists booking_shadow_eval_lead_idx on public.booking_shadow_evaluations(lead_id,created_at desc) where adjudicated_at is null;

create table if not exists public.booking_rollout_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  from_mode text not null,
  to_mode text not null,
  reason text not null,
  readiness jsonb not null default '{}'::jsonb,
  actor text not null default 'marlon',
  created_at timestamptz not null default now()
);
create index if not exists booking_rollout_events_location_created_idx on public.booking_rollout_events(location_id,created_at desc);

alter table public.repair_part_requirement_rules enable row level security;
alter table public.booking_shadow_evaluations enable row level security;
alter table public.booking_rollout_events enable row level security;

drop policy if exists repair_part_requirement_rules_staff_read on public.repair_part_requirement_rules;
create policy repair_part_requirement_rules_staff_read on public.repair_part_requirement_rules
  for select to authenticated
  using (location_id=public.current_location_id() and (
    coalesce(public.has_permission('inventory.manage'),false) or
    coalesce(public.has_permission('reports.view'),false) or
    coalesce(public.has_permission('settings.manage'),false)
  ));
drop policy if exists repair_part_requirement_rules_staff_write on public.repair_part_requirement_rules;
create policy repair_part_requirement_rules_staff_write on public.repair_part_requirement_rules
  for all to authenticated
  using (location_id=public.current_location_id() and (
    coalesce(public.has_permission('inventory.manage'),false) or
    coalesce(public.has_permission('settings.manage'),false)
  ))
  with check (location_id=public.current_location_id() and (
    coalesce(public.has_permission('inventory.manage'),false) or
    coalesce(public.has_permission('settings.manage'),false)
  ));
drop policy if exists booking_shadow_evaluations_reports_read on public.booking_shadow_evaluations;
create policy booking_shadow_evaluations_reports_read on public.booking_shadow_evaluations
  for select to authenticated
  using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));
drop policy if exists booking_rollout_events_reports_read on public.booking_rollout_events;
create policy booking_rollout_events_reports_read on public.booking_rollout_events
  for select to authenticated
  using (location_id=public.current_location_id() and coalesce(public.has_permission('reports.view'),false));

grant select,insert,update,delete on public.repair_part_requirement_rules to authenticated;
grant select on public.booking_shadow_evaluations,public.booking_rollout_events to authenticated;

create or replace function public.booking_normalize_text(p_value text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p_value,'')),'[^a-z0-9]+',' ','g'))
$$;

create or replace function public.normalize_repair_service_key(p_value text)
returns text language plpgsql immutable as $fn$
declare v text:=public.booking_normalize_text(p_value);
begin
  if v ~ '(back|rear) (glass|panel)' then return 'back_glass'; end if;
  if v ~ '(screen|display|lcd|oled|digitizer|cracked glass)' then return 'screen'; end if;
  if v ~ '(battery|fast drain|swollen)' then return 'battery'; end if;
  if v ~ '(charging|charge port|charger port|usb c|lightning port|dock connector)' then return 'charging_port'; end if;
  if v ~ '(hdmi)' then return 'hdmi'; end if;
  if v ~ '(camera|lens)' then return 'camera'; end if;
  if v ~ '(speaker|earpiece|audio|sound)' then return 'audio'; end if;
  if v ~ '(microphone|mic)' then return 'microphone'; end if;
  if v ~ '(liquid|water damage|water exposure)' then return 'liquid_damage'; end if;
  if v ~ '(fan|overheat|overheating|thermal|cooling)' then return 'thermal'; end if;
  if v ~ '(virus|malware|spyware)' then return 'malware'; end if;
  if v ~ '(data recovery|recover data|drive recovery)' then return 'data_recovery'; end if;
  if v='' then return 'unspecified'; end if;
  return left(replace(v,' ','_'),80);
end;$fn$;

create or replace function public.expected_repair_minutes_for_location(
  p_location_id uuid,p_category text,p_manufacturer text default null,p_model text default null,p_service text default null,p_days integer default 180
)
returns integer language plpgsql stable security definer set search_path='public' as $fn$
declare
  v_cls text; v_exact numeric; v_model numeric; v_class numeric; v_fallback integer:=480;
  v_days integer:=greatest(30,least(365,coalesce(p_days,180)));
  v_service_key text:=public.normalize_repair_service_key(p_service);
begin
  if p_location_id is null then return 480; end if;
  v_cls:=public.normalize_repair_device_class(p_category,p_manufacturer,p_model);
  select coalesce((repair_time_defaults->>v_cls)::integer,(repair_time_defaults->>'other')::integer,480)
  into v_fallback from public.business_settings where location_id=p_location_id;

  with ticket_time as (
    select t.id,d.manufacturer,d.model,
      public.normalize_repair_service_key(coalesce(
        (select string_agg(w.description,' | ' order by w.created_at) from public.work_order_items w where w.ticket_id=t.id and w.item_type='service'),
        t.customer_issue,'')) service_key,
      sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t
    join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=p_location_id
      and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>v_days)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.manufacturer,d.model
    having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into v_exact
  from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,''))
    and lower(coalesce(model,''))=lower(coalesce(p_model,''))
    and service_key=v_service_key
  having count(*)>=3;
  if v_exact is not null then return greatest(15,round(v_exact)::integer); end if;

  with ticket_time as (
    select t.id,d.manufacturer,d.model,sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t
    join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=p_location_id
      and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>v_days)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.manufacturer,d.model
    having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into v_model
  from ticket_time
  where lower(coalesce(manufacturer,''))=lower(coalesce(p_manufacturer,''))
    and lower(coalesce(model,''))=lower(coalesce(p_model,''))
  having count(*)>=3;
  if v_model is not null then return greatest(15,round(v_model)::integer); end if;

  with ticket_time as (
    select t.id,public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,
      sum(coalesce(i.active_seconds,0))/60.0 active_minutes
    from public.repair_tickets t
    join public.devices d on d.id=t.device_id
    join public.repair_work_intervals i on i.ticket_id=t.id and i.ended_at is not null
    where t.location_id=p_location_id
      and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and i.started_at>=now()-make_interval(days=>v_days)
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
    group by t.id,d.category,d.manufacturer,d.model
    having sum(coalesce(i.active_seconds,0))>=300
  )
  select percentile_cont(.5) within group(order by active_minutes) into v_class
  from ticket_time where device_class=v_cls having count(*)>=5;
  return greatest(15,coalesce(round(v_class)::integer,v_fallback,480));
end;$fn$;

create or replace function public.get_repair_workload_forecast_for_location(p_location_id uuid,p_target_date date default null)
returns jsonb language plpgsql stable security definer set search_path='public' as $fn$
declare
  v_target date; v_util numeric:=.70; v_scheduled integer:=0; v_usable integer:=0;
  v_queue integer:=0; v_blocked integer:=0; v_appts integer:=0; v_remaining integer:=0;
  v_queue_json jsonb:='[]'::jsonb; v_appt_json jsonb:='[]'::jsonb;
begin
  if p_location_id is null then raise exception 'Location required.'; end if;
  v_target:=coalesce(p_target_date,public.current_business_date(p_location_id));
  select coalesce(repair_capacity_utilization,.70) into v_util from public.business_settings where location_id=p_location_id;
  select coalesce(sum(greatest(0,(extract(epoch from (s.ends_at-s.starts_at))/60)::integer-coalesce(s.break_minutes,0))),0)::integer
  into v_scheduled
  from public.shifts s join public.profiles p on p.id=s.employee_id
  where s.location_id=p_location_id and s.shift_date=v_target and p.active=true and p.role::text in ('technician','manager');
  v_usable:=floor(v_scheduled*v_util)::integer;

  with q as (
    select t.id,t.ticket_number,t.status::text status,t.parts_status,d.category,d.manufacturer,d.model,
      public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,
      coalesce((select string_agg(w.description,' | ' order by w.created_at) from public.work_order_items w where w.ticket_id=t.id and w.item_type='service'),t.customer_issue,'') service_text,
      coalesce((select sum(coalesce(i.active_seconds,case when i.ended_at is null then greatest(0,floor(extract(epoch from (now()-i.started_at)))::integer) else 0 end))/60 from public.repair_work_intervals i where i.ticket_id=t.id),0)::integer worked_minutes,
      (t.status::text in ('need_to_order_parts','awaiting_parts','waiting_on_parts','awaiting_customer','awaiting_approval') or t.parts_status in ('need_to_order','ordered','awaiting_parts')) is_blocked
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    where t.location_id=p_location_id
      and t.status::text not in ('repaired','ready_for_pickup','sale_complete','completed','cancelled','customer_declined','unrepairable','abandoned')
  ), calc as (
    select q.*,public.expected_repair_minutes_for_location(p_location_id,q.category,q.manufacturer,q.model,q.service_text,180) expected_minutes from q
  ), final as (
    select c.*,greatest(15,c.expected_minutes-c.worked_minutes) remaining_minutes from calc c
  )
  select coalesce(sum(f.remaining_minutes) filter(where not f.is_blocked),0)::integer,
         coalesce(sum(f.remaining_minutes) filter(where f.is_blocked),0)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'ticket_id',f.id,'ticket_number',f.ticket_number,'status',f.status,'parts_status',f.parts_status,
           'device_class',f.device_class,'manufacturer',f.manufacturer,'model',f.model,'service',f.service_text,
           'expected_minutes',f.expected_minutes,'worked_minutes',f.worked_minutes,'remaining_minutes',f.remaining_minutes,'blocked',f.is_blocked
         ) order by f.is_blocked,f.remaining_minutes desc),'[]'::jsonb)
  into v_queue,v_blocked,v_queue_json from final f;

  with a as (
    select ap.id,ap.starts_at,ap.preferred_date,ap.preferred_time,ap.device_description,ap.service_requested,ap.parts_status,
      public.normalize_repair_device_class(ap.device_description,null,ap.device_description) device_class,
      public.expected_repair_minutes_for_location(p_location_id,ap.device_description,null,ap.device_description,ap.service_requested,180) expected_minutes
    from public.appointments ap
    where ap.location_id=p_location_id and coalesce(ap.starts_at::date,ap.preferred_date)=v_target
      and ap.status not in ('cancelled','no_show','completed')
  )
  select coalesce(sum(a.expected_minutes),0)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'appointment_id',a.id,'starts_at',a.starts_at,'preferred_time',a.preferred_time,
           'device_description',a.device_description,'service_requested',a.service_requested,
           'parts_status',a.parts_status,'device_class',a.device_class,'expected_minutes',a.expected_minutes
         ) order by a.starts_at nulls last),'[]'::jsonb)
  into v_appts,v_appt_json from a;

  v_remaining:=greatest(0,v_usable-v_queue-v_appts);
  return jsonb_build_object(
    'target_date',v_target,'scheduled_technician_minutes',v_scheduled,'capacity_utilization',v_util,
    'usable_repair_minutes',v_usable,'actionable_queue_minutes',v_queue,'blocked_backlog_minutes',v_blocked,
    'appointment_minutes',v_appts,'remaining_capacity_minutes',v_remaining,
    'capacity_source',case when v_scheduled>0 then 'published_schedule' else 'no_technician_schedule' end,
    'queue',v_queue_json,'appointments',v_appt_json,'generated_at',now()
  );
end;$fn$;

create or replace function public.match_public_repair_part_rules(p_location_id uuid,p_device_type text,p_model text,p_service text)
returns jsonb language plpgsql stable security definer set search_path='public' as $fn$
declare
  v_cls text:=public.normalize_repair_device_class(p_device_type,null,p_model);
  v_model_key text:=public.booking_normalize_text(p_model);
  v_service_key text:=public.normalize_repair_service_key(p_service);
  v_total integer:=0; v_verified integer:=0; v_available boolean:=false; v_min_conf numeric:=0;
  v_rules jsonb:='[]'::jsonb;
begin
  with matched as (
    select r.*,coalesce(i.available_quantity,0) available_quantity
    from public.repair_part_requirement_rules r
    left join public.inventory_commitment_summary i on i.id=r.inventory_item_id
    where r.location_id=p_location_id and r.device_class=v_cls and r.model_key=v_model_key
      and r.service_key=v_service_key and r.active=true
  )
  select count(*)::integer,
         count(*) filter(where verified)::integer,
         coalesce(bool_and(verified and inventory_item_id is not null and available_quantity>=quantity_required),false),
         coalesce(min(confidence_score),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'rule_id',id,'inventory_item_id',inventory_item_id,'registry_part_id',registry_part_id,
           'quantity_required',quantity_required,'available_quantity',available_quantity,
           'verified',verified,'confidence_score',confidence_score
         ) order by id),'[]'::jsonb)
  into v_total,v_verified,v_available,v_min_conf,v_rules from matched;
  return jsonb_build_object(
    'matched',v_total>0,'verified',v_total>0 and v_total=v_verified,'device_class',v_cls,
    'model_key',v_model_key,'service_key',v_service_key,'rule_count',v_total,'verified_rule_count',v_verified,
    'parts_available',v_total>0 and v_total=v_verified and v_available,
    'confidence_score',case when v_total>0 and v_total=v_verified then v_min_conf else 0 end,
    'rules',v_rules
  );
end;$fn$;

create or replace function public.evaluate_public_repair_booking_for_location(
  p_location_id uuid,p_device_category text,p_manufacturer text default null,p_model text default null,
  p_service text default null,p_parts_available boolean default false,p_requested_date date default null
)
returns jsonb language plpgsql stable security definer set search_path='public' as $fn$
declare
  v_target date; v_cls text; v_estimate integer; v_forecast jsonb; v_remaining integer;
  v_buffer numeric:=15; v_lead_days integer:=2; v_required integer; v_eligible boolean;
begin
  v_target:=coalesce(p_requested_date,public.current_business_date(p_location_id));
  v_cls:=public.normalize_repair_device_class(p_device_category,p_manufacturer,p_model);
  v_estimate:=public.expected_repair_minutes_for_location(p_location_id,p_device_category,p_manufacturer,p_model,p_service,180);
  select coalesce(same_day_phone_buffer_percent,15),coalesce(non_phone_min_lead_days,2)
  into v_buffer,v_lead_days from public.business_settings where location_id=p_location_id;
  v_forecast:=public.get_repair_workload_forecast_for_location(p_location_id,v_target);
  v_remaining:=coalesce((v_forecast->>'remaining_capacity_minutes')::integer,0);
  v_required:=ceil(v_estimate*(1+v_buffer/100.0))::integer;
  v_eligible:=v_cls='phone' and coalesce(p_parts_available,false) and v_remaining>=v_required
    and coalesce(v_forecast->>'capacity_source','')='published_schedule';
  return jsonb_build_object(
    'device_class',v_cls,'estimated_active_minutes',v_estimate,'requested_date',v_target,
    'parts_available',coalesce(p_parts_available,false),'remaining_capacity_minutes',v_remaining,
    'buffered_required_minutes',v_required,'same_day_promise_allowed',v_eligible,
    'minimum_lead_days',case when v_eligible then 0 when v_cls='phone' then 1 else v_lead_days end,
    'promise_class',case when v_eligible then 'same_day_phone'
      when v_cls='phone' and not coalesce(p_parts_available,false) then 'phone_parts_required'
      when v_cls='phone' then 'phone_capacity_limited' else 'multi_day' end,
    'customer_message',case when v_eligible then 'This phone repair is eligible for same-day service because the required parts and repair capacity are available.'
      when v_cls='phone' and not coalesce(p_parts_available,false) then 'Same-day phone service cannot be guaranteed until the required part is available.'
      when v_cls='phone' then 'This phone repair cannot be promised for same-day service on the requested date because current repair capacity is already committed.'
      else 'This repair should be scheduled as a multi-day repair. Same-day guarantees are reserved for eligible phone repairs with parts available.' end,
    'forecast',v_forecast
  );
end;$fn$;

create or replace function public.refresh_repair_part_requirement_learning(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='public' as $fn$
declare v_rows integer:=0;
begin
  with base as (
    select t.id ticket_id,d.manufacturer,d.model,
      public.normalize_repair_device_class(d.category,d.manufacturer,d.model) device_class,
      public.booking_normalize_text(d.model) model_key,
      public.normalize_repair_service_key(coalesce(
        (select string_agg(w.description,' | ' order by w.created_at) from public.work_order_items w where w.ticket_id=t.id and w.item_type='service'),
        t.customer_issue,'')) service_key
    from public.repair_tickets t
    join public.devices d on d.id=t.device_id
    where t.location_id=p_location_id
      and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and public.normalize_repair_device_class(d.category,d.manufacturer,d.model)='phone'
      and public.booking_normalize_text(d.model)<>''
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
      and coalesce((select sum(i.active_seconds) from public.repair_work_intervals i where i.ticket_id=t.id and i.ended_at is not null),0)>=300
  ), service_counts as (
    select device_class,model_key,service_key,max(manufacturer) manufacturer,count(distinct ticket_id)::integer service_samples
    from base group by device_class,model_key,service_key
  ), part_usage as (
    select b.device_class,b.model_key,b.service_key,max(b.manufacturer) manufacturer,w.inventory_item_id,
      greatest(1,ceil(percentile_cont(.5) within group(order by greatest(w.quantity,1)))::integer) quantity_required,
      count(distinct b.ticket_id)::integer part_samples
    from base b join public.work_order_items w on w.ticket_id=b.ticket_id
    where w.item_type='part' and w.inventory_item_id is not null
      and coalesce(w.inventory_applied,false)=true and coalesce(w.damaged,false)=false
    group by b.device_class,b.model_key,b.service_key,w.inventory_item_id
  ), candidates as (
    select p.*,s.service_samples,least(1.0,p.part_samples::numeric/nullif(s.service_samples,0)) confidence_score
    from part_usage p join service_counts s using(device_class,model_key,service_key)
    where p.part_samples>=3
  ), upserted as (
    insert into public.repair_part_requirement_rules(
      location_id,device_class,model_key,service_key,manufacturer,inventory_item_id,
      quantity_required,confidence_score,observed_samples,verified,source,verified_at,active,updated_at
    )
    select p_location_id,c.device_class,c.model_key,c.service_key,c.manufacturer,c.inventory_item_id,
      c.quantity_required,c.confidence_score,c.part_samples,
      (c.part_samples>=5 and c.confidence_score>=0.95),'marlon_completed_repairs',
      case when c.part_samples>=5 and c.confidence_score>=0.95 then now() else null end,true,now()
    from candidates c
    on conflict(location_id,device_class,model_key,service_key,inventory_item_id) where inventory_item_id is not null
    do update set manufacturer=excluded.manufacturer,quantity_required=excluded.quantity_required,
      confidence_score=excluded.confidence_score,observed_samples=excluded.observed_samples,
      verified=public.repair_part_requirement_rules.verified or excluded.verified,
      verified_at=case when public.repair_part_requirement_rules.verified then public.repair_part_requirement_rules.verified_at
        when excluded.verified then coalesce(public.repair_part_requirement_rules.verified_at,now())
        else public.repair_part_requirement_rules.verified_at end,
      source=case when public.repair_part_requirement_rules.verified_by is not null
        then public.repair_part_requirement_rules.source else excluded.source end,
      active=true,updated_at=now()
    returning 1
  )
  select count(*)::integer into v_rows from upserted;
  return jsonb_build_object(
    'updated_rules',v_rows,'location_id',p_location_id,'generated_at',now(),
    'auto_verify_policy','At least 5 completed matching phone repairs and >=95% consistent part usage.'
  );
end;$fn$;

create or replace function public.booking_rollout_readiness_for_location(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='public' as $fn$
declare
  s public.business_settings; v_phone_samples integer:=0; v_evals integer:=0; v_mapped integer:=0;
  v_adjudicated integer:=0; v_correct integer:=0; v_positive integer:=0; v_false_positive integer:=0;
  v_map_rate numeric:=0; v_accuracy numeric:=0; v_fp_rate numeric:=0;
  v_quality boolean:=false; v_advisory_age numeric:=0; v_eligible_active boolean:=false;
begin
  select * into s from public.business_settings where location_id=p_location_id;
  if s.location_id is null then raise exception 'Business settings not found.'; end if;

  with completed as (
    select t.id
    from public.repair_tickets t join public.devices d on d.id=t.device_id
    where t.location_id=p_location_id
      and t.status::text in ('repaired','ready_for_pickup','sale_complete','completed')
      and public.normalize_repair_device_class(d.category,d.manufacturer,d.model)='phone'
      and not exists(select 1 from public.repair_work_intervals oi where oi.ticket_id=t.id and oi.ended_at is null)
      and coalesce((select sum(i.active_seconds) from public.repair_work_intervals i where i.ticket_id=t.id and i.ended_at is not null),0)>=300
  ) select count(*)::integer into v_phone_samples from completed;

  select count(*)::integer,
         count(*) filter(where part_mapping_verified)::integer,
         count(*) filter(where outcome_comparable=true and adjudicated_at is not null)::integer,
         count(*) filter(where outcome_comparable=true and adjudicated_at is not null and prediction_correct=true)::integer,
         count(*) filter(where outcome_comparable=true and adjudicated_at is not null and predicted_same_day=true)::integer,
         count(*) filter(where outcome_comparable=true and adjudicated_at is not null and predicted_same_day=true and actual_same_day=false)::integer
  into v_evals,v_mapped,v_adjudicated,v_correct,v_positive,v_false_positive
  from public.booking_shadow_evaluations
  where location_id=p_location_id and device_class='phone' and created_at>=now()-interval '180 days';

  v_map_rate:=case when v_evals>0 then v_mapped::numeric/v_evals else 0 end;
  v_accuracy:=case when v_adjudicated>0 then v_correct::numeric/v_adjudicated else 0 end;
  v_fp_rate:=case when v_positive>0 then v_false_positive::numeric/v_positive else 0 end;
  v_quality:=v_phone_samples>=s.booking_readiness_min_completed_phone_samples
    and v_evals>=s.booking_readiness_min_shadow_evaluations
    and v_adjudicated>=s.booking_readiness_min_adjudicated
    and v_positive>=s.booking_readiness_min_positive_predictions
    and v_map_rate>=s.booking_readiness_min_part_mapping_rate
    and v_accuracy>=s.booking_readiness_min_accuracy
    and v_fp_rate<=s.booking_readiness_max_false_positive_rate;
  v_advisory_age:=case when s.booking_advisory_started_at is not null
    then extract(epoch from (now()-s.booking_advisory_started_at))/86400.0 else 0 end;
  v_eligible_active:=v_quality and s.public_booking_intelligence_mode='advisory'
    and v_advisory_age>=s.booking_readiness_advisory_days;

  return jsonb_build_object(
    'mode',s.public_booking_intelligence_mode,'auto_enable',s.marlon_public_booking_auto_enable,
    'completed_phone_samples',v_phone_samples,'shadow_phone_evaluations',v_evals,
    'verified_part_mapping_evaluations',v_mapped,'part_mapping_rate',round(v_map_rate,4),
    'adjudicated_predictions',v_adjudicated,'correct_predictions',v_correct,'prediction_accuracy',round(v_accuracy,4),
    'positive_same_day_predictions',v_positive,'false_positive_same_day_predictions',v_false_positive,
    'false_positive_rate',round(v_fp_rate,4),
    'thresholds',jsonb_build_object(
      'min_completed_phone_samples',s.booking_readiness_min_completed_phone_samples,
      'min_shadow_evaluations',s.booking_readiness_min_shadow_evaluations,
      'min_adjudicated',s.booking_readiness_min_adjudicated,
      'min_positive_predictions',s.booking_readiness_min_positive_predictions,
      'min_accuracy',s.booking_readiness_min_accuracy,
      'min_part_mapping_rate',s.booking_readiness_min_part_mapping_rate,
      'max_false_positive_rate',s.booking_readiness_max_false_positive_rate,
      'advisory_days',s.booking_readiness_advisory_days),
    'quality_ready',v_quality,'eligible_for_advisory',v_quality,
    'advisory_age_days',round(v_advisory_age,2),'eligible_for_active',v_eligible_active,
    'policy','Marlon may only advance Shadow -> Advisory -> Active when all configured evidence thresholds pass. Active automatically falls back to Shadow if quality drops.'
  );
end;$fn$;

create or replace function public.marlon_advance_public_booking_mode(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path='public' as $fn$
declare s public.business_settings; r jsonb; v_from text; v_to text; v_reason text;
begin
  perform public.refresh_repair_part_requirement_learning(p_location_id);
  select * into s from public.business_settings where location_id=p_location_id for update;
  if s.location_id is null then raise exception 'Business settings not found.'; end if;
  r:=public.booking_rollout_readiness_for_location(p_location_id);
  v_from:=s.public_booking_intelligence_mode; v_to:=v_from;
  if not s.marlon_public_booking_auto_enable or v_from='off' then
    return jsonb_build_object('changed',false,'mode',v_from,'reason','Automatic confidence-gated rollout is disabled.','readiness',r);
  end if;

  if v_from='shadow' and coalesce((r->>'eligible_for_advisory')::boolean,false) then
    v_to:='advisory'; v_reason:='Evidence thresholds passed; Marlon entered advisory mode.';
    update public.business_settings
      set public_booking_intelligence_mode='advisory',booking_advisory_started_at=now(),booking_active_started_at=null,updated_at=now()
      where location_id=p_location_id;
  elsif v_from='advisory' and not coalesce((r->>'quality_ready')::boolean,false) then
    v_to:='shadow'; v_reason:='Confidence or safety metrics fell below threshold; public booking intelligence returned to shadow mode.';
    update public.business_settings
      set public_booking_intelligence_mode='shadow',booking_advisory_started_at=null,booking_active_started_at=null,updated_at=now()
      where location_id=p_location_id;
  elsif v_from='advisory' and coalesce((r->>'eligible_for_active')::boolean,false) then
    v_to:='active'; v_reason:='Advisory validation period and all evidence thresholds passed; Marlon activated customer timing guidance.';
    update public.business_settings
      set public_booking_intelligence_mode='active',booking_active_started_at=now(),updated_at=now()
      where location_id=p_location_id;
  elsif v_from='active' and not coalesce((r->>'quality_ready')::boolean,false) then
    v_to:='shadow'; v_reason:='Live prediction quality fell below safety threshold; Marlon automatically disabled customer timing guidance.';
    update public.business_settings
      set public_booking_intelligence_mode='shadow',booking_advisory_started_at=null,booking_active_started_at=null,updated_at=now()
      where location_id=p_location_id;
  end if;

  if v_to<>v_from then
    insert into public.booking_rollout_events(location_id,from_mode,to_mode,reason,readiness,actor)
    values(p_location_id,v_from,v_to,v_reason,r,'marlon_auto_gate');
    r:=public.booking_rollout_readiness_for_location(p_location_id);
  end if;
  return jsonb_build_object(
    'changed',v_to<>v_from,'from_mode',v_from,'mode',v_to,
    'reason',coalesce(v_reason,'No rollout change required.'),'readiness',r
  );
end;$fn$;

create or replace function public.record_public_booking_shadow_evaluation(
  p_location_id uuid,p_lead_id uuid,p_appointment_id uuid,p_requested_date date,
  p_device_type text,p_device_model text,p_service text,p_part_mapping jsonb,p_recommendation jsonb
)
returns jsonb language plpgsql security definer set search_path='public' as $fn$
declare
  s public.business_settings; v_id uuid; v_cls text; v_first_rule uuid; v_conf numeric:=0; v_rollout jsonb;
begin
  select * into s from public.business_settings where location_id=p_location_id;
  v_cls:=coalesce(p_recommendation->>'device_class',public.normalize_repair_device_class(p_device_type,null,p_device_model));
  begin v_first_rule:=nullif(p_part_mapping->'rules'->0->>'rule_id','')::uuid; exception when others then v_first_rule:=null; end;
  if v_cls<>'phone' then v_conf:=1;
  elsif coalesce((p_part_mapping->>'verified')::boolean,false)
    and coalesce(p_recommendation->'forecast'->>'capacity_source','')='published_schedule'
    then v_conf:=least(0.99,coalesce((p_part_mapping->>'confidence_score')::numeric,0.90));
  elsif coalesce((p_part_mapping->>'verified')::boolean,false) then v_conf:=0.65;
  else v_conf:=0.25; end if;

  insert into public.booking_shadow_evaluations(
    location_id,lead_id,appointment_id,requested_date,device_type,device_model,device_class,service_key,
    part_rule_id,part_mapping_verified,parts_available,expected_active_minutes,remaining_capacity_minutes,
    capacity_source,predicted_same_day,prediction_confidence,recommendation,forecast,mode_at_evaluation,part_mapping
  )
  values(
    p_location_id,p_lead_id,p_appointment_id,p_requested_date,p_device_type,p_device_model,v_cls,
    public.normalize_repair_service_key(p_service),v_first_rule,
    coalesce((p_part_mapping->>'verified')::boolean,false),
    coalesce((p_part_mapping->>'parts_available')::boolean,false),
    coalesce((p_recommendation->>'estimated_active_minutes')::integer,0),
    coalesce((p_recommendation->>'remaining_capacity_minutes')::integer,0),
    coalesce(p_recommendation->'forecast'->>'capacity_source','unknown'),
    coalesce((p_recommendation->>'same_day_promise_allowed')::boolean,false),v_conf,
    coalesce(p_recommendation,'{}'::jsonb),coalesce(p_recommendation->'forecast','{}'::jsonb),
    coalesce(s.public_booking_intelligence_mode,'shadow'),coalesce(p_part_mapping,'{}'::jsonb)
  ) returning id into v_id;
  v_rollout:=public.marlon_advance_public_booking_mode(p_location_id);
  return jsonb_build_object(
    'evaluation_id',v_id,'recorded_mode',coalesce(s.public_booking_intelligence_mode,'shadow'),
    'current_mode',v_rollout->>'mode','rollout',v_rollout
  );
end;$fn$;

create or replace function public.adjudicate_booking_shadow_from_ticket()
returns trigger language plpgsql security definer set search_path='public' as $fn$
declare v_ready timestamptz; v_arrival timestamptz; v_minutes integer:=0;
begin
  if new.status::text not in ('repaired','ready_for_pickup','sale_complete','completed') then return new; end if;
  if tg_op='UPDATE' and old.status is not distinct from new.status
    and old.ready_for_pickup_at is not distinct from new.ready_for_pickup_at
    and old.completed_at is not distinct from new.completed_at then return new; end if;
  v_ready:=coalesce(new.ready_for_pickup_at,new.completed_at,new.updated_at);
  v_arrival:=coalesce(new.arrived_at,new.created_at);
  select coalesce(sum(active_seconds),0)/60 into v_minutes
  from public.repair_work_intervals where ticket_id=new.id and ended_at is not null;
  update public.booking_shadow_evaluations b
  set actual_ticket_id=new.id,actual_ready_at=v_ready,actual_active_minutes=v_minutes,
      actual_same_day=(v_ready::date=v_arrival::date),
      outcome_comparable=(b.requested_date is not null and b.requested_date=v_arrival::date),
      prediction_correct=case when b.requested_date is not null and b.requested_date=v_arrival::date
        then b.predicted_same_day=(v_ready::date=v_arrival::date) else null end,
      adjudicated_at=now()
  where b.location_id=new.location_id and b.adjudicated_at is null and (
    (new.lead_id is not null and b.lead_id=new.lead_id) or
    b.lead_id in (select l.id from public.leads l where l.converted_ticket_id=new.id)
  );
  perform public.marlon_advance_public_booking_mode(new.location_id);
  return new;
end;$fn$;

drop trigger if exists booking_shadow_ticket_adjudication on public.repair_tickets;
create trigger booking_shadow_ticket_adjudication
  after insert or update on public.repair_tickets
  for each row execute function public.adjudicate_booking_shadow_from_ticket();

revoke all on function public.expected_repair_minutes_for_location(uuid,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.get_repair_workload_forecast_for_location(uuid,date) from public,anon,authenticated;
revoke all on function public.match_public_repair_part_rules(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.evaluate_public_repair_booking_for_location(uuid,text,text,text,text,boolean,date) from public,anon,authenticated;
revoke all on function public.refresh_repair_part_requirement_learning(uuid) from public,anon,authenticated;
revoke all on function public.booking_rollout_readiness_for_location(uuid) from public,anon,authenticated;
revoke all on function public.marlon_advance_public_booking_mode(uuid) from public,anon,authenticated;
revoke all on function public.record_public_booking_shadow_evaluation(uuid,uuid,uuid,date,text,text,text,jsonb,jsonb) from public,anon,authenticated;

grant execute on function public.expected_repair_minutes_for_location(uuid,text,text,text,text,integer) to service_role;
grant execute on function public.get_repair_workload_forecast_for_location(uuid,date) to service_role;
grant execute on function public.match_public_repair_part_rules(uuid,text,text,text) to service_role;
grant execute on function public.evaluate_public_repair_booking_for_location(uuid,text,text,text,text,boolean,date) to service_role;
grant execute on function public.refresh_repair_part_requirement_learning(uuid) to service_role;
grant execute on function public.booking_rollout_readiness_for_location(uuid) to service_role;
grant execute on function public.marlon_advance_public_booking_mode(uuid) to service_role;
grant execute on function public.record_public_booking_shadow_evaluation(uuid,uuid,uuid,date,text,text,text,jsonb,jsonb) to service_role;
