-- A signed JWT must still belong to an active, unexpired Auth session.
-- This helper exposes only the caller's boolean status, never Auth rows.
create or replace function public.portal_auth_session_active()
returns boolean language plpgsql stable security definer
set search_path = pg_catalog
as $function$
declare sid uuid;
begin
  if auth.uid() is null then return false; end if;
  begin sid := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if sid is null then return false; end if;
  return exists(select 1 from auth.sessions s
    where s.id=sid and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now()));
end;
$function$;
revoke all on function public.portal_auth_session_active() from public,anon;
grant execute on function public.portal_auth_session_active() to authenticated,service_role;

create or replace function public.portal_session_authorized()
returns boolean language sql stable security definer set search_path = pg_catalog
as $function$
  select public.portal_auth_session_active() and coalesce((
    select case
      when p.account_type='shared_workstation' then exists(
        select 1 from public.trusted_workstations tw
        where tw.workstation_profile_id=p.id and tw.location_id=p.location_id
          and tw.auth_session_id::text=auth.jwt()->>'session_id' and tw.revoked_at is null)
      when p.account_type='automation' then p.role='automation'::public.staff_role and exists(
        select 1 from auth.users u where u.id=p.id
          and u.raw_app_meta_data->>'portal_automation'='true')
      when coalesce(p.account_type,'staff')='staff' and p.role<>'automation'::public.staff_role then exists(
        select 1 from public.portal_human_sessions hs
        where hs.profile_id=p.id and hs.location_id=p.location_id
          and hs.auth_session_id::text=auth.jwt()->>'session_id'
          and (hs.verification_method='discord' or (hs.verification_method='owner_recovery' and p.role='owner'::public.staff_role)))
      else false end
    from public.profiles p where p.id=auth.uid() and p.active=true
  ),false)
$function$;
revoke all on function public.portal_session_authorized() from public,anon;
grant execute on function public.portal_session_authorized() to authenticated,service_role;

create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = pg_catalog
as $function$
  select public.portal_session_authorized() and coalesce((
    select case
      when p.account_type='shared_workstation' then (
        $1=any(array['dashboard.view','repairs.view','ready_pickup.view','leads.view','appointments.view',
          'customers.view','inventory.view','reference.view','labels.work_order'])
        or ($1=any(array['repairs.intake','ready_pickup.checkout','leads.manage','appointments.manage','customers.edit'])
          and exists(select 1 from public.profiles op
            left join public.staff_permission_overrides oo on oo.profile_id=op.id and oo.permission_key=$1
            where op.id=public.current_actor_profile_id() and op.active and op.account_type='staff'
              and case when op.role='owner' then true
                else coalesce(oo.enabled,public.role_default_permission(op.role,$1)) end)))
      -- Automation is a fixed capability ceiling; overrides cannot elevate it.
      when p.account_type='automation' or p.role='automation' then
        p.account_type='automation' and p.role='automation' and public.role_default_permission(p.role,$1)
        and coalesce(o.enabled,true)
      when p.role='owner' then true
      when p.role in ('technician','front_desk') and $1=any(array[
        'reports.view','staff.manage','settings.manage','pricing.override','schedule.manage']) then false
      else coalesce(o.enabled,public.role_default_permission(p.role,$1)) end
    from public.profiles p
    left join public.staff_permission_overrides o on o.profile_id=p.id and o.permission_key=$1
    where p.id=auth.uid() and p.active=true
  ),false)
$function$;
revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated,service_role;

-- The pricing helper reads inventory cost and blended staff compensation with
-- definer privileges. Its target UUID must not bypass the staff/location gate.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.calculate_part_repair_pricing(uuid,uuid,numeric)'::regprocedure);
  if position('Pricing access denied.' in definition)=0 then
    if position('if loc is null then' in definition)=0 then raise exception 'Unexpected pricing helper definition'; end if;
    definition:=replace(definition,'if loc is null then',
      'if auth.role() is distinct from ''service_role'' and (not public.portal_session_authorized() or loc is distinct from public.current_location_id() or not (public.has_permission(''repairs.intake'') or public.has_permission(''repairs.workflow''))) then raise exception ''Pricing access denied.''; end if; if loc is null then');
    execute definition;
  end if;
end;
$migration$;

-- Existing ownership/location policies still apply. These restrictive policies
-- additionally require completed Portal verification on previously missed tables.
do $migration$
declare target text;
begin
  foreach target in array array['portal_global_sync_state','portal_release_seen',
    'portal_release_settings','portal_releases','portal_user_preferences','rma_flow_labs_access']
  loop
    execute format('create policy verified_portal_session_required on public.%I as restrictive for all to authenticated using ((select public.portal_session_authorized())) with check ((select public.portal_session_authorized()))',target);
  end loop;
end;
$migration$;

alter table public.google_oauth_states add column auth_session_id uuid;
create function public.server_consume_google_oauth_state(p_state text)
returns setof public.google_oauth_states language sql security definer set search_path=pg_catalog
as $function$
  delete from public.google_oauth_states g
  where g.state=p_state and g.expires_at>now() and exists(
    select 1 from public.profiles p
    join auth.sessions s on s.user_id=p.id and s.id=g.auth_session_id
    join public.portal_human_sessions hs on hs.profile_id=p.id and hs.auth_session_id=s.id and hs.location_id=p.location_id
    left join public.staff_permission_overrides o on o.profile_id=p.id and o.permission_key='settings.manage'
    where p.id=g.requested_by and p.active and p.location_id=g.location_id
      and p.account_type='staff' and p.role in ('owner','manager')
      and (s.not_after is null or s.not_after>now())
      and (hs.verification_method='discord' or (hs.verification_method='owner_recovery' and p.role='owner'))
      and (p.role='owner' or coalesce(o.enabled,public.role_default_permission(p.role,'settings.manage')))
  ) returning g.*
$function$;
revoke all on function public.server_consume_google_oauth_state(text) from public,anon,authenticated;
grant execute on function public.server_consume_google_oauth_state(text) to service_role;

-- Preserve existing business logic while closing RPC entry points which only
-- checked auth.uid(). Bootstrap calls require a live Auth session; ordinary
-- calls require completed Portal verification.
do $migration$
declare entry record; definition text; guard text;
begin
  for entry in select * from (values
    ('decide_marlon_improvement_proposal(uuid,boolean)','portal_human_session'),
    ('decide_marlon_maintenance_override(uuid,boolean)','portal_human_session'),
    ('set_my_operator_pin(text)','portal_human_session'),
    ('get_my_operator_pin_status()','portal_session_authorized'),
    ('update_my_profile_badge(text,text,text)','portal_human_session'),
    ('update_my_staff_profile(text,text,text,text,text)','portal_human_session'),
    ('complete_initial_password_setup()','portal_session_authorized'),
    ('get_portal_global_sync_revision()','portal_session_authorized'),
    ('mark_portal_release_seen(uuid)','portal_session_authorized'),
    ('complete_workstation_enrollment(text,text,text)','portal_auth_session_active'),
    ('get_my_trusted_workstation_status()','portal_auth_session_active'),
    ('register_owner_recovery_session()','portal_auth_session_active'),
    ('touch_portal_human_session()','portal_session_authorized')
  ) as guards(signature,helper)
  loop
    definition:=pg_get_functiondef(('public.'||entry.signature)::regprocedure);
    guard:=format(E'begin\n  if not public.%I() then raise exception ''Verified session required.''; end if;',entry.helper);
    if position('Verified session required.' in definition)=0 then
      if definition !~ E'\\mbegin\\M' then raise exception 'Unexpected RPC definition: %',entry.signature; end if;
      execute regexp_replace(definition,E'\\mbegin\\M',guard);
    end if;
  end loop;
end;
$migration$;
