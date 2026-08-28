create or replace function public.ensure_marlon_chat_ticket(
  p_title text,
  p_description text,
  p_surface text default 'portal',
  p_category text default 'general',
  p_fingerprint text default null,
  p_source text default 'marlon_chat',
  p_context jsonb default '{}'::jsonb
)
returns public.support_tickets
language plpgsql
security definer
set search_path=public
as $$
declare
  saved public.support_tickets;
  v_fingerprint text := nullif(btrim(coalesce(p_fingerprint,'')),'');
  v_surface text := case when p_surface in ('portal','website','repository','discord','cloudflare') then p_surface else 'portal' end;
  v_category text := case when p_category in ('general','portal_ui','website_ui','ui_update','account','workflow','deployment','data','other') then p_category else 'general' end;
  v_source text := case when p_source in ('marlon_chat','marlon_call') then p_source else 'marlon_chat' end;
  v_text text := lower(coalesce(p_title,'')||' '||coalesce(p_description,''));
  v_priority text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;

  v_priority := case
    when v_text ~ '\m(outage|down|unavailable|security incident|data loss|payment failure|checkout failure|production broken|cannot log in|can''t log in)\M' then 'critical'
    when v_text ~ '\m(urgent|high priority|blocks work|blocking|broken for everyone|systemwide)\M' then 'high'
    when v_text ~ '\m(minor|cosmetic|low priority)\M' then 'low'
    else 'normal'
  end;

  if v_fingerprint is not null then
    select t.* into saved
    from public.support_tickets t
    where t.location_id=public.current_location_id()
      and t.source=v_source
      and t.context->>'chat_fingerprint'=v_fingerprint
      and t.status not in ('resolved','closed')
    order by t.created_at desc
    limit 1;
    if saved.id is not null then return saved; end if;
  end if;

  insert into public.support_tickets(
    location_id,created_by,title,description,category,priority,status,source,surface,managed_by,context
  ) values (
    public.current_location_id(),auth.uid(),left(btrim(p_title),180),left(btrim(p_description),5000),v_category,v_priority,'open',v_source,v_surface,'Marlon',
    coalesce(p_context,'{}'::jsonb) || jsonb_build_object('chat_fingerprint',v_fingerprint,'tracked_by','marlon_chat_action_guard','priority_inferred',true)
  ) returning * into saved;

  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'employee','created','Actionable Marlon request logged from chat with inferred priority.');
  return saved;
end;
$$;
