-- Restrict internal trigger/session helpers from anonymous RPC execution.
-- Trigger functions do not need direct API EXECUTE grants.

revoke all on function public.assign_single_store_profile_location() from public;
revoke all on function public.bump_portal_sync_revision() from public;

revoke all on function public.get_portal_sync_revision() from public;
revoke all on function public.get_training_store_state() from public;
revoke all on function public.save_training_store_state(jsonb) from public;

grant execute on function public.get_portal_sync_revision() to authenticated;
grant execute on function public.get_training_store_state() to authenticated;
grant execute on function public.save_training_store_state(jsonb) to authenticated;
