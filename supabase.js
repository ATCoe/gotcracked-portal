const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";

window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/*
 * Portal 1.0 bootstrap request coalescing.
 * Multiple legacy/runtime modules can initialize from the same authenticated
 * session. Identical short-lived startup reads share one request; mutations,
 * explicit-token auth calls, RLS, and permission checks are unchanged.
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
    if (args.length) return originalGetUser(...args);

    const now = Date.now();
    if (userCache && now - userCacheAt < USER_TTL_MS) return Promise.resolve(userCache);
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
      if (functionName === 'manage-staff') {
        staffListCache = null;
        staffListCacheAt = 0;
      }
      return result;
    }

    const now = Date.now();
    if (staffListCache && now - staffListCacheAt < STAFF_LIST_TTL_MS) return Promise.resolve(staffListCache);
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
