drop policy if exists "permissioned management can manage schedule weeks" on public.schedule_weeks;
create policy "permissioned management can manage schedule weeks"
on public.schedule_weeks for all to authenticated
using (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')))
with check (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')));

drop policy if exists "permissioned staff can view published schedule weeks" on public.schedule_weeks;
create policy "permissioned staff can view published schedule weeks"
on public.schedule_weeks for select to authenticated
using (
  location_id = (select public.current_location_id())
  and (select public.has_permission('schedule.view'))
  and ((select public.has_permission('schedule.manage')) or status = 'published')
);

drop policy if exists "permissioned management can manage shifts" on public.shifts;
create policy "permissioned management can manage shifts"
on public.shifts for all to authenticated
using (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')))
with check (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')));

drop policy if exists "permissioned staff can view published shifts" on public.shifts;
create policy "permissioned staff can view published shifts"
on public.shifts for select to authenticated
using (
  location_id = (select public.current_location_id())
  and (select public.has_permission('schedule.view'))
  and (
    (select public.has_permission('schedule.manage'))
    or exists (
      select 1 from public.schedule_weeks w
      where w.id = shifts.schedule_week_id
        and w.location_id = (select public.current_location_id())
        and w.status = 'published'
    )
  )
);

drop policy if exists "permissioned management can manage time off" on public.time_off_requests;
create policy "permissioned management can manage time off"
on public.time_off_requests for all to authenticated
using (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')))
with check (location_id = (select public.current_location_id()) and (select public.has_permission('schedule.manage')));

drop policy if exists "staff can request time off" on public.time_off_requests;
create policy "staff can request time off"
on public.time_off_requests for insert to authenticated
with check (location_id = (select public.current_location_id()) and employee_id = (select auth.uid()));

drop policy if exists "staff can view own time off" on public.time_off_requests;
create policy "staff can view own time off"
on public.time_off_requests for select to authenticated
using (
  location_id = (select public.current_location_id())
  and (
    employee_id = (select auth.uid())
    or (select public.current_staff_role()) = any (array['owner'::public.staff_role,'manager'::public.staff_role])
  )
);

drop policy if exists "staff can read own or managed permission overrides" on public.staff_permission_overrides;
create policy "staff can read own or managed permission overrides"
on public.staff_permission_overrides for select to authenticated
using (
  profile_id = (select auth.uid())
  or (
    (select public.current_staff_role()) = any (array['owner'::public.staff_role,'manager'::public.staff_role])
    and (select public.has_permission('staff.manage'))
    and exists (
      select 1 from public.profiles target
      where target.id = staff_permission_overrides.profile_id
        and target.location_id = (select public.current_location_id())
    )
  )
);

create index if not exists appointments_customer_id_idx on public.appointments(customer_id);
create index if not exists appointments_lead_id_idx on public.appointments(lead_id);
create index if not exists shifts_schedule_week_id_idx on public.shifts(schedule_week_id);
create index if not exists time_off_requests_location_id_idx on public.time_off_requests(location_id);
create index if not exists website_chat_sessions_location_id_idx on public.website_chat_sessions(location_id);
