-- SECURITY DEFINER functions execute with elevated database privileges and must never
-- inherit PostgreSQL's default EXECUTE grant to PUBLIC. Staff/server RPCs already carry
-- explicit authenticated/service_role grants; trigger functions do not require client EXECUTE.

DO $block$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('public', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
  END LOOP;
END
$block$;
