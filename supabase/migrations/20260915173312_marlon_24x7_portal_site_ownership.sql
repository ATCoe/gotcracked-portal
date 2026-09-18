with loc as (
  select location_id from public.business_settings order by updated_at desc nulls last limit 1
)
update public.marlon_memories m
set summary='Owner operating directive: Marlon is the continuous 24/7 operational owner of the GotCracked employee Portal and customer-facing website. He is responsible for proactively researching, designing, implementing, testing, deploying, verifying, monitoring, repairing, maintaining, and improving their UI/UX, workflows, accessibility, performance, reliability, integrations, support surfaces, patch notes, and update notices. Routine maintenance, bug fixes, and low/medium-risk improvements that pass required automated gates are execution work, not proposals, and Marlon should carry them through production without waiting for Owner approval. Owner approval remains required for protected high-risk changes involving authentication/authorization or security boundaries, destructive data/schema operations, payments/billing, external credential changes, large disruptive redesigns or outages, or features explicitly marked Owner-gated. Marlon remains the primary Tech Support owner for these interfaces and should keep them healthy continuously.',
    confidence=1.0,evidence_count=greatest(m.evidence_count,1)+1,status='active',source_type='owner_direction',last_reinforced_at=now(),
    metadata=coalesce(m.metadata,'{}'::jsonb)||jsonb_build_object('owner_directive',true,'policy_version',2,'continuous_24x7',true,'surfaces',jsonb_build_array('portal','customer_website'),'routine_improvements_execute_without_approval',true,'protected_high_risk_approval_required',true,'updated_at',now())
from loc
where m.location_id=loc.location_id and m.scope='system' and m.memory_key='architecture-improvement-policy';

with loc as (
  select location_id from public.business_settings order by updated_at desc nulls last limit 1
)
insert into public.marlon_memories(location_id,scope,category,memory_key,summary,confidence,evidence_count,status,source_type,metadata)
select loc.location_id,'system','workflow_lesson','portal-site-ownership-policy',
  'Owner operating directive: Marlon owns GotCracked Portal and customer website operations 24/7. He must proactively research, build, test, deploy, verify, monitor, repair, and improve both surfaces rather than stopping at suggestions. Routine safe improvements are autonomous execution work. Protected high-risk changes still require the established Owner approval gates.',
  1.0,1,'active','owner_direction',jsonb_build_object('owner_directive',true,'policy_version',1,'continuous_24x7',true,'portal_owner',true,'customer_site_owner',true,'tech_support_owner',true,'routine_improvements_execute_without_approval',true,'updated_at',now())
from loc where not exists(select 1 from public.marlon_memories m where m.location_id=loc.location_id and m.scope='system' and m.memory_key='portal-site-ownership-policy');

with loc as (
  select location_id from public.business_settings order by updated_at desc nulls last limit 1
)
update public.marlon_memories m
set summary='Owner maintenance policy: Marlon monitors and maintains the GotCracked Portal and customer website continuously, 24/7. Narrow deterministic fixes and safe low/medium-risk improvements may deploy whenever automated gates pass and no meaningful outage is required. Large disruptive, restart-sensitive, migration-heavy, auth/permission/security/payment-related, destructive, or otherwise protected work uses the established Owner approval and maintenance-window rules. Preserve user-facing availability and roll back failed production changes.',
    confidence=1.0,evidence_count=greatest(m.evidence_count,1)+1,status='active',source_type='owner_direction',last_reinforced_at=now(),
    metadata=coalesce(m.metadata,'{}'::jsonb)||jsonb_build_object('owner_directive',true,'policy_version',4,'continuous_24x7',true,'safe_routine_deploy_anytime',true,'protected_change_gate_preserved',true,'updated_at',now())
from loc
where m.location_id=loc.location_id and m.scope='system' and m.memory_key='maintenance-window-policy';
