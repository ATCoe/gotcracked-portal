-- The Blacksburg Google Workspace identity is the shared Front Desk account.
-- Individual staff identity is established only after the workstation operator PIN.
update public.profiles
set account_type='shared_workstation',
    display_name=coalesce(nullif(display_name,''),'Blacksburg Front Desk'),
    updated_at=now()
where lower(coalesce(portal_email,''))='blacksburg@gotcracked.co'
  and active=true;
