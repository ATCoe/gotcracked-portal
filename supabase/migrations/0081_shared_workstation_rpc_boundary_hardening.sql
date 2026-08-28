-- Shared counter computers only receive customer-facing workflow data.
-- Employee performance, support, Marlon memory/execution, and suggestions remain human-session-only.

create policy "management can view staff account events"
on public.staff_account_events for select to authenticated
using (public.portal_human_session() and location_id=public.current_location_id() and public.has_permission('staff.manage'));
grant select on public.staff_account_events to authenticated;

create or replace function public.create_support_ticket(
  p_title text,
  p_description text,
  p_category text default 'general',
  p_priority text default 'normal',
  p_source text default 'manual',
  p_surface text default 'portal',
  p_context jsonb default '{}'::jsonb
)
returns public.support_tickets
language plpgsql security definer set search_path to 'public'
as $function$
declare saved public.support_tickets;
begin
  if auth.uid() is null or not public.portal_human_session() then
    raise exception 'A human staff Portal session is required.';
  end if;
  insert into public.support_tickets(location_id,created_by,title,description,category,priority,source,surface,context)
  values(public.current_location_id(),auth.uid(),btrim(p_title),btrim(p_description),p_category,p_priority,p_source,p_surface,coalesce(p_context,'{}'::jsonb))
  returning * into saved;
  insert into public.support_ticket_events(ticket_id,actor_user_id,actor,event_type,message)
  values(saved.id,auth.uid(),'employee','created','Support request created.');
  return saved;
end;
$function$;

create or replace function public.submit_portal_suggestion(
  p_title text,
  p_description text,
  p_surface text default 'portal',
  p_category text default 'improvement',
  p_suggestion_type text default 'standard'
)
returns public.portal_suggestions
language plpgsql security definer set search_path to 'public'
as $function$
declare saved public.portal_suggestions;
begin
  if auth.uid() is null or not public.portal_human_session() then
    raise exception 'A human staff Portal session is required.';
  end if;
  if p_surface not in ('portal','website','both') then raise exception 'Invalid surface.'; end if;
  if p_suggestion_type not in ('standard','workflow_improvement','premium_feature','reliability','patch_candidate') then raise exception 'Invalid suggestion type.'; end if;
  insert into public.portal_suggestions(location_id,submitted_by,source,surface,title,description,category,suggestion_type,owner_review_required)
  values(public.current_location_id(),auth.uid(),'employee',p_surface,btrim(p_title),btrim(p_description),coalesce(nullif(btrim(p_category),''),'improvement'),p_suggestion_type,p_suggestion_type='premium_feature')
  returning * into saved;
  return saved;
end;
$function$;

create or replace function public.get_marlon_execution_capabilities()
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select case when public.portal_human_session() then
    coalesce(jsonb_object_agg(capability,jsonb_build_object(
      'status',status,'executor',executor,'reason',reason,
      'last_verified_at',last_verified_at,'metadata',metadata
    ) order by capability),'{}'::jsonb)
  else '{}'::jsonb end
  from public.marlon_execution_capabilities
  where location_id=public.current_location_id();
$function$;

create or replace function public.marlon_memory_context(p_limit integer default 24)
returns table(scope text,category text,summary text,confidence numeric,evidence_count integer,last_reinforced_at timestamptz)
language sql security definer set search_path to 'public'
as $function$
  select m.scope,m.category,m.summary,m.confidence,m.evidence_count,m.last_reinforced_at
  from public.marlon_memories m
  where public.portal_human_session()
    and m.location_id=public.current_location_id()
    and m.status='active'
    and (m.scope in ('team','system') or (m.scope='profile' and m.profile_id=auth.uid()))
  order by case m.scope when 'system' then 0 when 'profile' then 1 else 2 end,
           m.confidence desc,m.evidence_count desc,m.last_reinforced_at desc
  limit greatest(1,least(coalesce(p_limit,24),60));
$function$;

-- Preserve the employee-recognition API for human Portal sessions while refusing it to shared workstations.
do $guard$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_employee_recognition'
    and pg_get_function_identity_arguments(p.oid)='p_days integer';
  if definition is null then raise exception 'get_employee_recognition(integer) not found'; end if;
  if position('Recognition requires a human staff session.' in definition)=0 then
    definition:=replace(
      definition,
      E'begin\n  if loc is null then',
      E'begin\n  if not public.portal_human_session() then raise exception ''Recognition requires a human staff session.''; end if;\n  if loc is null then'
    );
    execute definition;
  end if;
end $guard$;
grant execute on function public.get_employee_recognition(integer) to authenticated;
