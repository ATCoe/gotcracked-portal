-- Keep the staff profile RPC surface unambiguous for PostgREST/Supabase clients.
-- The legacy five-argument manager RPC remained in production after the avatar
-- parameter was added, leaving two overloads with the same RPC name.

drop function if exists public.update_staff_profile_details(uuid,text,text,text,text);

revoke all on function public.update_my_staff_profile(text,text,text,text,text) from public, anon;
grant execute on function public.update_my_staff_profile(text,text,text,text,text) to authenticated;

revoke all on function public.update_staff_profile_details(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.update_staff_profile_details(uuid,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
