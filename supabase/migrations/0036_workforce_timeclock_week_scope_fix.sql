-- Keep schedule-aware time clock week aggregation unambiguous for all environments.
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
  current_week_start date;
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
  current_week_start:=local_day-extract(dow from local_day)::integer;
  select * into cfg from public.business_settings bs where bs.location_id=loc;

  select s.* into today_shift
  from public.shifts s
  join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and s.shift_date=local_day and w.status='published'
  order by abs(extract(epoch from ((local_day+s.starts_at)-local_now))) asc
  limit 1;

  select s.* into next_shift
  from public.shifts s
  join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and w.status='published'
    and (s.shift_date>local_day or (s.shift_date=local_day and s.starts_at>local_now::time))
  order by s.shift_date,s.starts_at
  limit 1;

  select coalesce(sum(greatest(0,
    extract(epoch from (coalesce(te.clock_out,now())-te.clock_in))-
    coalesce((
      select sum(extract(epoch from (coalesce(b.ended_at,now())-b.started_at)))
      from public.time_entry_breaks b where b.time_entry_id=te.id
    ),0)
  )),0) into weekly_paid_seconds
  from public.time_entries te
  where te.location_id=loc and te.employee_id=uid
    and (te.clock_in at time zone tz)::date between current_week_start and current_week_start+6;

  select coalesce(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0),0)
  into scheduled_week_hours
  from public.shifts s
  join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc and s.employee_id=uid and w.week_start=current_week_start and w.status='published';

  context:=jsonb_build_object(
    'today_shift',case when today_shift.id is null then null else jsonb_build_object(
      'id',today_shift.id,'date',today_shift.shift_date,'starts_at',today_shift.starts_at,
      'ends_at',today_shift.ends_at,'role_label',today_shift.role_label
    ) end,
    'next_shift',case when next_shift.id is null then null else jsonb_build_object(
      'id',next_shift.id,'date',next_shift.shift_date,'starts_at',next_shift.starts_at,
      'ends_at',next_shift.ends_at,'role_label',next_shift.role_label
    ) end,
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
  into total_break_seconds
  from public.time_entry_breaks b where b.time_entry_id=entry_row.id;
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

revoke all on function public.get_time_clock_state() from public,anon;
grant execute on function public.get_time_clock_state() to authenticated;
