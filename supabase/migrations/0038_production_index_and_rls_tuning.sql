-- Production audit tuning for newly added payment/workforce tables.
-- Cache auth/helper lookups once per statement in RLS and cover actor/reference FKs.

drop policy if exists "staff can view relevant availability" on public.staff_availability;
create policy "staff can view relevant availability"
on public.staff_availability for select to authenticated
using (
  location_id = (select public.current_location_id())
  and (
    employee_id = (select auth.uid())
    or (select coalesce(public.has_permission('schedule.manage'),false))
  )
);

drop policy if exists "staff can view relevant shift requests" on public.shift_change_requests;
create policy "staff can view relevant shift requests"
on public.shift_change_requests for select to authenticated
using (
  location_id = (select public.current_location_id())
  and (
    requester_id = (select auth.uid())
    or target_employee_id = (select auth.uid())
    or (select coalesce(public.has_permission('schedule.manage'),false))
  )
);

create index if not exists payment_requests_requested_by_idx
  on public.payment_requests(requested_by) where requested_by is not null;
create index if not exists payment_requests_verified_by_idx
  on public.payment_requests(verified_by) where verified_by is not null;
create index if not exists shift_change_requests_target_employee_idx
  on public.shift_change_requests(target_employee_id) where target_employee_id is not null;
create index if not exists shift_change_requests_target_shift_idx
  on public.shift_change_requests(target_shift_id) where target_shift_id is not null;
create index if not exists shift_change_requests_reviewed_by_idx
  on public.shift_change_requests(reviewed_by) where reviewed_by is not null;
