-- Trigger helpers are internal database plumbing and must never be exposed as RPCs.
revoke all on function public.guard_new_work_order_prepayment() from public, anon, authenticated;
revoke all on function public.link_payment_request_to_ticket() from public, anon, authenticated;
