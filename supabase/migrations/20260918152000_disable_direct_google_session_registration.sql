-- The browser now uses register_workspace_human_session(text), which proves
-- the current provider against Supabase Auth's session + login audit records.
-- Retire the legacy no-argument registration path after the Portal cutover.
revoke all on function public.register_google_human_session()
  from public,anon,authenticated,service_role;
comment on function public.register_google_human_session() is
  'Deprecated for browser use. Workspace sessions are registered by register_workspace_human_session(text) after server-side current-provider proof.';
