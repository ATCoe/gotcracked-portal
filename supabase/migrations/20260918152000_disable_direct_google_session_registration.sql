-- Workspace sessions are now registered only by the workspace-verify Edge
-- Function after it proves the current Google provider access token. A browser
-- client must not be able to label an arbitrary linked-OAuth session as Google.
revoke all on function public.register_google_human_session()
  from public,anon,authenticated,service_role;
comment on function public.register_google_human_session() is
  'Deprecated for browser use. Workspace sessions are registered by workspace-verify after current-provider proof.';
