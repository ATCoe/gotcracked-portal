drop function if exists public.create_ui_update_request(text,text,text,text,jsonb);

revoke execute on function public.enforce_marlon_ui_approval_gate() from public, anon, authenticated;
revoke execute on function public.marlon_ui_execution_allowed(uuid) from public, anon;
revoke execute on function public.decide_marlon_ui_update(uuid,boolean) from public, anon;
