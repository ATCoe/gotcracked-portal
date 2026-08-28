update public.marlon_execution_capabilities
set status='active',
    executor='GitHub Actions + crackwave-ai',
    reason='Repository-bound GitHub Actions workers are live for the Portal and customer website. Portal claim/report behavior and website OIDC/no-work claim behavior were verified; protected and approval gates remain enforced.',
    last_verified_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repositories',jsonb_build_array('ATCoe/gotcracked-portal','ATCoe/gotcracked-site'),'oidc_gated',true,'repository_bound_claims',true,'verified_worker_routing',true)
where capability='support_ticket_execution';

update public.marlon_execution_capabilities
set status='active',
    executor='GitHub Actions bounded patch executor + crackwave-ai planner',
    reason='Both GotCracked repositories now have OIDC-gated bounded execution workflows with contents-write permission, isolated patch branches, safety checks, main-SHA race protection, deployment gating, and live verification. Actual execution receipts remain required before Marlon may claim a specific change was implemented.',
    last_verified_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repositories',jsonb_build_array('ATCoe/gotcracked-portal','ATCoe/gotcracked-site'),'bounded_edits',true,'isolated_branch',true,'main_race_guard',true,'receipt_required',true)
where capability='github_patch_execution';

update public.marlon_execution_capabilities
set status='degraded',
    executor='GitHub Actions source guards + crackwave-ai planner',
    reason='Repository source audits and bounded diagnosis are live across Portal and website, but visual browser monitoring is not yet a full autonomous vision-based audit, so repository audit capability remains degraded rather than overstated.',
    last_verified_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('portal_full_source_audit',true,'website_site_ci',true,'visual_browser_audit',false)
where capability='repository_audit_execution';

update public.marlon_execution_capabilities
set status='degraded',
    executor='Supabase release coordinator + repository-bound GitHub Actions workers',
    reason='Approved releases now hand off to per-surface execution tickets and can coordinate completion from verified worker receipts, but a complete approved-release build/deploy cycle has not yet been production-verified end to end.',
    last_verified_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('approved_release_handoff',true,'completion_coordinator',true,'end_to_end_release_verified',false)
where capability='release_build_deploy';
