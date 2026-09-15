create table if not exists public.mobilesentrix_image_cache (
  listing_id uuid primary key references public.part_source_listings(id) on delete cascade,
  source_image_url text not null,
  cached_image_url text not null,
  cached_image_path text not null,
  content_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  cached_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mobilesentrix_image_cache enable row level security;
revoke all on public.mobilesentrix_image_cache from anon;
grant select on public.mobilesentrix_image_cache to authenticated;

drop policy if exists "Authenticated cache reads" on public.mobilesentrix_image_cache;
create policy "Authenticated cache reads"
on public.mobilesentrix_image_cache for select
to authenticated
using (true);

create or replace view public.parts_registry_latest_source as
select p.id as part_id,p.display_name,p.category,p.subcategory,p.brand,p.model,p.lifecycle,p.release_date,p.specs,p.compatibility,p.first_seen_at,p.last_seen_at,
  l.id as listing_id,l.source_name,l.source_type,l.supplier_sku,l.source_url,l.price_cents,l.currency_code,l.availability,l.last_seen_at as listing_last_seen_at,
  exists(select 1 from public.inventory_items i where i.registry_part_id=p.id and i.active) as stocked,
  nullif(l.source_metadata->>'image_url','') as source_image_url,
  c.cached_image_url,
  c.cached_image_path
from public.parts_registry p
left join lateral (
  select x.* from public.part_source_listings x
  where x.part_id=p.id and x.active
  order by (x.source_name='mobilesentrix') desc,x.last_seen_at desc
  limit 1
) l on true
left join public.mobilesentrix_image_cache c on c.listing_id=l.id;

alter view public.parts_registry_latest_source set (security_invoker=true);
