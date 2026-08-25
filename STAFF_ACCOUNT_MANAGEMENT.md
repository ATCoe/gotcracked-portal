# Staff account management

## Normal onboarding

1. An owner opens **Staff accounts** and creates the user's login.
2. The portal displays a generated temporary password once.
3. The owner gives the login email and temporary password directly to the staff member.
4. The staff member signs in at `https://portal.gotcracked.co`.
5. The portal blocks the dashboard until the staff member creates and confirms a private password.

No email inbox or password-reset link is used.

## Forgotten password

1. A different owner opens **Staff accounts**.
2. Select **Issue temp password** beside the staff account.
3. Copy the password before leaving the page and give it directly to the staff member.
4. The staff member signs in and is forced to create and confirm a new private password.

## Security model

- The browser only sends an authenticated request to the protected `manage-staff` Edge Function.
- The server secret remains inside Supabase.
- The function verifies that the caller is an active owner before every action.
- Staff changes are recorded in `staff_account_events`.
- Disabled profiles cannot load the portal or location data.
- Owners cannot disable, demote, or reset themselves from this screen.
