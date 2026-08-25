# Deploying the password reset update

1. Replace the matching files in your Cloudflare Pages project with this folder's contents, including the `assets` folder.
2. Deploy the update and note the exact production address, for example `https://portal.gotcracked.co`.
3. In Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to that exact Portal address.
   - Add the same address to **Redirect URLs**. The reset flow returns to the Portal root, so do not add a separate reset page path.
4. In Supabase, open **Authentication → Email Templates → Reset Password** and make sure the template uses `{{ .ConfirmationURL }}`. The default template does.
5. Test using a real staff account: select **Forgot password**, submit the account email, follow the email link, set a new password, then sign in.

## Important email note

Cloudflare Email Routing forwards mail *received* by `support@gotcracked.co`; it is not an outbound SMTP service. Supabase can send reset messages using its default email service. If you want reset messages to appear as `support@gotcracked.co`, configure a separate authenticated outbound SMTP provider in Supabase before enabling this for staff.
