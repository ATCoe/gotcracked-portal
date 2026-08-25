const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";

window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// CSS is intentionally static in index.html. Do not dynamically append release
// styles here: portal-v1-release.css must remain the final stylesheet.
const PORTAL_V1_FINAL_VERSION = '20260825-release3';
const MASTER_DIRECTORY_VERSION = '20260825-release3';

// Portal 1.0 operations is intentionally loaded after all legacy modules so it
// can become the authoritative workflow UI without breaking existing auth.
window.addEventListener('load', () => {
  if (document.querySelector('script[data-gc-operations-v1]')) return;
  const version = '20260825-release3';
  const script = document.createElement('script');
  script.src = `operations-v1-core.js?v=${version}`;
  script.async = false;
  script.dataset.gcOperationsV1 = 'true';
  script.addEventListener('load', () => {
    const helpers = [
      [`training-store-guard.js?v=${version}`, 'gcTrainingGuard'],
      [`operations-v1-arrival.js?v=${version}`, 'gcArrivalHelper'],
      [`portal-v1-polish.js?v=${version}`, 'gcPortalPolish'],
      [`portal-v1-final.js?v=${PORTAL_V1_FINAL_VERSION}`, 'gcV1Final'],
      [`master-directory.js?v=${MASTER_DIRECTORY_VERSION}`, 'gcMasterDirectory']
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