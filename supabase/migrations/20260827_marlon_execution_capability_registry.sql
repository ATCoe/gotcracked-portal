create table if not exists public.marlon_execution_capabilities (
  location_id uuid not null references public.locations(id) on delete cascade,
  capability text not null,
  status text not null check (status in ('active','degraded','blocked','planned')),
  executor text,
  reason text,
  last_verified_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key(location_id,capability)
);

alter table public.marlon_execution_capabilities enable row level security;

drop policy if exists marlon_execution_capabilities_read on public.marlon_execution_capabilities;
create policy marlon_execution_capabilities_read
on public.marlon_execution_capabilities for select to authenticated
using (location_id=public.current_location_id());

grant select on public.marlon_execution_capabilities to authenticated;

create or replace function public.get_marlon_execution_capabilities()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(jsonb_object_agg(
    capability,
    jsonb_build_object(
      'status',status,
      'executor',executor,
      'reason',reason,
      'last_verified_at',last_verified_at,
      'metadata',metadata
    ) order by capability
  ),'{}'::jsonb)
  from public.marlon_execution_capabilities
  where location_id=public.current_location_id();
$$;

revoke all on function public.get_marlon_execution_capabilities() from public,anon;
grant execute on function public.get_marlon_execution_capabilities() to authenticated;

insert into public.marlon_execution_capabilities(location_id,capability,status,executor,reason,metadata)
select l.id,v.capability,v.status,v.executor,v.reason,v.metadata
from public.locations l
cross join lateral (values
  ('chat_support','active','crackwave-ai','Authenticated Portal chat and TTS are live.','{}'::jsonb),
  ('persistent_memory','active','crackwave-ai + Supabase','Conversation memory and resolved-ticket reliability memory are live.','{}'::jsonb),
  ('support_ticket_logging','active','Supabase RPC','Actionable work can be recorded in Support Desk.','{}'::jsonb),
  ('support_history_lookup','active','Supabase RPC','Resolved tickets can be searched and reused before diagnosis.','{}'::jsonb),
  ('discord_silent_support_log','active','discord-outbox-delivery','Support and maintenance updates can be logged silently without mentions.','{}'::jsonb),
  ('lead_pc_build_dm','active','discord-outbox-delivery','Direct messages are allowed only for newly created leads and custom PC build requests.','{}'::jsonb),
  ('booking_confidence_autogate','active','Supabase trigger','Booking intelligence can advance or roll back from actual repair outcomes.','{}'::jsonb),
  ('support_ticket_execution','blocked',null,'No autonomous worker currently claims open Support Desk tickets and carries them through diagnosis, implementation, verification, and resolution.','{}'::jsonb),
  ('github_patch_execution','blocked',null,'No Marlon runtime has a GitHub write credential or repository patch executor.','{}'::jsonb),
  ('cloudflare_deploy','blocked',null,'The crackwave worker is not auto-deploying from GitHub and the authorized runtime is not authenticated to Cloudflare/Wrangler.','{}'::jsonb),
  ('supabase_change_execution','blocked',null,'Marlon has targeted Edge/RPC tools but no generic approved-ticket executor for schema/function changes.','{}'::jsonb),
  ('release_build_deploy','blocked',null,'Release proposals and approvals exist, but no worker transitions approved releases through build, deploy, and verification.','{}'::jsonb),
  ('visual_monitoring','blocked',null,'Visual-monitor tables/settings exist but there is no scheduled browser runner; live run count is zero.','{}'::jsonb),
  ('maintenance_change_execution','blocked',null,'Maintenance policy/event logging is live, but it does not itself apply code/deployment changes or take a surface into/out of maintenance mode.','{}'::jsonb),
  ('discord_channel_management','blocked','marlon-operations','Discord bot can inspect/post but live sync returned Missing Permissions for category/channel management.','{}'::jsonb),
  ('repository_audit_execution','degraded','GitHub Actions + crackwave-ai','Source audit workflow is read-only and the AI /audit endpoint is not wired as an automatic patch/PR executor.','{}'::jsonb),
  ('unknown_error_learning','blocked',null,'Portal emits gc-diagnostic-learning-needed for unknown errors, but no runtime consumer currently persists/diagnoses that event automatically.','{}'::jsonb)
) as v(capability,status,executor,reason,metadata)
where l.name='Blacksburg'
on conflict(location_id,capability) do update
set status=excluded.status,executor=excluded.executor,reason=excluded.reason,last_verified_at=now(),metadata=excluded.metadata;