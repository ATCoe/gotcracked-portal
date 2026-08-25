const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";

window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

const PORTAL_V1_FINAL_VERSION = '20260825-v1final5';
if (!document.querySelector('link[data-gc-v1-final]')) {
  const finalCss = document.createElement('link');
  finalCss.rel = 'stylesheet';
  finalCss.href = `portal-v1-final.css?v=${PORTAL_V1_FINAL_VERSION}`;
  finalCss.dataset.gcV1Final = 'true';
  document.head.appendChild(finalCss);
}

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
      [`portal-v1-polish.js?v=${version}`, 'gcPortalPolish'],
      [`portal-v1-final.js?v=${PORTAL_V1_FINAL_VERSION}`, 'gcV1Final']
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
