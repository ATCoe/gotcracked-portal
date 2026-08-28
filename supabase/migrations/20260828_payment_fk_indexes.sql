-- Cover payment foreign keys used by webhook reconciliation and support diagnostics.
create index if not exists payment_provider_connections_updated_by_idx on public.payment_provider_connections(updated_by) where updated_by is not null;
create index if not exists payment_checkout_provider_connection_idx on public.payment_checkout_sessions(provider_connection_id) where provider_connection_id is not null;
create index if not exists payment_transactions_location_idx on public.payment_transactions(location_id,occurred_at desc);
create index if not exists payment_transactions_checkout_idx on public.payment_transactions(checkout_session_id,occurred_at desc) where checkout_session_id is not null;
create index if not exists payment_provider_events_location_idx on public.payment_provider_events(location_id,received_at desc) where location_id is not null;
create index if not exists payment_provider_events_request_idx on public.payment_provider_events(payment_request_id,received_at desc) where payment_request_id is not null;
create index if not exists payment_provider_events_checkout_idx on public.payment_provider_events(checkout_session_id,received_at desc) where checkout_session_id is not null;
