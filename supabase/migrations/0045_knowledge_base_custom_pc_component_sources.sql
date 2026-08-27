-- GotCracked Knowledge Base: custom PC / component-manufacturer reference expansion
-- Original GotCracked technician indexing only; linked vendor material remains external.

with seed(slug, manufacturer, model_family, title, source_name, source_url, tags) as (
  values
    ('kb-windows-recovery','Microsoft','Windows 11 / Custom PC','Windows recovery and startup diagnostics','Microsoft Windows Support','https://support.microsoft.com/en-us/windows/experience/backup-recovery/recovery-options-in-windows',array['windows 11','winre','startup repair','recovery','custom pc']::text[]),
    ('kb-intel-cpu','Intel','Intel Core / Core Ultra','Intel processor diagnostics and support','Intel Processor Diagnostic Tool','https://www.intel.com/content/www/us/en/download/15951/intel-processor-diagnostic-tool.html',array['intel','cpu','processor','diagnostic','stress test']::text[]),
    ('kb-amd-cpu-gpu','AMD','Ryzen / Radeon','AMD processor and Radeon support','AMD Support','https://www.amd.com/en/support.html',array['amd','ryzen','radeon','cpu','gpu','drivers','thermal']::text[]),
    ('kb-nvidia-geforce','NVIDIA','GeForce / RTX','NVIDIA GeForce technical support','NVIDIA GeForce Support','https://www.nvidia.com/en-us/geforce/support/',array['nvidia','geforce','rtx','gpu','drivers','graphics']::text[]),
    ('kb-asus-motherboard','ASUS','ASUS / ROG Motherboards','ASUS motherboard POST / Q-LED diagnostics','ASUS Motherboard Support','https://www.asus.com/support/faq/1042678/',array['asus','rog','motherboard','q-led','post','bios']::text[]),
    ('kb-msi-motherboard','MSI','MSI Motherboards','MSI motherboard POST / BIOS diagnostics','MSI Motherboard Support','https://www.msi.com/support/technical_details/MB_Boot_No_Display/',array['msi','motherboard','ez debug led','post','bios']::text[]),
    ('kb-gigabyte-motherboard','GIGABYTE','GIGABYTE / AORUS Motherboards','GIGABYTE motherboard manuals / BIOS / troubleshooting','GIGABYTE Support','https://www.gigabyte.com/Support/Consumer',array['gigabyte','aorus','motherboard','bios','boot','manual']::text[]),
    ('kb-asrock-motherboard','ASRock','ASRock Motherboards','ASRock motherboard debug / troubleshooting reference','ASRock Support','https://www.asrock.com/support/faq.asp',array['asrock','motherboard','dr debug','post status checker','bios']::text[])
)
insert into public.repair_guides (
  slug, device_category, manufacturer, model_family, symptom, title, summary,
  diagnostic_steps, likely_causes, tools_notes, parts_notes, cautions, tags,
  difficulty, bench_time_minutes, active, source_type, source_name, source_url,
  source_license, verified_at, verification_notes, procedure_version
)
select
  s.slug,
  'Desktop',
  s.manufacturer,
  s.model_family,
  'Custom PC component, POST, firmware, driver, operating-system, CPU, GPU, or motherboard diagnostic reference needed',
  s.title,
  'GotCracked custom-PC source index. Use the linked vendor reference together with the exact component model, motherboard revision, firmware version, and known-good bench testing. The Portal stores original technician workflow metadata rather than copied vendor documentation.',
  jsonb_build_array(
    'Record the exact motherboard, CPU, GPU, memory, storage, PSU, firmware/BIOS, operating system, recent hardware changes, and observed POST/debug behavior.',
    'Return overclocking or tuning to a known-safe stock baseline when appropriate, then isolate power, CPU, memory, GPU, storage, display, and peripheral paths with known-good components.',
    'Use the exact vendor manual, diagnostic indicators, support tools, firmware notes, and compatibility lists before flashing firmware or condemning a component.',
    'After repair verify repeated cold boots, POST, memory stability, CPU/GPU load, storage health, networking, audio, USB, thermals, sleep/wake, and Windows recovery/boot health as applicable.'
  ),
  jsonb_build_array('Power delivery or PSU fault','CPU or memory training/compatibility issue','GPU or display-path fault','Firmware/BIOS or driver issue','Motherboard, storage, or operating-system fault'),
  'Use ESD-safe tools, a known-good PSU/display/cables/components where practical, POST/debug indicators, vendor diagnostics, and controlled thermal/load testing.',
  'Verify exact PCB/revision, firmware compatibility, socket/platform, memory QVL where relevant, power requirements, connector pinout, and replacement-part revision before installation.',
  'Disconnect AC power before internal service. Do not open a PSU. Use caution with firmware updates: verify the exact model/revision and maintain stable power. Stop for burning odor, damaged power connectors, liquid, or abnormal heat.',
  s.tags,
  'Intermediate-Advanced',
  60,
  true,
  'manufacturer',
  s.source_name,
  s.source_url,
  'External official vendor reference; do not redistribute source content.',
  now(),
  'Official vendor/component support source indexed and reviewed for GotCracked on 2026-08-27. Recheck the exact component model and current documentation before service.',
  1
from seed s
where not exists (
  select 1 from public.repair_guides g
  where g.location_id is null and g.slug=s.slug
);
