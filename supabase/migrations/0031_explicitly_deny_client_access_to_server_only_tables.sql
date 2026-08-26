create policy "deny client access to google integrations"
on public.google_integrations for all to anon, authenticated
using (false) with check (false);

create policy "deny client access to google oauth states"
on public.google_oauth_states for all to anon, authenticated
using (false) with check (false);

create policy "deny client access to runtime secrets"
on public.internal_runtime_secrets for all to anon, authenticated
using (false) with check (false);
