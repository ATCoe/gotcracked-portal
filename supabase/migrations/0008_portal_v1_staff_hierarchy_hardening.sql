-- GotCracked Portal 1.0 final staff/profile authorization hardening.
-- Keeps staff visibility location-scoped and makes staff.manage authoritative
-- without allowing a lower hierarchy level to edit peers or higher roles.

-- Profiles/locations ---------------------------------------------------------
drop policy if exists "Authenticated users can read profiles" on public.profiles;
drop policy if exists "staff can read their profile" on public.profiles;
create policy "staff can read profiles at their location"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or location_id = public.current_location_id()
  );

drop policy if exists "Authenticated users can read locations" on public.locations;
create policy "staff can read their location"
  on public.locations for select to authenticated
  using (id = public.current_location_id());

-- Staff permission overrides -------------------------------------------------
drop policy if exists "management can delete permission overrides" on public.staff_permission_overrides;
drop policy if exists "management can insert permission overrides" on public.staff_permission_overrides;
drop policy if exists "management can update permission overrides" on public.staff_permission_overrides;
drop policy if exists "staff can read own or managed permission overrides" on public.staff_permission_overrides;

create policy "staff can read own or managed permission overrides"
  on public.staff_permission_overrides for select to authenticated
  using (
    profile_id = auth.uid()
    or (
      public.current_staff_role() in ('owner','manager')
      and public.has_permission('staff.manage')
      and exists (
        select 1 from public.profiles target
        where target.id = profile_id
          and target.location_id = public.current_location_id()
      )
    )
  );

create policy "management can insert permission overrides"
  on public.staff_permission_overrides for insert to authenticated
  with check (
    public.current_staff_role() in ('owner','manager')
    and public.has_permission('staff.manage')
    and exists (
      select 1 from public.profiles target
      where target.id = profile_id
        and target.location_id = public.current_location_id()
        and target.role <> 'owner'
        and (
          public.current_staff_role() = 'owner'
          or target.role not in ('owner','manager')
        )
    )
  );

create policy "management can update permission overrides"
  on public.staff_permission_overrides for update to authenticated
  using (
    public.current_staff_role() in ('owner','manager')
    and public.has_permission('staff.manage')
    and exists (
      select 1 from public.profiles target
      where target.id = profile_id
        and target.location_id = public.current_location_id()
        and target.role <> 'owner'
        and (
          public.current_staff_role() = 'owner'
          or target.role not in ('owner','manager')
        )
    )
  )
  with check (
    public.current_staff_role() in ('owner','manager')
    and public.has_permission('staff.manage')
    and exists (
      select 1 from public.profiles target
      where target.id = profile_id
        and target.location_id = public.current_location_id()
        and target.role <> 'owner'
        and (
          public.current_staff_role() = 'owner'
          or target.role not in ('owner','manager')
        )
    )
  );

create policy "management can delete permission overrides"
  on public.staff_permission_overrides for delete to authenticated
  using (
    public.current_staff_role() in ('owner','manager')
    and public.has_permission('staff.manage')
    and exists (
      select 1 from public.profiles target
      where target.id = profile_id
        and target.location_id = public.current_location_id()
        and target.role <> 'owner'
        and (
          public.current_staff_role() = 'owner'
          or target.role not in ('owner','manager')
        )
    )
  );

-- RPCs mirror the same hierarchy. -------------------------------------------
create or replace function public.set_staff_permission_override(
  target_profile uuid,
  target_permission text,
  target_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  select * into target from public.profiles where id=target_profile and active=true;
  if actor.id is null
     or actor.role not in ('owner','manager')
     or not coalesce(public.has_permission('staff.manage'),false) then
    raise exception 'You do not have permission to manage staff permissions.';
  end if;
  if target.id is null or target.location_id is distinct from actor.location_id then
    raise exception 'Staff profile not found.';
  end if;
  if not exists(select 1 from public.permission_definitions where permission_key=target_permission) then
    raise exception 'Unknown permission.';
  end if;
  if target.role='owner' then raise exception 'Owner permissions are fixed at full access.'; end if;
  if actor.role='manager' and target.role in ('owner','manager') then
    raise exception 'Managers cannot change owner or manager permissions.';
  end if;
  insert into public.staff_permission_overrides(profile_id,permission_key,enabled,updated_by,updated_at)
  values(target_profile,target_permission,target_enabled,auth.uid(),now())
  on conflict(profile_id,permission_key) do update
    set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end; $$;

create or replace function public.clear_staff_permission_override(
  target_profile uuid,
  target_permission text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and active=true;
  select * into target from public.profiles where id=target_profile and active=true;
  if actor.id is null
     or actor.role not in ('owner','manager')
     or not coalesce(public.has_permission('staff.manage'),false) then
    raise exception 'You do not have permission to manage staff permissions.';
  end if;
  if target.id is null or target.location_id is distinct from actor.location_id then
    raise exception 'Staff profile not found.';
  end if;
  if target.role='owner' then raise exception 'Owner permissions are fixed at full access.'; end if;
  if actor.role='manager' and target.role in ('owner','manager') then
    raise exception 'Managers cannot change owner or manager permissions.';
  end if;
  delete from public.staff_permission_overrides
  where profile_id=target_profile and permission_key=target_permission;
end; $$;

revoke execute on function public.set_staff_permission_override(uuid,text,boolean) from public,anon;
revoke execute on function public.clear_staff_permission_override(uuid,text) from public,anon;
grant execute on function public.set_staff_permission_override(uuid,text,boolean) to authenticated;
grant execute on function public.clear_staff_permission_override(uuid,text) to authenticated;
