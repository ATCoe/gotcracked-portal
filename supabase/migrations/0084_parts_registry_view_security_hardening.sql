-- Harden the read-only parts registry projection so caller permissions and RLS apply.
-- The view is intentionally available only as a SELECT surface to authenticated Portal users
-- and trusted server-side service operations.

alter view public.parts_registry_latest_source
  set (security_invoker = true);

revoke all on public.parts_registry_latest_source from anon;
revoke all on public.parts_registry_latest_source from authenticated;
grant select on public.parts_registry_latest_source to authenticated;

revoke all on public.parts_registry_latest_source from service_role;
grant select on public.parts_registry_latest_source to service_role;
