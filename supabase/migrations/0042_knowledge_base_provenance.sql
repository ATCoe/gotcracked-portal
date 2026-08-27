-- GotCracked Knowledge Base provenance upgrade
-- Additive only: preserves the existing repair_guides API and permission keys.

alter table if exists public.repair_guides
  add column if not exists source_type text not null default 'internal',
  add column if not exists source_name text not null default 'GotCracked',
  add column if not exists source_url text,
  add column if not exists source_license text,
  add column if not exists source_document_id text,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_notes text,
  add column if not exists procedure_version integer not null default 1;

-- Keep source_type bounded without blocking existing rows.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.repair_guides'::regclass
      and conname = 'repair_guides_source_type_check'
  ) then
    alter table public.repair_guides
      add constraint repair_guides_source_type_check
      check (source_type in ('internal','manufacturer','licensed_partner','external_reference'));
  end if;
end $$;

create index if not exists repair_guides_source_idx
  on public.repair_guides(source_type, source_name, active);

update public.repair_guides
set source_type = coalesce(nullif(source_type, ''), 'internal'),
    source_name = coalesce(nullif(source_name, ''), 'GotCracked')
where source_type is null
   or source_type = ''
   or source_name is null
   or source_name = '';

update public.permission_definitions
set label = 'View Knowledge Base',
    group_name = 'Knowledge',
    description = 'Search GotCracked repair intelligence and approved repair sources.'
where permission_key = 'reference.view';

update public.permission_definitions
set label = 'Manage Knowledge Base',
    group_name = 'Knowledge',
    description = 'Create, curate, source, and verify Knowledge Base repair paths.'
where permission_key = 'reference.manage';

comment on column public.repair_guides.source_type is
  'internal, manufacturer, licensed_partner, or external_reference.';
comment on column public.repair_guides.source_name is
  'Human-readable provenance, for example GotCracked, Apple, Samsung, Google, or a licensed partner.';
comment on column public.repair_guides.source_url is
  'Canonical source URL. Store links only when external content is not licensed for commercial ingestion.';
comment on column public.repair_guides.source_license is
  'License or commercial-use status recorded by GotCracked for this repair path.';
comment on column public.repair_guides.verified_at is
  'Most recent date a technician or manager verified the repair path against its source.';
