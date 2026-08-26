-- GotCracked directory last-update index and managed staff avatars
-- Mirrors the production migration applied 2026-08-26.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('staff-avatars','staff-avatars',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "staff avatar store select" on storage.objects;
create policy "staff avatar store select" on storage.objects
for select to authenticated
using (
  bucket_id='staff-avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or (
      public.has_permission('staff.manage') and exists(
        select 1 from public.profiles p
        where p.id::text=(storage.foldername(objects.name))[1]
          and p.location_id=public.current_location_id()
      )
    )
  )
);

drop policy if exists "staff avatar store insert" on storage.objects;
create policy "staff avatar store insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='staff-avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or (
      public.has_permission('staff.manage') and exists(
        select 1 from public.profiles p
        where p.id::text=(storage.foldername(objects.name))[1]
          and p.location_id=public.current_location_id()
      )
    )
  )
);

drop policy if exists "staff avatar store update" on storage.objects;
create policy "staff avatar store update" on storage.objects
for update to authenticated
using (
  bucket_id='staff-avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or (
      public.has_permission('staff.manage') and exists(
        select 1 from public.profiles p
        where p.id::text=(storage.foldername(objects.name))[1]
          and p.location_id=public.current_location_id()
      )
    )
  )
)
with check (
  bucket_id='staff-avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or (
      public.has_permission('staff.manage') and exists(
        select 1 from public.profiles p
        where p.id::text=(storage.foldername(objects.name))[1]
          and p.location_id=public.current_location_id()
      )
    )
  )
);

drop policy if exists "staff avatar store delete" on storage.objects;
create policy "staff avatar store delete" on storage.objects
for delete to authenticated
using (
  bucket_id='staff-avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or (
      public.has_permission('staff.manage') and exists(
        select 1 from public.profiles p
        where p.id::text=(storage.foldername(objects.name))[1]
          and p.location_id=public.current_location_id()
      )
    )
  )
);

create or replace function public.get_directory_last_updates()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  loc uuid:=public.current_location_id();
  can_repairs boolean:=coalesce(public.has_permission('repairs.view'),false) or coalesce(public.has_permission('dashboard.view'),false);
  can_leads boolean:=coalesce(public.has_permission('leads.view'),false) or coalesce(public.has_permission('dashboard.view'),false);
  repairs jsonb:='[]'::jsonb;
  leads jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or loc is null then raise exception 'Active staff access is required.'; end if;

  if can_repairs then
    select coalesce(jsonb_agg(jsonb_build_object(
      'type','work_order',
      'id',t.id,
      'last_updated',greatest(
        coalesce(t.updated_at,t.created_at),
        coalesce((select max(e.created_at) from public.ticket_events e where e.ticket_id=t.id),'-infinity'::timestamptz)
      )
    )),'[]'::jsonb)
    into repairs
    from public.repair_tickets t
    where t.location_id=loc;
  end if;

  if can_leads then
    select coalesce(jsonb_agg(jsonb_build_object(
      'type','lead',
      'id',l.id,
      'last_updated',greatest(
        coalesce(l.updated_at,l.created_at),
        coalesce((select max(e.created_at) from public.lead_events e where e.lead_id=l.id),'-infinity'::timestamptz)
      )
    )),'[]'::jsonb)
    into leads
    from public.leads l
    where l.location_id=loc;
  end if;

  return repairs || leads;
end; $$;

revoke all on function public.get_directory_last_updates() from public;
grant execute on function public.get_directory_last_updates() to authenticated;
