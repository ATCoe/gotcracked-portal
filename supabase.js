const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";

window.supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

/*
 * Portal 1.0 bootstrap request coalescing.
 *
 * Several legacy modules initialize from the same Supabase session. On a cold
 * mobile load they can ask Auth for the same user and ask manage-staff for the
 * same list at nearly the same moment. Coalesce only those identical startup
 * reads; this does not bypass Auth, change RLS, or cache mutations.
 */
(() => {
  const client = window.supabaseClient;
  if (!client || client.__gcBootstrapCoalesced) return;
  client.__gcBootstrapCoalesced = true;

  const originalGetUser = client.auth.getUser.bind(client.auth);
  let userInFlight = null;
  let userCache = null;
  let userCacheAt = 0;
  const USER_TTL_MS = 1800;

  client.auth.getUser = (...args) => {
    // Preserve explicit-token getUser() semantics exactly.
    if (args.length) return originalGetUser(...args);

    const now = Date.now();
    if (userCache && now - userCacheAt < USER_TTL_MS) {
      return Promise.resolve(userCache);
    }
    if (userInFlight) return userInFlight;

    userInFlight = originalGetUser()
      .then(result => {
        if (!result?.error && result?.data?.user) {
          userCache = result;
          userCacheAt = Date.now();
        }
        return result;
      })
      .finally(() => { userInFlight = null; });

    return userInFlight;
  };

  const originalInvoke = client.functions.invoke.bind(client.functions);
  let staffListInFlight = null;
  let staffListCache = null;
  let staffListCacheAt = 0;
  const STAFF_LIST_TTL_MS = 1200;

  client.functions.invoke = (functionName, options = {}) => {
    const isStaffList = functionName === 'manage-staff' && options?.body?.action === 'list';

    if (!isStaffList) {
      const result = originalInvoke(functionName, options);
      // Any staff mutation invalidates the tiny list cache immediately.
      if (functionName === 'manage-staff') {
        staffListCache = null;
        staffListCacheAt = 0;
      }
      return result;
    }

    const now = Date.now();
    if (staffListCache && now - staffListCacheAt < STAFF_LIST_TTL_MS) {
      return Promise.resolve(staffListCache);
    }
    if (staffListInFlight) return staffListInFlight;

    staffListInFlight = originalInvoke(functionName, options)
      .then(result => {
        if (!result?.error) {
          staffListCache = result;
          staffListCacheAt = Date.now();
        }
        return result;
      })
      .finally(() => { staffListInFlight = null; });

    return staffListInFlight;
  };

  client.auth.onAuthStateChange(event => {
    if (['SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      userCache = null;
      userCacheAt = 0;
    }
    if (event === 'SIGNED_OUT') {
      staffListCache = null;
      staffListCacheAt = 0;
    }
  });
})();

// CSS is intentionally static in index.html. Do not dynamically append release
// styles here: portal-v1-release.css must remain the final stylesheet.
const PORTAL_V1_FINAL_VERSION = '20260825-release4';
const MASTER_DIRECTORY_VERSION = '20260825-release4';

// Portal 1.0 operations is intentionally loaded after all legacy modules so it
// can become the authoritative workflow UI without breaking existing auth.
window.addEventListener('load', () => {
  if (document.querySelector('script[data-gc-operations-v1]')) return;
  const version = '20260825-release4';
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
