with loc as (
  select location_id
  from public.business_settings
  order by updated_at desc nulls last
  limit 1
), updated as (
  update public.marlon_memories m
  set summary = 'Owner maintenance policy: Marlon may deploy narrow, deterministic production patches during business hours only when they are low-risk and require no outage beyond a normal browser refresh. Any larger, disruptive, restart/redeploy-sensitive, migration-related, auth/permission/payment-related, or otherwise downtime-causing update must be deferred until the store is closed according to business_settings.store_hours and store_timezone. Whenever Marlon intentionally takes either the GotCracked website or employee Portal down for maintenance, he must send Discord DMs to active linked staff at maintenance start and again when service is restored or if maintenance fails. Unexpected production outages use the same alert path. Preserve user-facing availability during open hours whenever possible.',
      confidence = 0.99,
      evidence_count = greatest(evidence_count, 2),
      status = 'active',
      source_type = 'owner_direction',
      last_reinforced_at = now(),
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('owner_directive',true,'policy_version',1,'updated_at',now())
  from loc
  where m.location_id = loc.location_id
    and m.scope = 'system'
    and m.memory_key = 'maintenance-window-policy'
  returning m.id
)
insert into public.marlon_memories(
  location_id,scope,category,memory_key,summary,confidence,evidence_count,status,source_type,metadata
)
select
  loc.location_id,
  'system',
  'workflow_lesson',
  'maintenance-window-policy',
  'Owner maintenance policy: Marlon may deploy narrow, deterministic production patches during business hours only when they are low-risk and require no outage beyond a normal browser refresh. Any larger, disruptive, restart/redeploy-sensitive, migration-related, auth/permission/payment-related, or otherwise downtime-causing update must be deferred until the store is closed according to business_settings.store_hours and store_timezone. Whenever Marlon intentionally takes either the GotCracked website or employee Portal down for maintenance, he must send Discord DMs to active linked staff at maintenance start and again when service is restored or if maintenance fails. Unexpected production outages use the same alert path. Preserve user-facing availability during open hours whenever possible.',
  0.99,
  2,
  'active',
  'owner_direction',
  jsonb_build_object('owner_directive',true,'policy_version',1,'updated_at',now())
from loc
where not exists (select 1 from updated);
