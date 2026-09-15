create or replace function public.preserve_mobilesentrix_cached_image_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_name = 'mobilesentrix' and old.source_metadata is not null then
    new.source_metadata = coalesce(new.source_metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'cached_image_source_url',old.source_metadata->'cached_image_source_url',
      'cached_image_url',old.source_metadata->'cached_image_url',
      'cached_image_path',old.source_metadata->'cached_image_path',
      'cached_image_content_type',old.source_metadata->'cached_image_content_type',
      'cached_image_bytes',old.source_metadata->'cached_image_bytes',
      'cached_image_at',old.source_metadata->'cached_image_at'
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_mobilesentrix_cached_image_metadata on public.part_source_listings;
create trigger preserve_mobilesentrix_cached_image_metadata
before update of source_metadata on public.part_source_listings
for each row execute function public.preserve_mobilesentrix_cached_image_metadata();

create or replace view public.parts_registry_latest_source as
select p.id as part_id,p.display_name,p.category,p.subcategory,p.brand,p.model,p.lifecycle,p.release_date,p.specs,p.compatibility,p.first_seen_at,p.last_seen_at,
  l.id as listing_id,l.source_name,l.source_type,l.supplier_sku,l.source_url,l.price_cents,l.currency_code,l.availability,l.last_seen_at as listing_last_seen_at,
  exists(select 1 from public.inventory_items i where i.registry_part_id=p.id and i.active) as stocked,
  nullif(l.source_metadata->>'image_url','') as source_image_url,
  nullif(l.source_metadata->>'cached_image_url','') as cached_image_url,
  nullif(l.source_metadata->>'cached_image_path','') as cached_image_path
from public.parts_registry p
left join lateral (
  select x.* from public.part_source_listings x
  where x.part_id=p.id and x.active
  order by (x.source_name='mobilesentrix') desc,x.last_seen_at desc
  limit 1
) l on true;

alter view public.parts_registry_latest_source set (security_invoker=true);