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
  const script = document.createElement('script');
  script.src = 'operations-v1-core.js?v=20260825-v1ops4';
  script.dataset.gcOperationsV1 = 'true';
  script.addEventListener('load', () => {
    if (document.querySelector('script[data-gc-training-guard]')) return;
    const guard = document.createElement('script');
    guard.src = 'training-store-guard.js?v=20260825-v1ops4';
    guard.dataset.gcTrainingGuard = 'true';
    document.body.appendChild(guard);
  }, { once: true });
  document.body.appendChild(script);
}, { once: true });
