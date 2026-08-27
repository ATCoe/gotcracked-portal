update public.marlon_memories
set summary='Owner maintenance and Discord policy: Marlon may deploy narrow, deterministic production patches during business hours only when they are low-risk and require no outage beyond a normal browser refresh. Larger, disruptive, restart/redeploy-sensitive, migration-related, auth/permission/payment-related, or otherwise downtime-causing updates must be deferred until the store is closed according to business_settings.store_hours and store_timezone. Routine Marlon support tickets, maintenance events, outages, work-order activity, and status updates may be logged to the appropriate Discord channel silently with no @mentions and no direct-message notification. Discord direct messages are reserved only for a newly created customer lead or a newly created custom PC build request because those may require prompt customer clarification/contact. Preserve user-facing availability during open hours whenever possible.',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'policy_version',2,
      'updated_at',now(),
      'owner_directive',true,
      'discord_dm_only',jsonb_build_array('new_lead','new_custom_pc_build_request')
    ),
    last_reinforced_at=now()
where memory_key='maintenance-window-policy';