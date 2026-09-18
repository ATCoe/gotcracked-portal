alter table public.services add column if not exists device_category text;
alter table public.services add column if not exists manufacturer text;
alter table public.services add column if not exists model_family text;
alter table public.services add column if not exists estimated_minutes integer;
alter table public.services add column if not exists minimum_price_cents integer not null default 0;
alter table public.services add column if not exists price_source text not null default 'manual';
alter table public.services add column if not exists last_price_review_at timestamptz;
alter table public.services add column if not exists pricing_notes text;

alter table public.services drop constraint if exists services_estimated_minutes_check;
alter table public.services add constraint services_estimated_minutes_check
check (estimated_minutes is null or estimated_minutes between 1 and 1440);
alter table public.services drop constraint if exists services_minimum_price_cents_check;
alter table public.services add constraint services_minimum_price_cents_check
check (minimum_price_cents >= 0);
alter table public.services drop constraint if exists services_price_source_check;
alter table public.services add constraint services_price_source_check
check (price_source in ('manual','cost_plus','marlon_market_guided'));

create table if not exists public.service_inventory_links (
  service_id uuid not null references public.services(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete cascade,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_id, inventory_item_id)
);
create table if not exists public.service_price_research (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  researched_by text not null default 'marlon' check (researched_by in ('marlon','staff')),
  observed_at timestamptz not null default now(),
  recommended_price_cents integer not null check (recommended_price_cents >= 0),
  range_low_cents integer check (range_low_cents is null or range_low_cents >= 0),
  range_high_cents integer check (range_high_cents is null or range_high_cents >= 0),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  rationale text not null,
  market_snapshot jsonb not null default '{}'::jsonb,
  cost_snapshot jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint service_price_research_range_check check (
    range_low_cents is null or range_high_cents is null or range_high_cents >= range_low_cents
  )
);

create index if not exists service_inventory_links_inventory_idx
on public.service_inventory_links(inventory_item_id);
create index if not exists service_price_research_service_observed_idx
on public.service_price_research(service_id, observed_at desc);
create index if not exists service_price_research_location_observed_idx
on public.service_price_research(location_id, observed_at desc);
create or replace function public.enforce_service_inventory_link_location()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  service_location uuid;
  part_location uuid;
begin
  select location_id into service_location from public.services where id=new.service_id;
  select location_id into part_location from public.inventory_items where id=new.inventory_item_id;
  if service_location is null or part_location is null then raise exception 'Service or inventory item not found.'; end if;
  if service_location <> part_location then raise exception 'Service and inventory item must belong to the same location.'; end if;
  new.location_id := service_location;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_service_inventory_link_location on public.service_inventory_links;
create trigger trg_service_inventory_link_location
before insert or update on public.service_inventory_links
for each row execute function public.enforce_service_inventory_link_location();

alter table public.service_inventory_links enable row level security;
alter table public.service_price_research enable row level security;

drop policy if exists "staff view price book part links" on public.service_inventory_links;
create policy "staff view price book part links" on public.service_inventory_links
for select to authenticated using (
  location_id=public.current_location_id() and
  (public.has_permission('repairs.view') or public.has_permission('inventory.view'))
);
drop policy if exists "management manage price book part links" on public.service_inventory_links;
create policy "management manage price book part links" on public.service_inventory_links
for all to authenticated using (
  location_id=public.current_location_id() and public.has_permission('inventory.manage')
) with check (
  location_id=public.current_location_id() and public.has_permission('inventory.manage')
);

drop policy if exists "staff view Marlon price research" on public.service_price_research;
create policy "staff view Marlon price research" on public.service_price_research
for select to authenticated using (
  location_id=public.current_location_id() and
  (public.has_permission('repairs.view') or public.has_permission('inventory.view'))
);

revoke all on public.service_inventory_links from anon;
revoke all on public.service_price_research from anon;
grant select,insert,update,delete on public.service_inventory_links to authenticated;
grant select on public.service_price_research to authenticated;
grant all on public.service_inventory_links to service_role;
grant all on public.service_price_research to service_role;

create or replace view public.price_book_catalog
with (security_invoker=true)
as
select
  s.*,
  research.id as price_research_id,
  research.recommended_price_cents,
  research.range_low_cents,
  research.range_high_cents,
  research.confidence as research_confidence,
  research.rationale as marlon_rationale,
  research.observed_at as marlon_researched_at,
  research.market_snapshot,
  research.cost_snapshot,
  research.sources as research_sources,
  coalesce(parts.items,'[]'::jsonb) as linked_parts
from public.services s
left join lateral (
  select r.* from public.service_price_research r
  where r.service_id=s.id
  order by r.observed_at desc, r.created_at desc
  limit 1
) research on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'inventory_item_id',i.id,
      'sku',i.sku,
      'name',i.name,
      'quantity',l.quantity,
      'is_primary',l.is_primary,
      'unit_cost_cents',i.cost_cents,
      'quantity_on_hand',i.quantity_on_hand
    ) order by l.is_primary desc,i.name
  ) as items
  from public.service_inventory_links l
  join public.inventory_items i on i.id=l.inventory_item_id
  where l.service_id=s.id
) parts on true;

grant select on public.price_book_catalog to authenticated;

create or replace function public.apply_service_price_recommendation(
  p_research_id uuid,
  p_price_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  row_research public.service_price_research%rowtype;
  row_service public.services%rowtype;
  settings public.business_settings%rowtype;
  chosen_price integer;
  linked_part_cost_cents integer := 0;
  direct_cost_cents integer := 0;
  margin_floor_cents integer := 0;
  required_floor_cents integer := 0;
begin
  if auth.uid() is null
     or not coalesce(public.has_permission('inventory.manage'),false)
     or not coalesce(public.has_permission('pricing.override'),false) then
    raise exception 'Inventory Manage and Pricing Override permissions are required to change Price Book pricing.';
  end if;

  select * into row_research from public.service_price_research
  where id=p_research_id and location_id=public.current_location_id();
  if not found then raise exception 'Pricing research record not found.'; end if;

  select * into row_service from public.services
  where id=row_research.service_id and location_id=public.current_location_id()
  for update;
  if not found then raise exception 'Price Book service not found.'; end if;

  select * into settings from public.business_settings where location_id=row_service.location_id;
  if settings.location_id is null then raise exception 'Business settings not found.'; end if;

  select coalesce(ceil(sum(i.cost_cents*l.quantity)),0)::integer into linked_part_cost_cents
  from public.service_inventory_links l
  join public.inventory_items i on i.id=l.inventory_item_id
  where l.service_id=row_service.id;

  direct_cost_cents := greatest(0,coalesce(row_service.cost_cents,0)+linked_part_cost_cents);
  margin_floor_cents := case
    when direct_cost_cents<=0 then 0
    else ceil(direct_cost_cents/greatest(0.06,1-(least(94,greatest(0,coalesce(settings.target_gross_margin_percent,50)))/100.0)))::integer
  end;
  required_floor_cents := greatest(0,row_service.minimum_price_cents,margin_floor_cents);
  chosen_price := coalesce(p_price_cents,row_research.recommended_price_cents);

  if chosen_price < required_floor_cents then
    raise exception 'Selected price is below the configured minimum or gross-margin floor.';
  end if;

  update public.services
  set price_cents=chosen_price,
      price_source='marlon_market_guided',
      last_price_review_at=now(),
      updated_at=now()
  where id=row_service.id;

  return jsonb_build_object(
    'ok',true,
    'service_id',row_service.id,
    'research_id',row_research.id,
    'price_cents',chosen_price,
    'previous_price_cents',row_service.price_cents,
    'minimum_price_cents',row_service.minimum_price_cents,
    'direct_cost_cents',direct_cost_cents,
    'margin_floor_cents',margin_floor_cents,
    'required_floor_cents',required_floor_cents,
    'target_gross_margin_percent',settings.target_gross_margin_percent
  );
end;
$$;

revoke all on function public.apply_service_price_recommendation(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.apply_service_price_recommendation(uuid,integer) to authenticated;

create or replace function public.enforce_price_book_service_pricing()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  settings public.business_settings%rowtype;
  linked_part_cost_cents integer := 0;
  direct_cost_cents integer := 0;
  margin_floor_cents integer := 0;
  required_floor_cents integer := 0;
begin
  if auth.uid() is null then return new; end if;
  if tg_op='UPDATE' and new.price_cents is not distinct from old.price_cents
     and new.minimum_price_cents is not distinct from old.minimum_price_cents
     and new.cost_cents is not distinct from old.cost_cents then return new; end if;
  if not coalesce(public.has_permission('pricing.override'),false) then
    raise exception 'Pricing Override permission is required to change catalog pricing.';
  end if;

  select * into settings from public.business_settings where location_id=new.location_id;
  if settings.location_id is null then raise exception 'Business settings not found.'; end if;
  if tg_op='UPDATE' then
    select coalesce(ceil(sum(i.cost_cents*l.quantity)),0)::integer into linked_part_cost_cents
    from public.service_inventory_links l
    join public.inventory_items i on i.id=l.inventory_item_id
    where l.service_id=new.id;
  end if;

  direct_cost_cents := greatest(0,coalesce(new.cost_cents,0)+linked_part_cost_cents);
  margin_floor_cents := case
    when direct_cost_cents<=0 then 0
    else ceil(direct_cost_cents/greatest(0.06,1-(least(94,greatest(0,coalesce(settings.target_gross_margin_percent,50)))/100.0)))::integer
  end;
  required_floor_cents := greatest(0,new.minimum_price_cents,margin_floor_cents);
  if not new.quote_required and new.price_cents < required_floor_cents then
    raise exception 'Catalog price is below the configured minimum or gross-margin floor.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_price_book_service_pricing() from public,anon,authenticated,service_role;

drop trigger if exists trg_enforce_price_book_service_pricing on public.services;
create trigger trg_enforce_price_book_service_pricing
before insert or update of price_cents,minimum_price_cents,cost_cents on public.services
for each row execute function public.enforce_price_book_service_pricing();
