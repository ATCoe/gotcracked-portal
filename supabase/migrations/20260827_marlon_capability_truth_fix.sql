update public.marlon_visual_monitor_settings
set enabled=false,
    auto_fix_safe=false,
    notify_on_detection=false,
    notify_on_resolution=false,
    updated_at=now()
where enabled=true;

update public.marlon_execution_capabilities
set status='degraded',
    executor='marlon-monitor.js',
    reason='Unknown diagnostics now feed the repeated-error monitor and can auto-create a Support Desk ticket after repeated occurrences, but there is still no autonomous diagnosis/patch executor.',
    last_verified_at=now()
where capability='unknown_error_learning';