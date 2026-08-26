create table if not exists public.portal_sync_state (
  location_id uuid primary key references public.locations(id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.portal_sync_state enable row level security;

drop policy if exists portal_sync_state_staff_select on public.portal_sync_state;
create policy portal_sync_state_staff_select on public.portal_sync_state
for select to authenticated
using (location_id = public.current_location_id());

grant select on public.portal_sync_state to authenticated;

create or replace function public.bump_portal_sync_revision()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  loc uuid;
  row_customer uuid;
  row_ticket uuid;
  row_po uuid;
begin
  if tg_table_name = 'devices' then
    row_customer := coalesce(new.customer_id, old.customer_id);
    select c.location_id into loc from public.customers c where c.id = row_customer;
  elsif tg_table_name in ('work_order_items','ticket_events') then
    row_ticket := coalesce(new.ticket_id, old.ticket_id);
    select t.location_id into loc from public.repair_tickets t where t.id = row_ticket;
  elsif tg_table_name = 'purchase_order_items' then
    row_po := coalesce(new.purchase_order_id, old.purchase_order_id);
    select p.location_id into loc from public.purchase_orders p where p.id = row_po;
  else
    if tg_op = 'DELETE' then loc := old.location_id; else loc := new.location_id; end if;
  end if;

  if loc is not null then
    insert into public.portal_sync_state(location_id, revision, updated_at)
    values(loc, 1, now())
    on conflict(location_id) do update
      set revision = public.portal_sync_state.revision + 1,
          updated_at = now();
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.get_portal_sync_revision()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  loc uuid := public.current_location_id();
  rev bigint := 0;
  touched timestamptz;
begin
  if loc is null then raise exception 'Authenticated staff location required.'; end if;

  insert into public.portal_sync_state(location_id, revision, updated_at)
  values(loc, 0, now())
  on conflict(location_id) do nothing;

  select revision, updated_at into rev, touched
  from public.portal_sync_state
  where location_id = loc;

  return jsonb_build_object('location_id', loc, 'revision', coalesce(rev,0), 'updated_at', touched);
end;
$$;

grant execute on function public.get_portal_sync_revision() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'leads','repair_tickets','customers','intake_sessions','appointments',
    'inventory_items','purchase_orders','services','suppliers','promo_codes',
    'media_posts','business_settings','daily_sales_snapshots','daily_closeouts',
    'daily_sales_goal_overrides','receipts'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists gc_sync_revision_trg on public.%I', t);
      execute format('create trigger gc_sync_revision_trg after insert or update or delete on public.%I for each row execute function public.bump_portal_sync_revision()', t);
    end if;
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['devices','work_order_items','ticket_events','purchase_order_items'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists gc_sync_revision_trg on public.%I', t);
      execute format('create trigger gc_sync_revision_trg after insert or update or delete on public.%I for each row execute function public.bump_portal_sync_revision()', t);
    end if;
  end loop;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='portal_sync_state'
  ) then
    alter publication supabase_realtime add table public.portal_sync_state;
  end if;
exception when duplicate_object then null;
end $$;
