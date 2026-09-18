-- Supabase sessions without a configured time limit have NULL not_after.
-- Preserve all identity, session ownership, revocation and permission checks.
do $repair$
declare fn regprocedure; definition text;
begin
 foreach fn in array array['public.portal_session_authorized()'::regprocedure,'public.register_google_human_session()'::regprocedure] loop
  definition := pg_get_functiondef(fn);
  if position('(s.not_after is null or s.not_after > now())' in definition)>0 then continue; end if;
  if position('s.not_after > now()' in definition)=0 then raise exception 'Unexpected expiry guard in %',fn; end if;
  execute replace(definition,'s.not_after > now()','(s.not_after is null or s.not_after > now())');
 end loop;
end;
$repair$;
