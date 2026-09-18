alter table public.part_registry_sync_sources
  drop constraint if exists part_registry_sync_sources_last_status_check;

alter table public.part_registry_sync_sources
  add constraint part_registry_sync_sources_last_status_check
  check (last_status = any (array[
    'not_configured'::text,
    'idle'::text,
    'authorizing'::text,
    'running'::text,
    'success'::text,
    'error'::text
  ]));
