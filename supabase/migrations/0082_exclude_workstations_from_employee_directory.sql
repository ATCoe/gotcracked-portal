-- Shared workstations are device identities, not employees. Human employee-directory queries
-- should never render them as staff; management uses the dedicated trusted-workstation RPCs.
drop policy if exists "staff can read profiles at their location" on public.profiles;
create policy "staff can read profiles at their location"
on public.profiles for select to authenticated
using (
  id=auth.uid()
  or (
    public.portal_human_session()
    and location_id=public.current_location_id()
    and coalesce(account_type,'staff')='staff'
  )
);
