-- GotCracked Portal: premium workforce scheduling + attendance context
-- Adds recurring availability, schedule copy/health tools, shift-change workflows,
-- configurable clock-in policy, and schedule-aware attendance metadata.

alter table public.business_settings
  add column if not exists timeclock_early_clock_in_minutes integer not null default 10,
  add column if not exists timeclock_late_grace_minutes integer not null default 5,
  add column if not exists timeclock_overtime_warning_hours numeric(5,2) not null default 40,
  add column if not exists timeclock_require_scheduled_shift boolean not null default false,
  add column if not exists timeclock_enforce_early_window boolean not null default false;

alter table public.business_settings
  drop constraint if exists business_settings_timeclock_early_minutes_check,
  drop constraint if exists business_settings_timeclock_late_minutes_check,
  drop constraint if exists business_settings_timeclock_overtime_check;
alter table public.business_settings
  add constraint business_settings_timeclock_early_minutes_check check (timeclock_early_clock_in_minutes between 0 and 240),
  add constraint business_settings_timeclock_late_minutes_check check (timeclock_late_grace_minutes between 0 and 240),
  add constraint business_settings_timeclock_overtime_check check (timeclock_overtime_warning_hours between 1 and 168);

alter table public.time_entries
  add column if not exists clock_in_status text,
  add column if not exists clock_in_variance_minutes integer,
  add column if not exists clock_out_variance_minutes integer;

alter table public.time_entries
  drop constraint if exists time_entries_clock_in_status_check;
alter table public.time_entries
  add constraint time_entries_clock_in_status_check
  check (clock_in_status is null or clock_in_status in ('early','on_time','late','unscheduled'));

create table if not exists public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  is_available boolean not null default true,
  starts_at time,
  ends_at time,
  note text,
  updated_at timestamptz not null default now(),
  constraint staff_availability_time_check check (
    not is_available or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  ),
  unique(employee_id,weekday)
);

create index if not exists staff_availability_location_idx
  on public.staff_availability(location_id,employee_id,weekday);

alter table public.staff_availability enable row level security;
drop policy if exists "staff can view relevant availability" on public.staff_availability;
create policy "staff can view relevant availability"
on public.staff_availability for select to authenticated
using (
  location_id = public.current_location_id()
  and (employee_id = auth.uid() or coalesce(public.has_permission('schedule.manage'),false))
);
revoke insert,update,delete on public.staff_availability from anon,authenticated;
grant select on public.staff_availability to authenticated;

create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('drop','swap')),
  target_employee_id uuid references public.profiles(id) on delete set null,
  target_shift_id uuid references public.shifts(id) on delete set null,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  manager_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shift_change_requests_location_status_idx
  on public.shift_change_requests(location_id,status,created_at desc);
create index if not exists shift_change_requests_requester_idx
  on public.shift_change_requests(requester_id,created_at desc);
create unique index if not exists shift_change_requests_one_pending_per_shift_idx
  on public.shift_change_requests(shift_id)
  where status='pending';

alter table public.shift_change_requests enable row level security;
drop policy if exists "staff can view relevant shift requests" on public.shift_change_requests;
create policy "staff can view relevant shift requests"
on public.shift_change_requests for select to authenticated
using (
  location_id = public.current_location_id()
  and (
    requester_id = auth.uid()
    or target_employee_id = auth.uid()
    or coalesce(public.has_permission('schedule.manage'),false)
  )
);
revoke insert,update,delete on public.shift_change_requests from anon,authenticated;
grant select on public.shift_change_requests to authenticated;

create or replace function public.save_staff_weekly_availability(entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  loc uuid:=public.current_location_id();
  item jsonb;
  wd integer;
  available boolean;
  start_time time;
  end_time time;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.view'),false) then
    raise exception 'You do not have permission to update availability.';
  end if;
  if jsonb_typeof(entries) <> 'array' then raise exception 'Availability must be an array.'; end if;

  for item in select value from jsonb_array_elements(entries)
  loop
    wd := (item->>'weekday')::integer;
    if wd < 0 or wd > 6 then raise exception 'Weekday must be between 0 and 6.'; end if;
    available := coalesce((item->>'is_available')::boolean,true);
    start_time := nullif(item->>'starts_at','')::time;
    end_time := nullif(item->>'ends_at','')::time;
    if available and (start_time is null or end_time is null or end_time <= start_time) then
      raise exception 'Available days require a valid start and end time.';
    end if;

    insert into public.staff_availability(location_id,employee_id,weekday,is_available,starts_at,ends_at,note,updated_at)
    values(loc,uid,wd,available,case when available then start_time else null end,case when available then end_time else null end,nullif(btrim(coalesce(item->>'note','')),''),now())
    on conflict(employee_id,weekday) do update set
      location_id=excluded.location_id,
      is_available=excluded.is_available,
      starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,
      note=excluded.note,
      updated_at=now();
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'weekday',a.weekday,'is_available',a.is_available,'starts_at',a.starts_at,
      'ends_at',a.ends_at,'note',a.note
    ) order by a.weekday)
    from public.staff_availability a where a.employee_id=uid and a.location_id=loc
  ),'[]'::jsonb);
end;
$$;

create or replace function public.copy_schedule_week(
  source_week date,
  target_week date,
  replace_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  uid uuid:=auth.uid();
  source_start date;
  target_start date;
  source_row public.schedule_weeks%rowtype;
  target_row public.schedule_weeks%rowtype;
  copied integer:=0;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.manage'),false) then
    raise exception 'Schedule management permission is required.';
  end if;
  source_start := source_week - extract(dow from source_week)::integer;
  target_start := target_week - extract(dow from target_week)::integer;
  if source_start=target_start then raise exception 'Choose a different source week.'; end if;

  select * into source_row from public.schedule_weeks
  where location_id=loc and week_start=source_start;
  if source_row.id is null then raise exception 'The source week does not exist.'; end if;

  select * into target_row from public.schedule_weeks
  where location_id=loc and week_start=target_start for update;
  if target_row.id is null then
    insert into public.schedule_weeks(location_id,week_start,status,forecast_sales_cents,target_splh,created_by)
    values(loc,target_start,'draft',source_row.forecast_sales_cents,source_row.target_splh,uid)
    returning * into target_row;
  else
    update public.schedule_weeks set status='draft',published_at=null,published_by=null,updated_at=now()
    where id=target_row.id returning * into target_row;
  end if;

  if replace_existing then
    delete from public.shifts where schedule_week_id=target_row.id and location_id=loc;
  elsif exists(select 1 from public.shifts where schedule_week_id=target_row.id and location_id=loc) then
    raise exception 'The target week already contains shifts. Choose replace existing to overwrite it.';
  end if;

  insert into public.shifts(
    schedule_week_id,location_id,employee_id,shift_date,starts_at,ends_at,
    break_minutes,role_label,notes,created_by,updated_at
  )
  select target_row.id,loc,s.employee_id,
    s.shift_date + (target_start-source_start),s.starts_at,s.ends_at,
    s.break_minutes,s.role_label,s.notes,uid,now()
  from public.shifts s
  where s.schedule_week_id=source_row.id and s.location_id=loc;
  get diagnostics copied=row_count;

  return jsonb_build_object('week_id',target_row.id,'week_start',target_start,'copied_shifts',copied,'status','draft');
end;
$$;

create or replace function public.request_shift_change(
  shift_id_input uuid,
  request_type_input text,
  target_shift_input uuid default null,
  request_note text default null
)
returns public.shift_change_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  loc uuid:=public.current_location_id();
  own_shift public.shifts%rowtype;
  other_shift public.shifts%rowtype;
  saved public.shift_change_requests;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.view'),false) then
    raise exception 'You do not have permission to request schedule changes.';
  end if;
  if request_type_input not in ('drop','swap') then raise exception 'Choose drop or swap.'; end if;

  select s.* into own_shift from public.shifts s
  join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.id=shift_id_input and s.location_id=loc and s.employee_id=uid and w.status='published';
  if own_shift.id is null then raise exception 'Only your published shifts can be changed through this request.'; end if;

  if request_type_input='swap' then
    if target_shift_input is null then raise exception 'Choose the shift you want to swap with.'; end if;
    select s.* into other_shift from public.shifts s
    join public.schedule_weeks w on w.id=s.schedule_week_id
    where s.id=target_shift_input and s.location_id=loc and s.employee_id<>uid and w.status='published';
    if other_shift.id is null then raise exception 'The requested swap shift is unavailable.'; end if;
  end if;

  insert into public.shift_change_requests(
    location_id,shift_id,requester_id,request_type,target_employee_id,target_shift_id,note,status
  ) values(
    loc,own_shift.id,uid,request_type_input,
    case when request_type_input='swap' then other_shift.employee_id else null end,
    case when request_type_input='swap' then other_shift.id else null end,
    nullif(btrim(coalesce(request_note,'')),'') ,'pending'
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.cancel_shift_change(request_id_input uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  update public.shift_change_requests set status='cancelled',updated_at=now()
  where id=request_id_input and requester_id=auth.uid() and location_id=public.current_location_id() and status='pending';
  if not found then raise exception 'Pending request not found.'; end if;
end;
$$;

create or replace function public.review_shift_change(
  request_id_input uuid,
  decision_input text,
  manager_note_input text default null
)
returns public.shift_change_requests
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  loc uuid:=public.current_location_id();
  req public.shift_change_requests%rowtype;
  shift_a public.shifts%rowtype;
  shift_b public.shifts%rowtype;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.manage'),false) then
    raise exception 'Schedule management permission is required.';
  end if;
  if decision_input not in ('approved','denied') then raise exception 'Decision must be approved or denied.'; end if;

  select * into req from public.shift_change_requests
  where id=request_id_input and location_id=loc and status='pending' for update;
  if req.id is null then raise exception 'Pending request not found.'; end if;

  if decision_input='approved' then
    select * into shift_a from public.shifts where id=req.shift_id and location_id=loc for update;
    if shift_a.id is null then raise exception 'The original shift no longer exists.'; end if;

    if req.request_type='drop' then
      delete from public.shifts where id=shift_a.id;
      update public.schedule_weeks set status='draft',published_at=null,published_by=null,updated_at=now()
      where id=shift_a.schedule_week_id;
    else
      select * into shift_b from public.shifts where id=req.target_shift_id and location_id=loc for update;
      if shift_b.id is null then raise exception 'The target swap shift no longer exists.'; end if;
      update public.shifts set employee_id=shift_b.employee_id,updated_at=now() where id=shift_a.id;
      update public.shifts set employee_id=shift_a.employee_id,updated_at=now() where id=shift_b.id;
      update public.schedule_weeks set status='draft',published_at=null,published_by=null,updated_at=now()
      where id in (shift_a.schedule_week_id,shift_b.schedule_week_id);
    end if;
  end if;

  update public.shift_change_requests set
    status=decision_input,manager_note=nullif(btrim(coalesce(manager_note_input,'')),''),
    reviewed_by=uid,reviewed_at=now(),updated_at=now()
  where id=req.id returning * into req;
  return req;
end;
$$;

create or replace function public.save_workforce_settings(
  early_minutes integer,
  late_minutes integer,
  overtime_hours numeric,
  require_schedule boolean,
  enforce_early boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare loc uuid:=public.current_location_id(); role_name text:=public.current_staff_role();
begin
  if auth.uid() is null or loc is null or role_name not in ('owner','manager')
     or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'Management permission is required to change time-clock policy.';
  end if;
  if early_minutes not between 0 and 240 or late_minutes not between 0 and 240 then
    raise exception 'Clock-in windows must be between 0 and 240 minutes.';
  end if;
  if overtime_hours < 1 or overtime_hours > 168 then raise exception 'Overtime warning hours are invalid.'; end if;

  update public.business_settings set
    timeclock_early_clock_in_minutes=early_minutes,
    timeclock_late_grace_minutes=late_minutes,
    timeclock_overtime_warning_hours=overtime_hours,
    timeclock_require_scheduled_shift=coalesce(require_schedule,false),
    timeclock_enforce_early_window=coalesce(enforce_early,false),
    updated_at=now()
  where location_id=loc;

  return jsonb_build_object(
    'early_clock_in_minutes',early_minutes,'late_grace_minutes',late_minutes,
    'overtime_warning_hours',overtime_hours,'require_scheduled_shift',require_schedule,
    'enforce_early_window',enforce_early
  );
end;
$$;

create or replace function public.get_schedule_conflicts(target_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  week_start date:=target_week-extract(dow from target_week)::integer;
  result jsonb;
begin
  if auth.uid() is null or loc is null or not coalesce(public.has_permission('schedule.manage'),false) then
    raise exception 'Schedule management permission is required.';
  end if;

  with week_shifts as (
    select s.*,p.display_name
    from public.shifts s
    join public.schedule_weeks w on w.id=s.schedule_week_id
    join public.profiles p on p.id=s.employee_id
    where s.location_id=loc and w.week_start=week_start
  ), conflicts as (
    select jsonb_build_object('type','time_off','severity','error','shift_id',s.id,'employee_id',s.employee_id,'employee_name',s.display_name,'date',s.shift_date,'message','Scheduled during approved time off') item
    from week_shifts s
    where exists(select 1 from public.time_off_requests t where t.employee_id=s.employee_id and t.location_id=loc and t.status='approved' and s.shift_date between t.starts_on and t.ends_on)
    union all
    select jsonb_build_object('type','availability','severity','warning','shift_id',s.id,'employee_id',s.employee_id,'employee_name',s.display_name,'date',s.shift_date,'message',case when not a.is_available then 'Scheduled on an unavailable day' else 'Shift falls outside recorded availability' end)
    from week_shifts s join public.staff_availability a on a.employee_id=s.employee_id and a.location_id=loc and a.weekday=extract(dow from s.shift_date)::integer
    where not a.is_available or s.starts_at<a.starts_at or s.ends_at>a.ends_at
    union all
    select jsonb_build_object('type','overlap','severity','error','shift_id',a.id,'employee_id',a.employee_id,'employee_name',a.display_name,'date',a.shift_date,'message','Overlapping shifts')
    from week_shifts a join week_shifts b on b.employee_id=a.employee_id and b.shift_date=a.shift_date and b.id>a.id and a.starts_at<b.ends_at and b.starts_at<a.ends_at
    union all
    select jsonb_build_object('type','long_day','severity','warning','employee_id',s.employee_id,'employee_name',max(s.display_name),'date',s.shift_date,'message',round(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)::numeric,1)||' scheduled hours in one day')
    from week_shifts s group by s.employee_id,s.shift_date
    having sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)>12
    union all
    select jsonb_build_object('type','overtime','severity','warning','employee_id',s.employee_id,'employee_name',max(s.display_name),'message',round(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)::numeric,1)||' scheduled hours this week')
    from week_shifts s group by s.employee_id
    having sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0) > coalesce((select timeclock_overtime_warning_hours from public.business_settings where location_id=loc),40)
  )
  select coalesce(jsonb_agg(item),'[]'::jsonb) into result from conflicts;
  return result;
end;
$$;

create or replace function public.get_workforce_premium_summary(target_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  loc uuid:=public.current_location_id();
  week_start date:=target_week-extract(dow from target_week)::integer;
  can_manage boolean:=false;
  tz text:='America/New_York';
  local_now timestamp;
  settings_row public.business_settings%rowtype;
  result jsonb;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.view'),false) then
    raise exception 'You do not have permission to view workforce tools.';
  end if;
  can_manage:=coalesce(public.has_permission('schedule.manage'),false);
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;
  local_now:=now() at time zone tz;
  select * into settings_row from public.business_settings where location_id=loc;

  select jsonb_build_object(
    'week_start',week_start,
    'can_manage',can_manage,
    'availability',coalesce((
      select jsonb_agg(jsonb_build_object('employee_id',a.employee_id,'employee_name',p.display_name,'weekday',a.weekday,'is_available',a.is_available,'starts_at',a.starts_at,'ends_at',a.ends_at,'note',a.note) order by p.display_name,a.weekday)
      from public.staff_availability a join public.profiles p on p.id=a.employee_id
      where a.location_id=loc and (can_manage or a.employee_id=uid)
    ),'[]'::jsonb),
    'shift_requests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'shift_id',r.shift_id,'requester_id',r.requester_id,'requester_name',p.display_name,
        'request_type',r.request_type,'target_employee_id',r.target_employee_id,'target_shift_id',r.target_shift_id,
        'note',r.note,'status',r.status,'manager_note',r.manager_note,'created_at',r.created_at,
        'shift_date',s.shift_date,'starts_at',s.starts_at,'ends_at',s.ends_at
      ) order by r.created_at desc)
      from public.shift_change_requests r
      join public.profiles p on p.id=r.requester_id
      left join public.shifts s on s.id=r.shift_id
      where r.location_id=loc and (can_manage or r.requester_id=uid or r.target_employee_id=uid)
        and (r.status='pending' or s.shift_date between week_start and week_start+6)
    ),'[]'::jsonb),
    'my_shifts',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'date',s.shift_date,'starts_at',s.starts_at,'ends_at',s.ends_at,'role_label',s.role_label,'status',w.status) order by s.shift_date,s.starts_at)
      from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id
      where s.location_id=loc and s.employee_id=uid and w.week_start=week_start
    ),'[]'::jsonb),
    'swap_candidates',case when can_manage then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'employee_id',s.employee_id,'employee_name',p.display_name,'date',s.shift_date,'starts_at',s.starts_at,'ends_at',s.ends_at,'role_label',s.role_label) order by s.shift_date,s.starts_at)
      from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id join public.profiles p on p.id=s.employee_id
      where s.location_id=loc and s.employee_id<>uid and w.week_start=week_start and w.status='published'
    ),'[]'::jsonb) end,
    'conflicts',case when can_manage then public.get_schedule_conflicts(week_start) else '[]'::jsonb end,
    'settings',jsonb_build_object(
      'early_clock_in_minutes',coalesce(settings_row.timeclock_early_clock_in_minutes,10),
      'late_grace_minutes',coalesce(settings_row.timeclock_late_grace_minutes,5),
      'overtime_warning_hours',coalesce(settings_row.timeclock_overtime_warning_hours,40),
      'require_scheduled_shift',coalesce(settings_row.timeclock_require_scheduled_shift,false),
      'enforce_early_window',coalesce(settings_row.timeclock_enforce_early_window,false)
    )
  ) into result;
  return result;
end;
$$;

-- Schedule-aware time-clock state. Existing clients continue to use state/clock_in/
-- paid_seconds while newer clients gain shift, attendance, and weekly-hour context.
create or replace function public.get_time_clock_state()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  uid uuid:=auth.uid();
  tz text:='America/New_York';
  local_now timestamp;
  local_day date;
  week_start date;
  entry_row public.time_entries%rowtype;
  break_row public.time_entry_breaks%rowtype;
  today_shift public.shifts%rowtype;
  next_shift public.shifts%rowtype;
  total_break_seconds numeric:=0;
  paid_seconds numeric:=0;
  weekly_paid_seconds numeric:=0;
  scheduled_week_hours numeric:=0;
  cfg public.business_settings%rowtype;
  context jsonb;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('timeclock.use'),false) then
    raise exception 'You do not have permission to use the time clock.';
  end if;
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;
  local_now:=now() at time zone tz;
  local_day:=local_now::date;
  week_start:=local_day-extract(dow from local_day)::integer;
  select * into cfg from public.business_settings where location_id=loc;

  select s.* into today_shift
  from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and s.shift_date=local_day and w.status='published'
  order by abs(extract(epoch from ((local_day+s.starts_at)-local_now))) asc limit 1;

  select s.* into next_shift
  from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and w.status='published'
    and (s.shift_date>local_day or (s.shift_date=local_day and s.starts_at>local_now::time))
  order by s.shift_date,s.starts_at limit 1;

  select coalesce(sum(greatest(0,
    extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))-
    coalesce((select sum(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))) from public.time_entry_breaks b where b.time_entry_id=te.id),0)
  )),0) into weekly_paid_seconds
  from public.time_entries te
  where te.location_id=loc and te.employee_id=uid
    and (te.clock_in at time zone tz)::date between week_start and week_start+6;

  select coalesce(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0),0)
  into scheduled_week_hours
  from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and w.week_start=week_start and w.status='published';

  context:=jsonb_build_object(
    'today_shift',case when today_shift.id is null then null else jsonb_build_object('id',today_shift.id,'date',today_shift.shift_date,'starts_at',today_shift.starts_at,'ends_at',today_shift.ends_at,'role_label',today_shift.role_label) end,
    'next_shift',case when next_shift.id is null then null else jsonb_build_object('id',next_shift.id,'date',next_shift.shift_date,'starts_at',next_shift.starts_at,'ends_at',next_shift.ends_at,'role_label',next_shift.role_label) end,
    'weekly_paid_seconds',floor(weekly_paid_seconds)::bigint,
    'scheduled_week_hours',round(scheduled_week_hours::numeric,2),
    'overtime_warning_hours',coalesce(cfg.timeclock_overtime_warning_hours,40),
    'early_clock_in_minutes',coalesce(cfg.timeclock_early_clock_in_minutes,10),
    'late_grace_minutes',coalesce(cfg.timeclock_late_grace_minutes,5),
    'require_scheduled_shift',coalesce(cfg.timeclock_require_scheduled_shift,false),
    'enforce_early_window',coalesce(cfg.timeclock_enforce_early_window,false),
    'server_time',now()
  );

  select * into entry_row from public.time_entries
  where employee_id=uid and location_id=loc and clock_out is null
  order by clock_in desc limit 1;

  if entry_row.id is null then
    return context || jsonb_build_object('state','off_clock','location_id',loc,'employee_id',uid);
  end if;

  select * into break_row from public.time_entry_breaks
  where time_entry_id=entry_row.id and employee_id=uid and ended_at is null
  order by started_at desc limit 1;

  select coalesce(sum(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))),0)
    into total_break_seconds from public.time_entry_breaks b where b.time_entry_id=entry_row.id;
  paid_seconds:=greatest(0,extract(epoch from (now()-entry_row.clock_in))-total_break_seconds);

  return context || jsonb_build_object(
    'state',case when break_row.id is null then 'working' else 'on_break' end,
    'location_id',loc,'employee_id',uid,'time_entry_id',entry_row.id,'shift_id',entry_row.shift_id,
    'clock_in',entry_row.clock_in,'clock_in_status',entry_row.clock_in_status,
    'clock_in_variance_minutes',entry_row.clock_in_variance_minutes,
    'break_id',break_row.id,'break_started_at',break_row.started_at,
    'paid_seconds',floor(paid_seconds)::bigint
  );
end;
$$;

create or replace function public.time_clock_action(action text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  uid uuid:=auth.uid();
  tz text:='America/New_York';
  local_now timestamp;
  local_day date;
  entry_row public.time_entries%rowtype;
  break_row public.time_entry_breaks%rowtype;
  shift_row public.shifts%rowtype;
  break_minutes_total integer:=0;
  normalized text:=lower(trim(action));
  variance integer;
  attendance text;
  cfg public.business_settings%rowtype;
  before_state jsonb;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('timeclock.use'),false) then
    raise exception 'You do not have permission to use the time clock.';
  end if;
  if normalized not in ('clock_in','clock_out','break_start','break_end') then raise exception 'Unsupported time-clock action.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select coalesce(l.timezone,'America/New_York') into tz from public.locations l where l.id=loc;
  local_now:=now() at time zone tz;
  local_day:=local_now::date;
  select * into cfg from public.business_settings where location_id=loc;

  select * into entry_row from public.time_entries
  where employee_id=uid and location_id=loc and clock_out is null
  order by clock_in desc limit 1 for update;

  if normalized='clock_in' then
    if entry_row.id is null then
      select s.* into shift_row
      from public.shifts s join public.schedule_weeks w on w.id=s.schedule_week_id
      where s.location_id=loc and s.employee_id=uid and s.shift_date=local_day and w.status='published'
      order by abs(extract(epoch from ((local_day+s.starts_at)-local_now))) asc limit 1;

      if shift_row.id is null then
        if coalesce(cfg.timeclock_require_scheduled_shift,false) then raise exception 'No published shift is scheduled for you today. Ask a manager before clocking in.'; end if;
        attendance:='unscheduled'; variance:=null;
      else
        variance:=round(extract(epoch from (local_now-(local_day+shift_row.starts_at)))/60.0)::integer;
        if coalesce(cfg.timeclock_enforce_early_window,false) and variance < -coalesce(cfg.timeclock_early_clock_in_minutes,10) then
          raise exception 'Clock-in opens % minutes before your scheduled shift.',coalesce(cfg.timeclock_early_clock_in_minutes,10);
        end if;
        attendance:=case
          when variance < -coalesce(cfg.timeclock_early_clock_in_minutes,10) then 'early'
          when variance > coalesce(cfg.timeclock_late_grace_minutes,5) then 'late'
          else 'on_time' end;
      end if;

      insert into public.time_entries(location_id,employee_id,shift_id,clock_in,break_minutes,clock_in_status,clock_in_variance_minutes)
      values(loc,uid,shift_row.id,now(),0,attendance,variance)
      returning * into entry_row;
      insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,after_state,note,actor_user_id)
      values(loc,entry_row.id,uid,'clock_in',to_jsonb(entry_row),'Attendance: '||attendance,uid);
    end if;

  elsif normalized='break_start' then
    if entry_row.id is null then raise exception 'Clock in before starting a break.'; end if;
    select * into break_row from public.time_entry_breaks where time_entry_id=entry_row.id and ended_at is null order by started_at desc limit 1 for update;
    if break_row.id is null then
      insert into public.time_entry_breaks(time_entry_id,employee_id,started_at) values(entry_row.id,uid,now());
    end if;

  elsif normalized='break_end' then
    if entry_row.id is null then raise exception 'No open time entry was found.'; end if;
    select * into break_row from public.time_entry_breaks where time_entry_id=entry_row.id and ended_at is null order by started_at desc limit 1 for update;
    if break_row.id is not null then update public.time_entry_breaks set ended_at=now() where id=break_row.id; end if;

  elsif normalized='clock_out' then
    if entry_row.id is not null then
      before_state:=to_jsonb(entry_row);
      update public.time_entry_breaks set ended_at=now() where time_entry_id=entry_row.id and ended_at is null;
      select coalesce(round(sum(extract(epoch from (b.ended_at-b.started_at)))/60.0),0)::int into break_minutes_total
      from public.time_entry_breaks b where b.time_entry_id=entry_row.id and b.ended_at is not null;

      if entry_row.shift_id is not null then
        select * into shift_row from public.shifts where id=entry_row.shift_id;
        if shift_row.id is not null then variance:=round(extract(epoch from (local_now-(local_day+shift_row.ends_at)))/60.0)::integer; end if;
      end if;

      update public.time_entries set clock_out=now(),break_minutes=greatest(0,break_minutes_total),clock_out_variance_minutes=variance
      where id=entry_row.id returning * into entry_row;
      insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,before_state,after_state,note,actor_user_id)
      values(loc,entry_row.id,uid,'clock_out',before_state,to_jsonb(entry_row),case when variance is null then null else 'Schedule variance: '||variance||' minutes' end,uid);
    end if;
  end if;

  return public.get_time_clock_state();
end;
$$;

revoke all on function public.save_staff_weekly_availability(jsonb) from public,anon;
revoke all on function public.copy_schedule_week(date,date,boolean) from public,anon;
revoke all on function public.request_shift_change(uuid,text,uuid,text) from public,anon;
revoke all on function public.cancel_shift_change(uuid) from public,anon;
revoke all on function public.review_shift_change(uuid,text,text) from public,anon;
revoke all on function public.save_workforce_settings(integer,integer,numeric,boolean,boolean) from public,anon;
revoke all on function public.get_schedule_conflicts(date) from public,anon;
revoke all on function public.get_workforce_premium_summary(date) from public,anon;
grant execute on function public.save_staff_weekly_availability(jsonb) to authenticated;
grant execute on function public.copy_schedule_week(date,date,boolean) to authenticated;
grant execute on function public.request_shift_change(uuid,text,uuid,text) to authenticated;
grant execute on function public.cancel_shift_change(uuid) to authenticated;
grant execute on function public.review_shift_change(uuid,text,text) to authenticated;
grant execute on function public.save_workforce_settings(integer,integer,numeric,boolean,boolean) to authenticated;
grant execute on function public.get_schedule_conflicts(date) to authenticated;
grant execute on function public.get_workforce_premium_summary(date) to authenticated;
