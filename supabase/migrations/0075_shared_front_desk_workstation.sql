alter table public.profiles
  add column if not exists account_type text not null default 'staff';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.profiles'::regclass
      and conname='profiles_account_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('staff','shared_workstation')) not valid;
  end if;
end $$;

alter table public.profiles validate constraint profiles_account_type_check;
comment on column public.profiles.account_type is
  'Classifies human staff accounts separately from persistent shared workstation logins.';

update public.profiles p
set account_type='shared_workstation',
    display_name='Front Desk Workstation',
    job_title='Shared workstation',
    badge_label='Shared workstation',
    updated_at=now()
where exists (
  select 1 from auth.users u
  where u.id=p.id and lower(u.email)=lower('foh@gotcracked.co')
);

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((
    select case
      when p.account_type='shared_workstation' then $1=any(array[
        'dashboard.view',
        'repairs.view','repairs.intake',
        'ready_pickup.view','ready_pickup.checkout',
        'leads.view','leads.manage',
        'appointments.view','appointments.manage',
        'customers.view','customers.edit',
        'inventory.view','reference.view','labels.work_order'
      ])
      when p.role='owner' then true
      when p.role in ('technician','front_desk') and $1=any(array[
        'reports.view','staff.manage','settings.manage','pricing.override','schedule.manage'
      ]) then false
      when o.enabled is not null then o.enabled
      else public.role_default_permission(p.role,$1)
    end
    from public.profiles p
    left join public.staff_permission_overrides o
      on o.profile_id=p.id and o.permission_key=$1
    where p.id=auth.uid() and p.active=true
  ),false)
$function$;

do $patch$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('public.get_employee_recognition(integer)'::regprocedure) into definition;
  if definition is not null and definition not like '%coalesce(account_type,''staff'')=''staff''%' then
    revised := replace(
      definition,
      'where location_id=loc and active=true and role::text<>''owner''',
      'where location_id=loc and active=true and coalesce(account_type,''staff'')=''staff'' and role::text<>''owner'''
    );
    if revised=definition then raise exception 'Unable to patch get_employee_recognition staff filter.'; end if;
    execute revised;
  end if;

  select pg_get_functiondef('public.get_schedule_planning_summary(date)'::regprocedure) into definition;
  if definition is not null and definition not like '%p.account_type%' then
    revised := replace(
      definition,
      'from public.profiles p where p.location_id=loc and p.active=true;',
      'from public.profiles p where p.location_id=loc and p.active=true and coalesce(p.account_type,''staff'')=''staff'';'
    );
    if revised=definition then raise exception 'Unable to patch get_schedule_planning_summary staff filter.'; end if;
    execute revised;
  end if;

  select pg_get_functiondef('public.get_staff_schedule_week(date)'::regprocedure) into definition;
  if definition is not null and definition not like '%p.account_type%' then
    revised := replace(
      definition,
      'where p.location_id=loc and p.active=true;',
      'where p.location_id=loc and p.active=true and coalesce(p.account_type,''staff'')=''staff'';'
    );
    if revised=definition then raise exception 'Unable to patch get_staff_schedule_week staff filter.'; end if;
    execute revised;
  end if;

  select pg_get_functiondef('public.get_timesheet_week(date,uuid)'::regprocedure) into definition;
  if definition is not null and definition not like '%p.account_type%' then
    revised := replace(
      definition,
      E'where p.location_id=loc and p.active=true\n    and (can_manage or p.id=uid)',
      E'where p.location_id=loc and p.active=true\n    and coalesce(p.account_type,''staff'')=''staff''\n    and (can_manage or p.id=uid)'
    );
    if revised=definition then raise exception 'Unable to patch get_timesheet_week employee filter.'; end if;
    execute revised;
  end if;
end $patch$;

delete from public.staff_permission_overrides o
using public.profiles p
where p.id=o.profile_id and p.account_type='shared_workstation';
