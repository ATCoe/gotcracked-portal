-- GotCracked Portal device catalog foundation.
-- Structured upstream identity data may be enriched from Wikidata (CC0).
-- Reusable imagery must retain Wikimedia Commons per-file license/author/source metadata.

create extension if not exists pg_trgm;

create table if not exists public.device_catalog_manufacturers(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  categories text[] not null default '{}'::text[],
  website_url text,
  logo_url text,
  source_system text not null default 'curated',
  source_key text,
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists device_catalog_manufacturers_source_idx on public.device_catalog_manufacturers(source_system,source_key) where source_key is not null;

create table if not exists public.device_catalog_models(
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.device_catalog_manufacturers(id) on delete cascade,
  category text not null check(category in ('Phone','Tablet','Laptop','Desktop','Console','Other')),
  name text not null,
  family text,
  release_year smallint,
  model_numbers text[] not null default '{}'::text[],
  colors text[] not null default '{}'::text[],
  storage_options text[] not null default '{}'::text[],
  image_url text,
  image_source text,
  image_license text,
  image_author text,
  image_attribution_url text,
  source_system text not null default 'curated',
  source_key text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manufacturer_id,category,name)
);
create unique index if not exists device_catalog_models_source_idx on public.device_catalog_models(source_system,source_key) where source_key is not null;
create index if not exists device_catalog_manufacturer_name_trgm_idx on public.device_catalog_manufacturers using gin(name gin_trgm_ops);
create index if not exists device_catalog_model_name_trgm_idx on public.device_catalog_models using gin(name gin_trgm_ops);
create index if not exists device_catalog_model_category_idx on public.device_catalog_models(category,manufacturer_id,active);

create table if not exists public.device_catalog_variants(
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.device_catalog_models(id) on delete cascade,
  label text,
  model_number text,
  color text,
  storage_size text,
  region text,
  sku text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists device_catalog_variant_model_idx on public.device_catalog_variants(model_id,active);

alter table if exists public.devices add column if not exists catalog_model_id uuid references public.device_catalog_models(id) on delete set null;
alter table if exists public.devices add column if not exists catalog_variant_id uuid references public.device_catalog_variants(id) on delete set null;

alter table public.device_catalog_manufacturers enable row level security;
alter table public.device_catalog_models enable row level security;
alter table public.device_catalog_variants enable row level security;

drop policy if exists "device catalog manufacturers are readable" on public.device_catalog_manufacturers;
create policy "device catalog manufacturers are readable" on public.device_catalog_manufacturers for select to anon,authenticated using(active=true);
drop policy if exists "device catalog models are readable" on public.device_catalog_models;
create policy "device catalog models are readable" on public.device_catalog_models for select to anon,authenticated using(active=true);
drop policy if exists "device catalog variants are readable" on public.device_catalog_variants;
create policy "device catalog variants are readable" on public.device_catalog_variants for select to anon,authenticated using(active=true);

revoke insert,update,delete on public.device_catalog_manufacturers from anon,authenticated;
revoke insert,update,delete on public.device_catalog_models from anon,authenticated;
revoke insert,update,delete on public.device_catalog_variants from anon,authenticated;
grant select on public.device_catalog_manufacturers to anon,authenticated;
grant select on public.device_catalog_models to anon,authenticated;
grant select on public.device_catalog_variants to anon,authenticated;

comment on table public.device_catalog_models is 'GotCracked repair intake device catalog. Curated records may be enriched from CC0 Wikidata. External image rows retain source/license/author attribution metadata.';