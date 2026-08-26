-- GotCracked staff profiles and timesheet management
-- Mirrors the production migration applied 2026-08-26.

alter table if exists public.profiles add column if not exists avatar_url text;
alter table if exists public.profiles add column if not exists job_title text;
alter table if exists public.profiles add column if not exists phone text;
alter table if exists public.profiles add column if not exists bio text;
alter table if exists public.profiles add column if not exists updated_at timestamptz not null default now();

alter table if exists public.time_entries add column if not exists approval_note text;
alter table if exists public.time_entries add column if not exists corrected_by uuid references public.profiles(id);
alter table if exists public.time_entries add column if not exists corrected_at timestamptz;
alter table if exists public.time_entries add column if not exists correction_note text;

create table if not exists public.time_entry_audit (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  time_entry_id uuid not null,
  employee_id uuid not null references public.profiles(id),
  action text not null check (action in ('edit','delete','approve','unapprove','week_approve')),
  before_state jsonb,
  after_state jsonb,
  note text,
  actor_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists time_entry_audit_location_created_idx on public.time_entry_audit(location_id,created_at desc);
create index if not exists time_entry_audit_employee_created_idx on public.time_entry_audit(employee_id,created_at desc);
alter table public.time_entry_audit enable row level security;
drop policy if exists "time managers can view time audit" on public.time_entry_audit;
create policy "time managers can view time audit" on public.time_entry_audit
for select to authenticated
using (location_id=public.current_location_id() and public.has_permission('timeclock.manage'));
revoke all on public.time_entry_audit from anon;
revoke insert,update,delete on public.time_entry_audit from authenticated;
grant select on public.time_entry_audit to authenticated;

create or replace function public.update_my_staff_profile(
  new_display_name text,
  new_job_title text default null,
  new_phone text default null,
  new_bio text default null,
  new_avatar_url text default null
) returns public.profiles
language plpgsql security definer set search_path=public as $$
declare saved public.profiles;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  if nullif(btrim(new_display_name),'') is null then raise exception 'Display name is required.'; end if;
  if length(btrim(new_display_name))>120 then raise exception 'Display name is too long.'; end if;
  if length(coalesce(new_job_title,''))>120 then raise exception 'Job title is too long.'; end if;
  if length(coalesce(new_phone,''))>40 then raise exception 'Phone number is too long.'; end if;
  if length(coalesce(new_bio,''))>600 then raise exception 'Profile bio is too long.'; end if;
  if length(coalesce(new_avatar_url,''))>1200 then raise exception 'Avatar URL is too long.'; end if;

  update public.profiles set
    display_name=btrim(new_display_name),
    job_title=nullif(btrim(new_job_title),''),
    phone=nullif(btrim(new_phone),''),
    bio=nullif(btrim(new_bio),''),
    avatar_url=nullif(btrim(new_avatar_url),''),
    updated_at=now()
  where id=auth.uid() and active=true
  returning * into saved;
  if saved.id is null then raise exception 'Active staff profile not found.'; end if;
  return saved;
end; $$;

create or replace function public.update_staff_profile_details(
  target_profile uuid,
  new_display_name text,
  new_job_title text default null,
  new_phone text default null,
  new_bio text default null,
  new_avatar_url text default null
) returns public.profiles
language plpgsql security definer set search_path=public as $$
declare saved public.profiles;
begin
  if auth.uid() is null or not coalesce(public.has_permission('staff.manage'),false) then
    raise exception 'You do not have permission to edit staff profiles.';
  end if;
  if nullif(btrim(new_display_name),'') is null then raise exception 'Display name is required.'; end if;
  if length(btrim(new_display_name))>120 then raise exception 'Display name is too long.'; end if;
  if length(coalesce(new_job_title,''))>120 then raise exception 'Job title is too long.'; end if;
  if length(coalesce(new_phone,''))>40 then raise exception 'Phone number is too long.'; end if;
  if length(coalesce(new_bio,''))>600 then raise exception 'Profile bio is too long.'; end if;
  if length(coalesce(new_avatar_url,''))>1200 then raise exception 'Avatar URL is too long.'; end if;

  update public.profiles set
    display_name=btrim(new_display_name),
    job_title=nullif(btrim(new_job_title),''),
    phone=nullif(btrim(new_phone),''),
    bio=nullif(btrim(new_bio),''),
    avatar_url=nullif(btrim(new_avatar_url),''),
    updated_at=now()
  where id=target_profile and location_id=public.current_location_id()
  returning * into saved;
  if saved.id is null then raise exception 'Staff profile not found for this store.'; end if;
  return saved;
end; $$;

create or replace function public.get_timesheet_week(
  target_week_start date default null,
  target_employee uuid default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  loc uuid:=public.current_location_id();
  uid uuid:=auth.uid();
  tz text:='America/New_York';
  week_start date;
  week_end date;
  can_manage boolean:=coalesce(public.has_permission('timeclock.manage'),false);
  employees jsonb;
  entries jsonb;
  shifts_json jsonb;
begin
  if uid is null or loc is null then raise exception 'Active staff access is required.'; end if;
  if not can_manage and not coalesce(public.has_permission('timeclock.use'),false) then
    raise exception 'You do not have permission to view time records.';
  end if;
  if not can_manage and target_employee is not null and target_employee<>uid then
    raise exception 'You may only view your own time records.';
  end if;

  select coalesce(timezone,'America/New_York') into tz from public.locations where id=loc;
  week_start:=coalesce(target_week_start,(now() at time zone tz)::date);
  week_start:=week_start-extract(dow from week_start)::int;
  week_end:=week_start+6;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'display_name',p.display_name,'role',p.role,'job_title',p.job_title,'avatar_url',p.avatar_url,'active',p.active
  ) order by p.display_name),'[]'::jsonb)
  into employees
  from public.profiles p
  where p.location_id=loc and p.active=true
    and (can_manage or p.id=uid)
    and (target_employee is null or p.id=target_employee);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'employee_id',t.employee_id,'shift_id',t.shift_id,
    'clock_in',t.clock_in,'clock_out',t.clock_out,'break_minutes',t.break_minutes,
    'paid_seconds',greatest(0,
      floor(extract(epoch from (coalesce(t.clock_out,now())-t.clock_in)))::bigint
      - case when t.clock_out is null then coalesce((
          select floor(sum(extract(epoch from (coalesce(b.ended_at,now())-b.started_at))))::bigint
          from public.time_entry_breaks b where b.time_entry_id=t.id
        ),0)
        else greatest(0,t.break_minutes)::bigint*60 end
    ),
    'notes',t.notes,'approved_by',t.approved_by,'approved_at',t.approved_at,
    'approval_note',t.approval_note,'corrected_by',t.corrected_by,'corrected_at',t.corrected_at,
    'correction_note',t.correction_note,'created_at',t.created_at
  ) order by t.clock_in),'[]'::jsonb)
  into entries
  from public.time_entries t
  where t.location_id=loc
    and ((t.clock_in at time zone tz)::date between week_start and week_end)
    and (can_manage or t.employee_id=uid)
    and (target_employee is null or t.employee_id=target_employee);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'employee_id',s.employee_id,'shift_date',s.shift_date,
    'starts_at',s.starts_at,'ends_at',s.ends_at,'break_minutes',s.break_minutes,'role_label',s.role_label
  ) order by s.shift_date,s.starts_at),'[]'::jsonb)
  into shifts_json
  from public.shifts s
  join public.schedule_weeks w on w.id=s.schedule_week_id
  where s.location_id=loc
    and s.shift_date between week_start and week_end
    and (can_manage or s.employee_id=uid)
    and (target_employee is null or s.employee_id=target_employee)
    and (can_manage or w.status='published');

  return jsonb_build_object(
    'week_start',week_start,'week_end',week_end,'timezone',tz,'can_manage',can_manage,
    'employees',employees,'entries',entries,'shifts',shifts_json,'server_time',now()
  );
end; $$;

create or replace function public.update_time_entry(
  target_entry uuid,
  new_clock_in timestamptz,
  new_clock_out timestamptz,
  new_break_minutes integer default 0,
  correction_note text default null
) returns public.time_entries
language plpgsql security definer set search_path=public as $$
declare before_row public.time_entries; saved public.time_entries;
begin
  if auth.uid() is null or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'You do not have permission to edit time records.';
  end if;
  if new_clock_in is null then raise exception 'Clock-in time is required.'; end if;
  if new_clock_out is not null and new_clock_out<=new_clock_in then raise exception 'Clock-out must be after clock-in.'; end if;
  if coalesce(new_break_minutes,0)<0 then raise exception 'Break minutes cannot be negative.'; end if;
  if new_clock_out is not null and (coalesce(new_break_minutes,0)*60)>=extract(epoch from (new_clock_out-new_clock_in)) then
    raise exception 'Break time must be shorter than the shift.';
  end if;
  if nullif(btrim(correction_note),'') is null then raise exception 'A correction note is required.'; end if;

  select * into before_row from public.time_entries
  where id=target_entry and location_id=public.current_location_id() for update;
  if before_row.id is null then raise exception 'Time entry not found.'; end if;

  update public.time_entries set
    clock_in=new_clock_in,clock_out=new_clock_out,
    break_minutes=greatest(0,coalesce(new_break_minutes,0)),
    corrected_by=auth.uid(),corrected_at=now(),correction_note=btrim(correction_note),
    approved_by=null,approved_at=null,approval_note=null
  where id=target_entry returning * into saved;

  insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,before_state,after_state,note,actor_user_id)
  values(saved.location_id,saved.id,saved.employee_id,'edit',to_jsonb(before_row),to_jsonb(saved),btrim(correction_note),auth.uid());
  return saved;
end; $$;

create or replace function public.delete_time_entry(target_entry uuid,deletion_note text)
returns boolean
language plpgsql security definer set search_path=public as $$
declare before_row public.time_entries; break_state jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'You do not have permission to delete time records.';
  end if;
  if nullif(btrim(deletion_note),'') is null then raise exception 'A deletion reason is required.'; end if;

  select * into before_row from public.time_entries
  where id=target_entry and location_id=public.current_location_id() for update;
  if before_row.id is null then raise exception 'Time entry not found.'; end if;

  select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into break_state
  from public.time_entry_breaks b where b.time_entry_id=target_entry;

  insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,before_state,after_state,note,actor_user_id)
  values(before_row.location_id,before_row.id,before_row.employee_id,'delete',to_jsonb(before_row)||jsonb_build_object('breaks',break_state),null,btrim(deletion_note),auth.uid());

  delete from public.time_entry_breaks where time_entry_id=target_entry;
  delete from public.time_entries where id=target_entry;
  return true;
end; $$;

create or replace function public.set_time_entry_approval(
  target_entry uuid,
  approved boolean,
  approval_note text default null
) returns public.time_entries
language plpgsql security definer set search_path=public as $$
declare before_row public.time_entries; saved public.time_entries;
begin
  if auth.uid() is null or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'You do not have permission to approve time records.';
  end if;
  select * into before_row from public.time_entries
  where id=target_entry and location_id=public.current_location_id() for update;
  if before_row.id is null then raise exception 'Time entry not found.'; end if;
  if approved and before_row.clock_out is null then raise exception 'An open punch cannot be approved.'; end if;

  update public.time_entries set
    approved_by=case when approved then auth.uid() else null end,
    approved_at=case when approved then now() else null end,
    approval_note=case when approved then nullif(btrim(approval_note),'') else null end
  where id=target_entry returning * into saved;

  insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,before_state,after_state,note,actor_user_id)
  values(saved.location_id,saved.id,saved.employee_id,case when approved then 'approve' else 'unapprove' end,to_jsonb(before_row),to_jsonb(saved),nullif(btrim(approval_note),''),auth.uid());
  return saved;
end; $$;

create or replace function public.approve_timesheet_week(
  target_employee uuid,
  target_week_start date,
  approval_note text default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  loc uuid:=public.current_location_id();
  tz text:='America/New_York';
  week_start date;
  affected integer:=0;
  row_before public.time_entries;
begin
  if auth.uid() is null or not coalesce(public.has_permission('timeclock.manage'),false) then
    raise exception 'You do not have permission to approve timesheets.';
  end if;
  if not exists(select 1 from public.profiles where id=target_employee and location_id=loc) then
    raise exception 'Employee not found for this store.';
  end if;
  select coalesce(timezone,'America/New_York') into tz from public.locations where id=loc;
  week_start:=target_week_start-extract(dow from target_week_start)::int;

  for row_before in
    select * from public.time_entries
    where location_id=loc and employee_id=target_employee and clock_out is not null
      and ((clock_in at time zone tz)::date between week_start and week_start+6)
      and approved_at is null
    for update
  loop
    update public.time_entries
    set approved_by=auth.uid(),approved_at=now(),approval_note=nullif(btrim(approval_note),'')
    where id=row_before.id;
    insert into public.time_entry_audit(location_id,time_entry_id,employee_id,action,before_state,after_state,note,actor_user_id)
    select row_before.location_id,row_before.id,row_before.employee_id,'week_approve',to_jsonb(row_before),to_jsonb(t),nullif(btrim(approval_note),''),auth.uid()
    from public.time_entries t where t.id=row_before.id;
    affected:=affected+1;
  end loop;
  return affected;
end; $$;

revoke all on function public.update_my_staff_profile(text,text,text,text,text) from public;
revoke all on function public.update_staff_profile_details(uuid,text,text,text,text,text) from public;
revoke all on function public.get_timesheet_week(date,uuid) from public;
revoke all on function public.update_time_entry(uuid,timestamptz,timestamptz,integer,text) from public;
revoke all on function public.delete_time_entry(uuid,text) from public;
revoke all on function public.set_time_entry_approval(uuid,boolean,text) from public;
revoke all on function public.approve_timesheet_week(uuid,date,text) from public;

grant execute on function public.update_my_staff_profile(text,text,text,text,text) to authenticated;
grant execute on function public.update_staff_profile_details(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.get_timesheet_week(date,uuid) to authenticated;
grant execute on function public.update_time_entry(uuid,timestamptz,timestamptz,integer,text) to authenticated;
grant execute on function public.delete_time_entry(uuid,text) to authenticated;
grant execute on function public.set_time_entry_approval(uuid,boolean,text) to authenticated;
grant execute on function public.approve_timesheet_week(uuid,date,text) to authenticated;
