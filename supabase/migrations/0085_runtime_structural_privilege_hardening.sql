-- Runtime clients need row-level application DML, never schema-maintenance privileges.
-- Remove structural table capabilities that bypass or sit outside normal RLS workflows.

revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Keep future postgres-owned public tables from reintroducing these grants.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
