create table if not exists public.portal_global_sync_state (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.portal_global_sync_state enable row level security;
drop policy if exists portal_global_sync_state_staff_select on public.portal_global_sync_state;
create policy portal_global_sync_state_staff_select on public.portal_global_sync_state for select to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.active=true));
grant select on public.portal_global_sync_state to authenticated;
insert into public.portal_global_sync_state(id) values(true) on conflict(id) do nothing;

create or replace function public.bump_portal_sync_revision()
returns trigger language plpgsql security definer set search_path='public' as $$
declare payload jsonb; loc uuid; ref_id uuid;
begin
  payload:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if payload ? 'location_id' then begin loc:=nullif(payload->>'location_id','')::uuid; exception when invalid_text_representation then loc:=null; end; end if;
  if loc is null then
    case tg_table_name
      when 'devices' then ref_id:=nullif(payload->>'customer_id','')::uuid; select c.location_id into loc from public.customers c where c.id=ref_id;
      when 'work_order_items' then ref_id:=nullif(payload->>'ticket_id','')::uuid; select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'ticket_events' then ref_id:=nullif(payload->>'ticket_id','')::uuid; select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'work_order_item_events' then ref_id:=nullif(payload->>'ticket_id','')::uuid; select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'purchase_order_items' then ref_id:=nullif(payload->>'purchase_order_id','')::uuid; select p.location_id into loc from public.purchase_orders p where p.id=ref_id;
      when 'time_entry_breaks' then ref_id:=nullif(payload->>'time_entry_id','')::uuid; select e.location_id into loc from public.time_entries e where e.id=ref_id;
      when 'inventory_audit_items' then ref_id:=nullif(payload->>'audit_id','')::uuid; select a.location_id into loc from public.inventory_audits a where a.id=ref_id;
      when 'staff_permission_overrides' then ref_id:=nullif(payload->>'profile_id','')::uuid; select p.location_id into loc from public.profiles p where p.id=ref_id;
      when 'receipt_deliveries' then ref_id:=nullif(payload->>'receipt_id','')::uuid; select r.location_id into loc from public.receipts r where r.id=ref_id;
      when 'lead_events' then ref_id:=nullif(payload->>'lead_id','')::uuid; select l.location_id into loc from public.leads l where l.id=ref_id;
      when 'repair_suggestion_rules' then ref_id:=nullif(payload->>'guide_id','')::uuid; select g.location_id into loc from public.repair_guides g where g.id=ref_id;
      else loc:=null;
    end case;
  end if;
  if tg_table_name in ('customers','devices','inventory_items') then
    insert into public.portal_global_sync_state(id,revision,updated_at) values(true,1,now()) on conflict(id) do update set revision=public.portal_global_sync_state.revision+1,updated_at=now();
  end if;
  if loc is not null then
    insert into public.portal_sync_state(location_id,revision,updated_at) values(loc,1,now()) on conflict(location_id) do update set revision=public.portal_sync_state.revision+1,updated_at=now();
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.bump_portal_sync_revision() from public,anon,authenticated;

create or replace function public.get_portal_global_sync_revision()
returns jsonb language plpgsql security definer set search_path='public' as $$
declare rev bigint; touched timestamptz;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true) then raise exception 'Authentication required.'; end if;
  select revision,updated_at into rev,touched from public.portal_global_sync_state where id=true;
  return jsonb_build_object('revision',coalesce(rev,0),'updated_at',touched);
end; $$;
revoke all on function public.get_portal_global_sync_revision() from public,anon;
grant execute on function public.get_portal_global_sync_revision() to authenticated;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='portal_global_sync_state') then alter publication supabase_realtime add table public.portal_global_sync_state; end if;
exception when duplicate_object then null; end $$;

