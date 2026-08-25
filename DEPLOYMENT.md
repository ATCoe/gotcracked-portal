# GotCracked Portal deployment

## Get the first owner logged in

This process does not send email.

1. Upload this portal release to the `gotcracked-portal` GitHub repository and wait for Cloudflare Pages to finish deploying it.
2. In Supabase, open **SQL Editor** and run `supabase/migrations/0002_staff_first_login_password.sql` once.
3. Visit `https://portal.gotcracked.co`.
4. Sign in with your existing GotCracked login email and the shared temporary password already stored in Supabase.
5. The portal will immediately require a new password and confirmation. Save it to enter the dashboard.

Deploy the website files before running migration 0002. That migration marks every existing profile, including owners, as requiring a password change.

If the shared temporary password is unknown, another signed-in owner must issue a new one after the staff manager is deployed. Standard Supabase email recovery cannot deliver an Austin account recovery token to the support account; the token belongs to the exact Auth email.

## Enable Staff accounts

1. In Supabase **SQL Editor**, run `supabase/migrations/0003_owner_staff_management.sql` once.
2. In Supabase, open **Edge Functions** and create a function named `manage-staff`.
3. Replace the function editor contents with `supabase/functions/manage-staff/index.ts` and deploy it.
4. Keep JWT verification enabled. Do not make this function public.
5. Sign in to the portal as an owner and open **Staff accounts** in the lower-left menu.

Supabase automatically provides the function with its project URL and server secret. Never place the server secret in `supabase.js`, GitHub Pages files, or Cloudflare browser variables.

Owners can:

- create a staff login and receive a generated one-time password;
- issue a replacement temporary password;
- require the user to create a private password at next login;
- enable or disable another account;
- change another account's role; and
- change their own password while signed in.

An owner cannot disable their own account, change their own role, or issue their own temporary password from the owner controls. This prevents an accidental lockout.

## Portal URL settings

In Supabase, open **Authentication → URL Configuration**:

- Set **Site URL** to `https://portal.gotcracked.co`.
- Add `https://portal.gotcracked.co` to **Redirect URLs**.

The portal's primary onboarding and owner-assisted recovery do not use email links, but these values should remain correct for any future email-based Auth features.

## Work-order label printing

See `LABEL_PRINTING.md` for DYMO installation, paper size, print settings, and QR-code behavior.
