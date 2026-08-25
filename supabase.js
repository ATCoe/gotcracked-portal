const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";

window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// Portal 1.0 operations is intentionally loaded after all legacy modules so it
// can become the authoritative workflow UI without breaking existing auth.
window.addEventListener('load', () => {
  if (document.querySelector('script[data-gc-operations-v1]')) return;
  const version = '20260825-v1ops5';
  const script = document.createElement('script');
  script.src = `operations-v1-core.js?v=${version}`;
  script.async = false;
  script.dataset.gcOperationsV1 = 'true';
  script.addEventListener('load', () => {
    const helpers = [
      [`training-store-guard.js?v=${version}`, 'gcTrainingGuard'],
      [`operations-v1-arrival.js?v=${version}`, 'gcArrivalHelper'],
      [`portal-v1-polish.js?v=${version}`, 'gcPortalPolish']
    ];
    for (const [src, key] of helpers) {
      if (document.querySelector(`script[data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}]`)) continue;
      const helper = document.createElement('script');
      helper.src = src;
      helper.async = false;
      helper.dataset[key] = 'true';
      document.body.appendChild(helper);
    }
  }, { once: true });
  document.body.appendChild(script);
}, { once: true });
