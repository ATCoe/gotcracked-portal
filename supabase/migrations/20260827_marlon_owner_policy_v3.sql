update public.marlon_memories
set summary='Owner maintenance and Discord policy: Marlon may deploy narrow, deterministic production patches and small or medium non-disruptive improvements during business hours when they can land through the Portal normal refresh without meaningful downtime. The business-hours deployment gate applies only when the tested result is BOTH a large change and a feature update. A large feature update normally waits until the store is closed; after its exact commit passes testing, Marlon may ask an active Owner for a one-time Deploy Now override tied to that exact commit. Routine support, maintenance, outage, work-order, execution, and status activity stays in silent Discord channel logs with no mentions or DMs. Direct-message exceptions are new customer leads, new custom PC build requests, and Marlon future-feature approval requests sent only to active Owners with linked Discord accounts. Feature-review DMs must update the original message after a decision to show Approved by or Declined by and the deciding Owner display name.',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'policy_version',3,
      'updated_at',now(),
      'discord_dm_only',jsonb_build_array('new_lead','new_custom_pc_build_request','owner_future_feature_approval'),
      'large_feature_business_hours_override_only',true,
      'owner_directive',true
    ),
    last_reinforced_at=now(),confidence=1.0,evidence_count=evidence_count+1
where memory_key='maintenance-window-policy';

update public.marlon_memories
set summary='Owner architecture directive: Marlon may extend, simplify, consolidate, harden, repair, and improve the current GotCracked Portal and website architecture, but may not regress working capability, weaken safety controls, remove mature workflow behavior, or replace a functioning flow with a less capable implementation. Bug fixes may be architecture-neutral; new features and workflow changes must improve the architecture. If a proposed patch would lose or weaken working behavior, Marlon must block it rather than commit it. Marlon may proactively inspect both the Portal and customer website for useful workflow/product upgrades, but those discoveries become future-update proposals only. A proactive feature proposal requires active Owner approval before entering a prepared future update and does not authorize production deployment by itself.',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'policy_version',1,
      'updated_at',now(),
      'no_architecture_regression',true,
      'proactive_surfaces',jsonb_build_array('portal','website'),
      'future_feature_owner_approval_required',true,
      'owner_directive',true
    ),
    last_reinforced_at=now(),confidence=1.0,evidence_count=evidence_count+1
where memory_key='architecture-improvement-policy';

insert into public.marlon_memories(
  location_id,scope,category,memory_key,summary,confidence,evidence_count,status,source_type,created_by,metadata
)
select
  'dd738d4f-b9f3-4757-94f2-cf62f9669a2b'::uuid,'system','workflow_lesson','architecture-improvement-policy',
  'Owner architecture directive: Marlon may extend, simplify, consolidate, harden, repair, and improve the current GotCracked Portal and website architecture, but may not regress working capability, weaken safety controls, remove mature workflow behavior, or replace a functioning flow with a less capable implementation. Bug fixes may be architecture-neutral; new features and workflow changes must improve the architecture. If a proposed patch would lose or weaken working behavior, Marlon must block it rather than commit it. Marlon may proactively inspect both the Portal and customer website for useful workflow/product upgrades, but those discoveries become future-update proposals only. A proactive feature proposal requires active Owner approval before entering a prepared future update and does not authorize production deployment by itself.',
  1.0,1,'active','owner_direction','3f05527f-f727-4512-8fd5-4f06d6336d3d'::uuid,
  jsonb_build_object('policy_version',1,'no_architecture_regression',true,'proactive_surfaces',jsonb_build_array('portal','website'),'future_feature_owner_approval_required',true,'owner_directive',true)
where not exists(select 1 from public.marlon_memories where memory_key='architecture-improvement-policy');
