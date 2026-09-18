import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  new URL('../supabase/migrations/20260918152100_bind_human_sessions_to_oauth_provider.sql',import.meta.url),
  'utf8'
);

const checks=[
  ['Auth provider resolver reads login audit events',/payload->>'action'='login'/],
  ['Auth provider resolver binds the actor id',/payload->>'actor_id'=target_user_id::text/],
  ['Only Google and Discord are accepted OAuth providers',/provider' in \('google','discord'\)/],
  ['Session and audit creation must be within 250ms',/<=0\.25/],
  ['Ambiguous provider matches fail closed',/provider_count<>1 then return null/],
  ['Human-session trigger compares actual and requested providers',/actual_provider<>new\.verification_method/],
  ['Google sessions require a verified GotCracked Workspace identity',/email_verified'='true'[\s\S]*gotcracked\.co/],
  ['Workspace registration requires the current provider to be Google',/auth_session_oauth_provider\(session_id,caller_id\)<>'google'/],
  ['Workspace invitation is bound to the exact Workspace address',/lower\(coalesce\(invite_row\.portal_email,''\)\)<>workspace_email/],
  ['Workspace invitation token is hashed server-side',/extensions\.digest\(invite_token,'sha256'\)/],
  ['Workspace session is stored as Google only after provider validation',/verification_method,verified_at,last_seen_at[\s\S]*'google',now\(\),now\(\)/],
  ['Discord fallback sync requires an already-authorized Portal session',/not public\.portal_session_authorized\(\)/],
  ['Discord fallback sync uses a linked Discord identity',/i\.provider='discord'/],
  ['Discord fallback honors the username issued in onboarding',/profile_row\.discord_username[\s\S]*<>linked_discord_username/],
  ['Provider guard fires before human-session insert or relabel',/before insert or update of auth_session_id,profile_id,verification_method/],
];

for(const [name,pattern] of checks){
  assert.match(migration,pattern,name);
  console.log('PASS',name);
}

const revoke=fs.readFileSync(
  new URL('../supabase/migrations/20260918152000_disable_direct_google_session_registration.sql',import.meta.url),
  'utf8'
);
assert.match(revoke,/revoke all on function public\.register_google_human_session\(\)/);
console.log('PASS Legacy direct Google registration is revoked after cutover');
console.log(JSON.stringify({ok:true,providerBindingAssertions:checks.length+1,productionWrites:0}));
