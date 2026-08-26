# GotCracked Google Integration Setup

The Portal code and Supabase integration are already deployed. This document covers the one-time Google-account configuration that cannot be created by the application itself.

## Production endpoints

- Portal: `https://portal.gotcracked.co`
- Website: `https://gotcracked.co`
- OAuth callback: `https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/google-integrations?action=callback`
- Search Console domain property: `sc-domain:gotcracked.co`

## 1. Google Cloud project

Create or select a Google Cloud project owned by GotCracked. Configure the Google Auth Platform branding with:

- App name: `GotCracked Portal`
- Home page: `https://gotcracked.co`
- Privacy policy: `https://gotcracked.co/privacy.html`

If the GotCracked Google account is managed by a Google Workspace / Cloud Identity organization and the Portal is for organization users only, use an Internal OAuth app. Otherwise configure an External app and complete the Google verification requirements appropriate to the requested scopes before treating the integration as permanent production authorization.

## 2. Enable Google APIs

Enable:

- Google Search Console API
- Google Analytics Data API

Google Business Profile API access requires Google approval for the Cloud project before the Business Profile APIs can be used. Request Basic API Access with the Google account that owns or manages the GotCracked Business Profile, then enable the applicable Business Profile APIs after approval.

The Portal requests these minimum scopes:

- `openid`
- `email`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/business.manage`

## 3. Create OAuth credentials

Create an OAuth Client ID with application type **Web application**.

Add this exact Authorized redirect URI:

`https://uvpmmbioerejeyybfntb.supabase.co/functions/v1/google-integrations?action=callback`

The redirect URI must match exactly.

## 4. Store the OAuth credentials in Supabase

In the GotCracked Supabase project, open Edge Functions secret management and add:

- `GOOGLE_OAUTH_CLIENT_ID` = the Google Web client ID
- `GOOGLE_OAUTH_CLIENT_SECRET` = the Google Web client secret

Never put either value in GitHub, `business_settings`, browser JavaScript, or any public website file. Supabase Edge Function secrets become available to deployed functions without a code redeploy.

## 5. Configure Search Console

Create or verify the Domain property for `gotcracked.co`. The Portal is already configured to query it as:

`sc-domain:gotcracked.co`

The Google account connected to the Portal must have access to that Search Console property.

## 6. Configure Google Analytics 4

Create or select the GA4 property for `gotcracked.co` and its Web data stream. In Portal **Settings → Google & web**, save both:

- GA4 Measurement ID, format `G-XXXXXXXXXX` — this activates the website analytics tag.
- GA4 Property ID, numeric — this lets the Portal query Analytics Data API reports.

The public website analytics loader remains dormant until a valid Measurement ID is saved. It disables Google advertising signals and ad-personalization signals and does not start when a supported browser sends Do Not Track.

## 7. Connect the Google account

Open Portal **Settings → Google & web → Connect Google account** and authorize the GotCracked Google account.

After authorization, the Portal can display Search Console and GA4 metrics. Business Profile API data becomes available once Google has approved the Cloud project for Business Profile API access and the connected Google account has access to the GotCracked Business Profile.

## Google Business Profile listing

If a GotCracked Business Profile has not been created and verified yet, create/claim the real business listing first. Keep its public hours aligned with the canonical hours in Portal Settings.

Do not create fake/test Business Profile locations for API testing.
