-- Explicitly remove Supabase default table privileges from payment browser roles.
-- RLS does not protect TRUNCATE, so payment tables are least-privilege at the ACL layer too.
revoke all on table public.payment_provider_connections from public,anon,authenticated;
revoke all on table public.payment_checkout_sessions from public,anon,authenticated;
revoke all on table public.payment_transactions from public,anon,authenticated;
revoke all on table public.payment_provider_events from public,anon,authenticated;

grant select on table public.payment_provider_connections to authenticated;
grant select on table public.payment_checkout_sessions to authenticated;
grant select on table public.payment_transactions to authenticated;

-- Provider event payloads remain service-only; no browser SELECT is granted.
