# Deploying the password reset update

## Required database update before this portal release

Deploy the updated portal files first. Immediately afterward, run `supabase/migrations/0002_staff_first_login_password.sql` once in the Supabase SQL Editor. It adds the first-login flag, marks every existing staff profile (including owners) for mandatory setup, and adds the narrowly scoped function that clears the flag only after Supabase accepts the staff member's new password.

Every existing profile and every new profile is required to create a private password before the dashboard loads. Deploying the code before running the migration prevents existing users from being sent into an unsupported setup flow during the release window.

1. Replace the matching files in your Cloudflare Pages project with this folder's contents, including the `assets` folder.
2. Deploy the update and note the exact production address, for example `https://portal.gotcracked.co`.
3. In Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to that exact Portal address.
   - Add the same address to **Redirect URLs**. The reset flow returns to the Portal root, so do not add a separate reset page path.
4. In Supabase, open **Authentication → Email Templates → Reset Password** and make sure the template uses `{{ .ConfirmationURL }}`. The default template does.
5. Test using a real staff account: select **Forgot password**, submit the account email, follow the email link, set a new password, then sign in.

## Important email note

Cloudflare Email Routing forwards mail *received* by `support@gotcracked.co`; it is not an outbound SMTP service. Supabase can send reset messages using its default email service. If you want reset messages to appear as `support@gotcracked.co`, configure a separate authenticated outbound SMTP provider in Supabase before enabling this for staff.

## Route every staff reset to the monitored inbox

Supabase reset tokens are account-specific and must be sent to the email address used by that staff account. Do not replace the submitted staff email with `support@gotcracked.co`; that would reset only the support account.

Instead, in Cloudflare open **Compute → Email Service → Email Routing → Routing Rules**, enable the **Catch-all** rule, and forward it to the verified Gmail destination already used by `support@gotcracked.co`. Then reset mail for `austin@gotcracked.co`, `tech@gotcracked.co`, and every other staff alias arrives in the same monitored Gmail inbox while the reset token remains tied to the correct login.

Test the catch-all with an external sender before relying on it for account recovery.

## Work-order label printing

See `LABEL_PRINTING.md` for DYMO installation, paper size, print settings, and QR-code behavior.
