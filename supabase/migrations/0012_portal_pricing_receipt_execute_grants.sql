-- Preserve the staff-only boundary for pricing and receipt RPCs.
revoke execute on function public.calculate_part_repair_pricing(uuid,uuid,numeric) from public, anon;
revoke execute on function public.finalize_external_pos_sale(uuid,text,text,integer) from public, anon;
revoke execute on function public.record_receipt_print(uuid) from public, anon;
revoke execute on function public.sync_part_pricing_companion() from public, anon, authenticated;

grant execute on function public.calculate_part_repair_pricing(uuid,uuid,numeric) to authenticated;
grant execute on function public.finalize_external_pos_sale(uuid,text,text,integer) to authenticated;
grant execute on function public.record_receipt_print(uuid) to authenticated;

