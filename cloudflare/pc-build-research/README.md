# GotCracked PC-build research worker

This Cloudflare Worker is the untrusted research tier for the Custom PC planner. It receives only the anonymous hardware survey and parts budget. Supabase remains the source of truth for customers, requests, pricing, status, and the final compatibility decision.

Bindings:

- `AI`: Workers AI
- `BROWSER`: Browser Rendering / Browser Run
- `RESEARCH_SHARED_TOKEN`: secret shared only with the Supabase Edge Function

Deploy with `npm ci`, `npm run check`, `npx wrangler secret put RESEARCH_SHARED_TOKEN`, then `npm run deploy`. Save the resulting Worker URL and the same token as `PC_BUILD_RESEARCH_WORKER_URL` and `PC_BUILD_RESEARCH_TOKEN` in Supabase Edge Function secrets.

The worker never signs in, adds to cart, checks out, places an order, or submits customer information. If Browser Run cannot produce a stateful Newegg Builder URL and concrete evidence, it returns `manual_review`; the Supabase function will not release an automated estimate.

