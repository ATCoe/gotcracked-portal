-- The signed Discord handler must be able to call the existing pure hash helper.
-- No browser privileges, release policies, approval records, or table grants change.
do $verify_helper$
begin
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='public.marlon_improvement_fingerprint(text,text,text)'::regprocedure
      and p.prosecdef=false and p.provolatile='i' and l.lanname='sql'
  ) then
    raise exception 'Expected an immutable, invoker-only SQL fingerprint helper.';
  end if;
end;
$verify_helper$;

grant execute on function public.marlon_improvement_fingerprint(text,text,text) to service_role;
notify pgrst, 'reload schema';
