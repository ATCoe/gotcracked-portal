create or replace function public.decide_marlon_ui_update(p_ticket uuid,p_approve boolean)
returns public.support_tickets
language sql
security definer
set search_path to 'public'
as $$
  select public.decide_marlon_change_approval(p_ticket,p_approve);
$$;

revoke all on function public.decide_marlon_ui_update(uuid,boolean) from public;
grant execute on function public.decide_marlon_ui_update(uuid,boolean) to authenticated;
