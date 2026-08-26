create table if not exists public.portal_user_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portal_user_preferences enable row level security;

drop policy if exists portal_user_preferences_select_own on public.portal_user_preferences;
create policy portal_user_preferences_select_own on public.portal_user_preferences
for select to authenticated
using ((select auth.uid()) = profile_id);

drop policy if exists portal_user_preferences_insert_own on public.portal_user_preferences;
create policy portal_user_preferences_insert_own on public.portal_user_preferences
for insert to authenticated
with check ((select auth.uid()) = profile_id);

drop policy if exists portal_user_preferences_update_own on public.portal_user_preferences;
create policy portal_user_preferences_update_own on public.portal_user_preferences
for update to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

drop policy if exists portal_user_preferences_delete_own on public.portal_user_preferences;
create policy portal_user_preferences_delete_own on public.portal_user_preferences
for delete to authenticated
using ((select auth.uid()) = profile_id);

grant select, insert, update, delete on public.portal_user_preferences to authenticated;
revoke all on public.portal_user_preferences from anon;

create or replace function public.set_my_portal_preference(pref_key text, pref_value jsonb)
returns jsonb
language plpgsql
security invoker
set search_path='public'
as $$
declare
  merged jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if pref_key is null or btrim(pref_key) = '' then
    raise exception 'Preference key is required.';
  end if;

  insert into public.portal_user_preferences(profile_id, preferences, updated_at)
  values(auth.uid(), jsonb_build_object(pref_key, coalesce(pref_value, 'null'::jsonb)), now())
  on conflict(profile_id) do update
    set preferences = coalesce(public.portal_user_preferences.preferences, '{}'::jsonb)
                    || jsonb_build_object(pref_key, coalesce(pref_value, 'null'::jsonb)),
        updated_at = now()
  returning preferences into merged;

  return merged;
end;
$$;

revoke all on function public.set_my_portal_preference(text,jsonb) from public, anon;
grant execute on function public.set_my_portal_preference(text,jsonb) to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='portal_user_preferences'
  ) then
    alter publication supabase_realtime add table public.portal_user_preferences;
  end if;
exception when duplicate_object then null;
end $$;

create or replace function public.bump_portal_sync_revision()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  loc uuid;
  payload jsonb;
  ref_id uuid;
begin
  payload := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if payload ? 'location_id' then
    begin
      loc := nullif(payload->>'location_id','')::uuid;
    exception when invalid_text_representation then
      loc := null;
    end;
  end if;

  if loc is null then
    case tg_table_name
      when 'devices' then
        ref_id := nullif(payload->>'customer_id','')::uuid;
        select c.location_id into loc from public.customers c where c.id=ref_id;
      when 'work_order_items' then
        ref_id := nullif(payload->>'ticket_id','')::uuid;
        select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'ticket_events' then
        ref_id := nullif(payload->>'ticket_id','')::uuid;
        select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'work_order_item_events' then
        ref_id := nullif(payload->>'ticket_id','')::uuid;
        select t.location_id into loc from public.repair_tickets t where t.id=ref_id;
      when 'purchase_order_items' then
        ref_id := nullif(payload->>'purchase_order_id','')::uuid;
        select p.location_id into loc from public.purchase_orders p where p.id=ref_id;
      when 'time_entry_breaks' then
        ref_id := nullif(payload->>'time_entry_id','')::uuid;
        select e.location_id into loc from public.time_entries e where e.id=ref_id;
      when 'inventory_audit_items' then
        ref_id := nullif(payload->>'audit_id','')::uuid;
        select a.location_id into loc from public.inventory_audits a where a.id=ref_id;
      when 'staff_permission_overrides' then
        ref_id := nullif(payload->>'profile_id','')::uuid;
        select p.location_id into loc from public.profiles p where p.id=ref_id;
      when 'receipt_deliveries' then
        ref_id := nullif(payload->>'receipt_id','')::uuid;
        select r.location_id into loc from public.receipts r where r.id=ref_id;
      when 'lead_events' then
        ref_id := nullif(payload->>'lead_id','')::uuid;
        select l.location_id into loc from public.leads l where l.id=ref_id;
      when 'repair_suggestion_rules' then
        ref_id := nullif(payload->>'guide_id','')::uuid;
        select g.location_id into loc from public.repair_guides g where g.id=ref_id;
      else
        loc := null;
    end case;
  end if;

  if loc is not null then
    insert into public.portal_sync_state(location_id, revision, updated_at)
    values(loc,1,now())
    on conflict(location_id) do update
      set revision=public.portal_sync_state.revision+1,
          updated_at=now();
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_portal_sync_revision() from public, anon, authenticated;

do $$
declare
  t text;
begin
  for t in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema=c.table_schema and tb.table_name=c.table_name
    where c.table_schema='public'
      and c.column_name='location_id'
      and tb.table_type='BASE TABLE'
      and c.table_name not in (
        'portal_sync_state','portal_user_preferences','discord_notification_outbox',
        'training_store_state','time_entry_audit'
      )
  loop
    execute format('drop trigger if exists gc_sync_revision_trg on public.%I',t);
    execute format('create trigger gc_sync_revision_trg after insert or update or delete on public.%I for each row execute function public.bump_portal_sync_revision()',t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'devices','work_order_items','ticket_events','work_order_item_events',
    'purchase_order_items','time_entry_breaks','inventory_audit_items',
    'staff_permission_overrides','receipt_deliveries','lead_events','repair_suggestion_rules'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists gc_sync_revision_trg on public.%I',t);
      execute format('create trigger gc_sync_revision_trg after insert or update or delete on public.%I for each row execute function public.bump_portal_sync_revision()',t);
    end if;
  end loop;
end $$;
