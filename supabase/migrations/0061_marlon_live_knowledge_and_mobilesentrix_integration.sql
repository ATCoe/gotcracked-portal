alter table public.part_registry_sync_sources
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists secret_id uuid,
  add column if not exists last_cursor text;

create table if not exists public.marlon_web_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  category text not null,
  url text not null unique,
  tags text[] not null default '{}',
  trust_level text not null default 'primary',
  live_fetch boolean not null default true,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marlon_web_sources_category_check check (category in ('repair','gaming','parts','pc_hardware','business','software')),
  constraint marlon_web_sources_trust_check check (trust_level in ('primary','secondary','reference'))
);

alter table public.marlon_web_sources enable row level security;
drop policy if exists "staff view marlon web sources" on public.marlon_web_sources;
create policy "staff view marlon web sources" on public.marlon_web_sources
  for select to authenticated using (auth.uid() is not null);

insert into public.marlon_web_sources(source_name,category,url,tags,trust_level,live_fetch,notes) values
('Apple Self Service Repair','repair','https://support.apple.com/self-service-repair',array['apple','iphone','ipad','mac','repair','diagnostics'],'primary',true,'Authoritative Apple repair gateway.'),
('Samsung Self-Repair','repair','https://www.samsung.com/us/support/self-repair/',array['samsung','galaxy','phone','tablet','repair'],'primary',true,'Authoritative Samsung repair gateway.'),
('Google Pixel Repair','repair','https://support.google.com/pixelphone/answer/14257407?hl=en',array['google','pixel','phone','tablet','repair'],'primary',true,'Authoritative Pixel repair guidance.'),
('Microsoft Surface Service Guides','repair','https://learn.microsoft.com/en-us/surface/service-guides/surface-service-guides',array['microsoft','surface','laptop','tablet','repair'],'primary',true,'Authoritative Surface service guides.'),
('Dell Support','repair','https://www.dell.com/support/home/en-us',array['dell','alienware','xps','latitude','desktop','laptop'],'primary',true,'OEM manuals, diagnostics, drivers and service information.'),
('HP Support','repair','https://support.hp.com/us-en/',array['hp','omen','laptop','desktop','printer','repair'],'primary',true,'OEM support and service documentation.'),
('Lenovo Support','repair','https://support.lenovo.com/us/en/',array['lenovo','thinkpad','legion','laptop','desktop','handheld'],'primary',true,'OEM service and diagnostic documentation.'),
('ASUS Support','repair','https://www.asus.com/us/support/',array['asus','rog','ally','laptop','desktop','repair'],'primary',true,'OEM support and service documentation.'),
('Acer Support','repair','https://www.acer.com/us-en/support',array['acer','predator','nitro','laptop','desktop'],'primary',true,'OEM support documentation.'),
('MSI Support','repair','https://www.msi.com/support',array['msi','gaming','laptop','desktop','motherboard','gpu'],'primary',true,'OEM support and hardware documentation.'),
('PlayStation Support','gaming','https://www.playstation.com/en-us/support/',array['sony','playstation','ps4','ps5','controller','gaming'],'primary',true,'Official PlayStation troubleshooting and support.'),
('Xbox Support','gaming','https://support.xbox.com/en-US/',array['microsoft','xbox','series x','series s','controller','gaming'],'primary',true,'Official Xbox troubleshooting and support.'),
('Nintendo Support','gaming','https://en-americas-support.nintendo.com/',array['nintendo','switch','switch 2','joy-con','gaming'],'primary',true,'Official Nintendo troubleshooting and support.'),
('Steam Support','gaming','https://help.steampowered.com/en/',array['steam','valve','steam deck','pc gaming','gaming'],'primary',true,'Official Steam and Valve support.'),
('AMD Support','pc_hardware','https://www.amd.com/en/support',array['amd','ryzen','radeon','cpu','gpu','drivers'],'primary',true,'Official AMD hardware, drivers and support.'),
('NVIDIA Support','pc_hardware','https://www.nvidia.com/en-us/support/',array['nvidia','geforce','gpu','drivers','gaming pc'],'primary',true,'Official NVIDIA support.'),
('Intel Support','pc_hardware','https://www.intel.com/content/www/us/en/support.html',array['intel','core','cpu','chipset','drivers'],'primary',true,'Official Intel support.'),
('Microsoft Windows Support','software','https://support.microsoft.com/windows',array['windows','pc','drivers','recovery','software'],'primary',true,'Official Windows troubleshooting.'),
('PCPartPicker','pc_hardware','https://pcpartpicker.com/',array['pc build','compatibility','cpu','gpu','ram','motherboard','psu'],'reference',true,'Compatibility and component reference; verify critical specs against manufacturers.'),
('MobileSentrix','parts','https://www.mobilesentrix.com/replacement-parts',array['mobilesentrix','parts','phone','tablet','console','supplier'],'primary',true,'GotCracked preferred supplier catalog reference.'),
('MobileSentrix Quality Standards','parts','https://www.mobilesentrix.com/quality-standards',array['mobilesentrix','quality','oem','aftermarket','parts'],'primary',true,'Supplier quality-grade definitions.'),
('MobileSentrix Game Console Parts','parts','https://www.mobilesentrix.com/game-console-parts',array['mobilesentrix','console','playstation','xbox','switch','gaming'],'primary',true,'Supplier console-parts catalog gateway.'),
('MobileSentrix FAQ','business','https://www.mobilesentrix.com/frequently-asked-questions',array['mobilesentrix','api','shipping','returns','supplier'],'primary',true,'Supplier API, ordering, shipping and account reference.'),
('iFixit','repair','https://www.ifixit.com/Device',array['ifixit','teardown','repair','phone','tablet','console','computer'],'secondary',false,'External link-only reference. Do not ingest or redistribute guide text without a commercial license.')
on conflict (url) do update set
  source_name=excluded.source_name,
  category=excluded.category,
  tags=excluded.tags,
  trust_level=excluded.trust_level,
  live_fetch=excluded.live_fetch,
  notes=excluded.notes,
  active=true,
  updated_at=now();

create or replace function public.server_store_vendor_secret(p_source_name text,p_secret text)
returns uuid
language plpgsql
security definer
set search_path=public,vault,pg_temp
as $$
declare sid uuid;
begin
  if coalesce(length(p_secret),0) < 1 then raise exception 'Secret is required'; end if;
  select secret_id into sid from public.part_registry_sync_sources where source_name=p_source_name;
  if sid is null then
    sid := vault.create_secret(
      p_secret,
      'gotcracked_'||regexp_replace(lower(p_source_name),'[^a-z0-9]+','_','g')||'_api',
      'GotCracked vendor integration credential'
    );
    update public.part_registry_sync_sources set secret_id=sid,updated_at=now() where source_name=p_source_name;
  else
    perform vault.update_secret(sid,p_secret,null,'GotCracked vendor integration credential');
  end if;
  return sid;
end $$;
revoke all on function public.server_store_vendor_secret(text,text) from public,anon,authenticated;
grant execute on function public.server_store_vendor_secret(text,text) to service_role;

create or replace function public.server_read_vendor_secret(p_secret_id uuid)
returns text
language sql
security definer
set search_path=public,vault,pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where id=p_secret_id limit 1
$$;
revoke all on function public.server_read_vendor_secret(uuid) from public,anon,authenticated;
grant execute on function public.server_read_vendor_secret(uuid) to service_role;

update public.part_registry_sync_sources
set enabled=true,
    mode='api',
    last_status='not_configured',
    config=jsonb_build_object(
      'api_base_url','https://www.mobilesentrix.com',
      'catalog_path','/rest/V1/products',
      'auth_scheme','bearer',
      'page_size',100
    ),
    updated_at=now()
where source_name='mobilesentrix'
  and secret_id is null;