revoke all on function public.decide_marlon_high_level_change(uuid,boolean) from public, anon;
grant execute on function public.decide_marlon_high_level_change(uuid,boolean) to authenticated;

revoke all on function public.decide_marlon_ui_update(uuid,boolean) from public, anon;
grant execute on function public.decide_marlon_ui_update(uuid,boolean) to authenticated;

revoke all on function public.decide_marlon_change_approval(uuid,boolean) from public, anon;
grant execute on function public.decide_marlon_change_approval(uuid,boolean) to authenticated;
