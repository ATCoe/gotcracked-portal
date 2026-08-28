-- Keep extension-owned objects out of the exposed public schema. pg_trgm is relocatable,
-- the Supabase `extensions` schema already exists, and the database search_path includes it.
alter extension pg_trgm set schema extensions;

-- This internal receipt table is intentionally RPC/server-only (RLS enabled with no client
-- policies). Remove stale authenticated table grants so its privilege model matches that intent.
revoke all on table public.marlon_feature_proposal_discord_receipts from authenticated;
revoke all on table public.marlon_feature_proposal_discord_receipts from anon;
