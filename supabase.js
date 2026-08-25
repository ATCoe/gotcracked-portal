const SUPABASE_URL = "https://uvpmmbioerejeyybfntb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CmcUD2ze8lhj4HvlMfoYiQ_DGG_xabb";
const GC_AUTH_STORAGE_KEY = "sb-uvpmmbioerejeyybfntb-auth-token";

/*
 * Never let a stalled auth refresh freeze the Portal for minutes. Normal REST
 * requests receive a generous timeout; auth requests fail fast enough that the
 * login screen can recover through Discord instead of appearing hung.
 */
function gotCrackedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || input || '');
  const timeoutMs = url.includes('/auth/v1/') ? 10000 : 20000;
  const controller = new AbortController();
  const upstreamSignal = init.signal;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once:true });
  }

  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'AbortError')), timeoutMs);
  return fetch(input, { ...init, signal:controller.signal }).finally(() => clearTimeout(timer));
}

window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  { global: { fetch: gotCrackedFetch } }
);

/*
 * Single authoritative session restore.
 *
 * A still-valid persisted access token can be used immediately without waiting
 * on the Supabase cross-tab refresh lock. Expired sessions fall through to one
 * shared original getSession() call. We also replace the public getSession()
 * method with this single-flight wrapper so legacy modules cannot create a
 * second competing refresh path.
 */
(() => {
  const client = window.supabaseClient;
  const originalGetSession = client.auth.getSession.bind(client.auth);
  let sessionPromise = null;
  let lastSessionResult = null;
  let restoreCooldownUntil = 0;
  const SESSION_RESTORE_DEADLINE_MS = 11000;

  function readPersistedSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(GC_AUTH_STORAGE_KEY) || 'null');
      if (!stored?.access_token || !stored?.user?.id) return null;
      const expiresAt = Number(stored.expires_at || 0);
      if (!expiresAt || expiresAt * 1000 <= Date.now() + 60000) return null;
      return stored;
    } catch {
      return null;
    }
  }

  function timeoutResult() {
    const error = new Error('Remembered session restore timed out. Continue with Discord to reconnect.');
    error.code = 'GC_SESSION_TIMEOUT';
    return { session:null, error, source:'timeout' };
  }

  async function restoreSession({ force = false } = {}) {
    if (!force) {
      const persisted = readPersistedSession();
      if (persisted) {
        const result = { session:persisted, error:null, source:'persisted' };
        lastSessionResult = result;
        return result;
      }
      if (lastSessionResult?.session) return lastSessionResult;
      if (sessionPromise) return sessionPromise;
      if (Date.now() < restoreCooldownUntil) return timeoutResult();
    }

    const underlying = originalGetSession()
      .then(({ data, error }) => ({ session:data?.session || null, error:error || null, source:'supabase' }))
      .catch(error => ({ session:null, error, source:'supabase' }));

    // If a browser Web Lock is held by another Portal tab, the underlying
    // promise can wait even before fetch() begins. Race the whole restore, not
    // just the network request, so desktop can never be trapped behind it.
    sessionPromise = Promise.race([
      underlying,
      new Promise(resolve => setTimeout(() => resolve(timeoutResult()), SESSION_RESTORE_DEADLINE_MS))
    ]).then(result => {
      if (result.session) lastSessionResult = result;
      if (result.source === 'timeout') restoreCooldownUntil = Date.now() + 15000;
      return result;
    }).finally(() => { sessionPromise = null; });

    // A late successful restore is still useful for the next operation, even if
    // the UI already fell back to the login screen.
    underlying.then(result => {
      if (result?.session) {
        lastSessionResult = result;
        restoreCooldownUntil = 0;
      }
    }).catch(() => {});

    return sessionPromise;
  }

  function clear() {
    lastSessionResult = null;
    sessionPromise = null;
    restoreCooldownUntil = 0;
  }

  client.auth.getSession = async () => {
    const result = await restoreSession();
    return { data:{ session:result.session || null }, error:result.error || null };
  };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') return clear();
    if (session && ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
      lastSessionResult = { session, error:null, source:'auth-event' };
      restoreCooldownUntil = 0;
    }
  });

  window.GotCrackedAuth = { restoreSession, readPersistedSession, clear };
})();

/*
 * Portal 1.0 bootstrap request coalescing.
 * Multiple operational modules can initialize from the same authenticated
 * session. Identical short-lived reads share one request; mutations and RLS are
 * unchanged.
 */
(() => {
  const client = window.supabaseClient;
  if (!client || client.__gcBootstrapCoalesced) return;
  client.__gcBootstrapCoalesced = true;

  const originalGetUser = client.auth.getUser.bind(client.auth);
  let userInFlight = null;
  let userCache = null;
  let userCacheAt = 0;
  const USER_TTL_MS = 3000;

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
  const STAFF_LIST_TTL_MS = 2500;

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
    if (['SIGNED_OUT','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
      userCache = null;
      userCacheAt = 0;
    }
    if (event === 'SIGNED_OUT') {
      staffListCache = null;
      staffListCacheAt = 0;
    }
  });
})();

/*
 * Returning-session shell fast path.
 *
 * This is intentionally storage-first. It never initiates a token refresh just
 * to decide whether the login overlay can disappear. workflow.js still reloads
 * the live profile and RLS still protects every shop query.
 */
(() => {
  const persisted = window.GotCrackedAuth?.readPersistedSession?.();
  if (!persisted?.user?.id) return;

  let cachedStaff = null;
  try {
    cachedStaff = JSON.parse(sessionStorage.getItem('gotcracked-staff') || 'null');
  } catch {
    cachedStaff = null;
  }
  if (!cachedStaff || cachedStaff.id !== persisted.user.id) return;

  const login = document.getElementById('login-screen');
  if (login) login.classList.add('hidden');

  const name = document.getElementById('staff-name');
  const role = document.getElementById('staff-role');
  const initials = document.getElementById('staff-initials');
  if (name) name.textContent = cachedStaff.name || 'Staff';
  if (role) role.textContent = cachedStaff.role || 'Staff';
  if (initials) {
    initials.textContent = (cachedStaff.name || 'Staff')
      .split(' ')
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0,2)
      .toUpperCase();
  }

  document.dispatchEvent(new CustomEvent('gc-session-shell-restored', {
    detail:{ userId:persisted.user.id }
  }));
})();
