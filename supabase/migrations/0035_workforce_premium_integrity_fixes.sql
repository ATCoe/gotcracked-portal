-- Follow-up integrity fixes for the premium workforce release.
-- 1. Preserve shift-change request history when an approved drop deletes the shift.
-- 2. Expand the existing time-entry audit action constraint for clock events.
-- 3. Avoid PL/pgSQL variable/column ambiguity in week-scoped summary functions.

alter table public.shift_change_requests
  alter column shift_id drop not null;

alter table public.shift_change_requests
  drop constraint if exists shift_change_requests_shift_id_fkey;
alter table public.shift_change_requests
  add constraint shift_change_requests_shift_id_fkey
  foreign key (shift_id) references public.shifts(id) on delete set null;

alter table public.time_entry_audit
  drop constraint if exists time_entry_audit_action_check;
alter table public.time_entry_audit
  add constraint time_entry_audit_action_check
  check (action in ('edit','delete','approve','unapprove','week_approve','clock_in','clock_out'));

create or replace function public.get_schedule_conflicts(target_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  loc uuid:=public.current_location_id();
  target_start date:=target_week-extract(dow from target_week)::integer;
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
    where s.location_id=loc and w.week_start=target_start
  ), conflicts as (
    select jsonb_build_object(
      'type','time_off','severity','error','shift_id',s.id,'employee_id',s.employee_id,
      'employee_name',s.display_name,'date',s.shift_date,
      'message','Scheduled during approved time off'
    ) item
    from week_shifts s
    where exists(
      select 1 from public.time_off_requests t
      where t.employee_id=s.employee_id and t.location_id=loc and t.status='approved'
        and s.shift_date between t.starts_on and t.ends_on
    )

    union all

    select jsonb_build_object(
      'type','availability','severity','warning','shift_id',s.id,'employee_id',s.employee_id,
      'employee_name',s.display_name,'date',s.shift_date,
      'message',case when not a.is_available then 'Scheduled on an unavailable day' else 'Shift falls outside recorded availability' end
    )
    from week_shifts s
    join public.staff_availability a
      on a.employee_id=s.employee_id and a.location_id=loc
     and a.weekday=extract(dow from s.shift_date)::integer
    where not a.is_available or s.starts_at<a.starts_at or s.ends_at>a.ends_at

    union all

    select jsonb_build_object(
      'type','overlap','severity','error','shift_id',a.id,'employee_id',a.employee_id,
      'employee_name',a.display_name,'date',a.shift_date,'message','Overlapping shifts'
    )
    from week_shifts a
    join week_shifts b
      on b.employee_id=a.employee_id and b.shift_date=a.shift_date and b.id>a.id
     and a.starts_at<b.ends_at and b.starts_at<a.ends_at

    union all

    select jsonb_build_object(
      'type','long_day','severity','warning','employee_id',s.employee_id,
      'employee_name',max(s.display_name),'date',s.shift_date,
      'message',round(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)::numeric,1)||' scheduled hours in one day'
    )
    from week_shifts s
    group by s.employee_id,s.shift_date
    having sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)>12

    union all

    select jsonb_build_object(
      'type','overtime','severity','warning','employee_id',s.employee_id,
      'employee_name',max(s.display_name),
      'message',round(sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)::numeric,1)||' scheduled hours this week'
    )
    from week_shifts s
    group by s.employee_id
    having sum(extract(epoch from (s.ends_at-s.starts_at))/3600.0-s.break_minutes/60.0)
      > coalesce((select bs.timeclock_overtime_warning_hours from public.business_settings bs where bs.location_id=loc),40)
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
  target_start date:=target_week-extract(dow from target_week)::integer;
  can_manage boolean:=false;
  settings_row public.business_settings%rowtype;
  result jsonb;
begin
  if uid is null or loc is null or not coalesce(public.has_permission('schedule.view'),false) then
    raise exception 'You do not have permission to view workforce tools.';
  end if;
  can_manage:=coalesce(public.has_permission('schedule.manage'),false);
  select * into settings_row from public.business_settings bs where bs.location_id=loc;

  select jsonb_build_object(
    'week_start',target_start,
    'can_manage',can_manage,
    'availability',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id',a.employee_id,'employee_name',p.display_name,'weekday',a.weekday,
        'is_available',a.is_available,'starts_at',a.starts_at,'ends_at',a.ends_at,'note',a.note
      ) order by p.display_name,a.weekday)
      from public.staff_availability a
      join public.profiles p on p.id=a.employee_id
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
      where r.location_id=loc
        and (can_manage or r.requester_id=uid or r.target_employee_id=uid)
        and (r.status='pending' or s.shift_date between target_start and target_start+6)
    ),'[]'::jsonb),
    'my_shifts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'date',s.shift_date,'starts_at',s.starts_at,'ends_at',s.ends_at,
        'role_label',s.role_label,'status',w.status
      ) order by s.shift_date,s.starts_at)
      from public.shifts s
      join public.schedule_weeks w on w.id=s.schedule_week_id
      where s.location_id=loc and s.employee_id=uid and w.week_start=target_start
    ),'[]'::jsonb),
    'swap_candidates',case when can_manage then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'employee_id',s.employee_id,'employee_name',p.display_name,'date',s.shift_date,
        'starts_at',s.starts_at,'ends_at',s.ends_at,'role_label',s.role_label
      ) order by s.shift_date,s.starts_at)
      from public.shifts s
      join public.schedule_weeks w on w.id=s.schedule_week_id
      join public.profiles p on p.id=s.employee_id
      where s.location_id=loc and s.employee_id<>uid and w.week_start=target_start and w.status='published'
    ),'[]'::jsonb) end,
    'conflicts',case when can_manage then public.get_schedule_conflicts(target_start) else '[]'::jsonb end,
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

revoke all on function public.get_schedule_conflicts(date) from public,anon;
revoke all on function public.get_workforce_premium_summary(date) from public,anon;
grant execute on function public.get_schedule_conflicts(date) to authenticated;
grant execute on function public.get_workforce_premium_summary(date) to authenticated;
