-- Staff / timesheet indexes and RLS init-plan hardening.

create index if not exists profiles_location_id_idx on public.profiles(location_id);
create index if not exists time_entries_shift_id_idx on public.time_entries(shift_id);
create index if not exists time_entries_approved_by_idx on public.time_entries(approved_by);
create index if not exists time_entries_corrected_by_idx on public.time_entries(corrected_by);
create index if not exists time_entry_breaks_employee_id_idx on public.time_entry_breaks(employee_id);
create index if not exists time_entry_audit_actor_user_id_idx on public.time_entry_audit(actor_user_id);

drop policy if exists "staff can read profiles at their location" on public.profiles;
create policy "staff can read profiles at their location" on public.profiles
for select to authenticated
using (id=(select auth.uid()) or location_id=(select public.current_location_id()));

drop policy if exists "permissioned staff can view time entries" on public.time_entries;
create policy "permissioned staff can view time entries" on public.time_entries
for select to authenticated
using (
  location_id=(select public.current_location_id()) and (
    (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
    or (select public.has_permission('timeclock.manage'))
  )
);

drop policy if exists "permissioned staff can create time entries" on public.time_entries;
create policy "permissioned staff can create time entries" on public.time_entries
for insert to authenticated
with check (
  location_id=(select public.current_location_id()) and (
    (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
    or (select public.has_permission('timeclock.manage'))
  )
);

drop policy if exists "permissioned staff can update time entries" on public.time_entries;
create policy "permissioned staff can update time entries" on public.time_entries
for update to authenticated
using (
  location_id=(select public.current_location_id()) and (
    (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
    or (select public.has_permission('timeclock.manage'))
  )
)
with check (
  location_id=(select public.current_location_id()) and (
    (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
    or (select public.has_permission('timeclock.manage'))
  )
);

drop policy if exists "permissioned staff can view time entry breaks" on public.time_entry_breaks;
create policy "permissioned staff can view time entry breaks" on public.time_entry_breaks
for select to authenticated
using (
  (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
  or (
    (select public.has_permission('timeclock.manage')) and exists(
      select 1 from public.time_entries t
      where t.id=time_entry_breaks.time_entry_id
        and t.location_id=(select public.current_location_id())
    )
  )
);

drop policy if exists "permissioned staff can create own breaks" on public.time_entry_breaks;
create policy "permissioned staff can create own breaks" on public.time_entry_breaks
for insert to authenticated
with check (
  employee_id=(select auth.uid())
  and (select public.has_permission('timeclock.use'))
  and exists(
    select 1 from public.time_entries t
    where t.id=time_entry_breaks.time_entry_id
      and t.employee_id=(select auth.uid())
      and t.location_id=(select public.current_location_id())
      and t.clock_out is null
  )
);

drop policy if exists "permissioned staff can update time entry breaks" on public.time_entry_breaks;
create policy "permissioned staff can update time entry breaks" on public.time_entry_breaks
for update to authenticated
using (
  (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
  or (
    (select public.has_permission('timeclock.manage')) and exists(
      select 1 from public.time_entries t
      where t.id=time_entry_breaks.time_entry_id
        and t.location_id=(select public.current_location_id())
    )
  )
)
with check (
  (employee_id=(select auth.uid()) and (select public.has_permission('timeclock.use')))
  or (
    (select public.has_permission('timeclock.manage')) and exists(
      select 1 from public.time_entries t
      where t.id=time_entry_breaks.time_entry_id
        and t.location_id=(select public.current_location_id())
    )
  )
);
