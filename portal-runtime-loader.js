(() => {
  'use strict';

  const VERSION = '20260825-release18';
  const PROFILE_READY_TIMEOUT_MS = 15000;

  // Apply the remembered/system theme before the authenticated runtime starts so
  // returning staff do not see the Portal flash between light and dark modes.
  try {
    const saved = localStorage.getItem('gc-portal-theme');
    const preference = ['light','dark','system'].includes(saved) ? saved : 'system';
    const resolved = preference === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
  } catch {}

  if (!document.querySelector('link[data-gc-theme-style]')) {
    const theme = document.createElement('link');
    theme.rel = 'stylesheet';
    theme.href = `portal-theme.css?v=${VERSION}`;
    theme.dataset.gcThemeStyle = 'true';
    document.head.appendChild(theme);
  }

  // Runtime order is intentional. Training Store synchronization must hydrate
  // before Operations reads sandbox state. Operations must then finish profile
  // hydration before any older/live module that dereferences profile.location_id
  // is allowed to attach its handlers.
  const criticalScripts = [
    'theme-controller.js',
    'training-shared-sync.js',
    'operations-v1-core.js',
    'portal-live.js',
    'training-store-guard.js',
    'operations-v1-arrival.js',
    'portal-v1-polish.js',
    'portal-v1-final.js',
    'intake-modal-release.js',
    'master-directory.js',
    'cross-user-sync.js',
    'sales-ops-bootstrap.js',
    'sales-ops.js',
    'checkout-receipts.js'
  ];

  const deferredScripts = [
    'leads.js',
    'workforce.js',
    'analytics.js',
    'shipping.js',
    'inventory-audit.js'
  ];

  const viewDependencies = {
    leads: ['leads.js'],
    staff: ['workforce.js'],
    reports: ['analytics.js'],
    shipping: ['shipping.js'],
    inventory: ['inventory-audit.js'],
    settings: ['pricing-settings.js']
  };

  let started = false;
  let deferredStarted = false;
  let profileReady = null;
  const loading = new Map();

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function srcFor(file) {
    return `${file}?v=${VERSION}`;
  }

  function preload(files) {
    for (const file of files) {
      if (document.querySelector(`link[data-gc-runtime-preload="${file}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = srcFor(file);
      link.dataset.gcRuntimePreload = file;
      document.head.appendChild(link);
    }
  }

  function loadScript(file) {
    if (document.querySelector(`script[data-gc-runtime="${file}"]`)) return Promise.resolve();
    if (loading.has(file)) return loading.get(file);

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = srcFor(file);
      script.async = false;
      script.dataset.gcRuntime = file;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${file}`)), { once: true });
      document.body.appendChild(script);
    }).finally(() => loading.delete(file));

    loading.set(file, promise);
    return promise;
  }

  async function waitForOperationsProfile() {
    if (profileReady?.id && profileReady?.location_id) return profileReady;

    const startedAt = Date.now();
    while (Date.now() - startedAt < PROFILE_READY_TIMEOUT_MS) {
      const profile = window.GotCrackedOperationsV1?.state?.profile || null;
      if (profile?.id && profile?.location_id && profile.active !== false) {
        profileReady = profile;
        window.GotCrackedRuntimeProfile = profile;
        document.documentElement.dataset.gcProfileReady = 'true';
        return profile;
      }
      await delay(100);
    }

    throw new Error('Staff profile did not finish loading. Refresh the Portal and try again.');
  }

  async function loadSequence(files) {
    for (const file of files) {
      // Any module after Operations is profile-dependent. Never let it attach
      // handlers while the shared staff profile is still null.
      if (file !== 'theme-controller.js' && file !== 'training-shared-sync.js' && file !== 'operations-v1-core.js') {
        await waitForOperationsProfile();
      }

      await loadScript(file);

      if (file === 'training-shared-sync.js' && window.GotCrackedTrainingSync?.ready) {
        await window.GotCrackedTrainingSync.ready;
      }
      if (file === 'operations-v1-core.js') {
        await waitForOperationsProfile();
      }
    }
  }

  async function startCriticalRuntime() {
    if (started) return;
    started = true;
    document.documentElement.dataset.gcRuntimeState = 'starting';
    preload(criticalScripts);

    try {
      await loadSequence(criticalScripts);
      document.documentElement.dataset.gcRuntimeState = 'ready';
      document.dispatchEvent(new CustomEvent('gc-portal-runtime-ready', { detail:{ profile:profileReady } }));
      scheduleDeferredRuntime();
    } catch (error) {
      console.error('Portal critical runtime load failed:', error);
      document.documentElement.dataset.gcRuntimeState = 'error';
      window.GotCrackedDiagnostics?.error?.(error, { context:'Portal staff profile initialization failed', duration:20000 });
      started = false;
    }
  }

  async function startDeferredRuntime() {
    if (deferredStarted) return;
    deferredStarted = true;
    try {
      await waitForOperationsProfile();
      await loadSequence(deferredScripts);
      document.dispatchEvent(new CustomEvent('gc-portal-secondary-runtime-ready'));
    } catch (error) {
      console.error('Portal deferred runtime load failed:', error);
      deferredStarted = false;
    }
  }

  function scheduleDeferredRuntime() {
    const run = () => startDeferredRuntime();
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2600 });
    else setTimeout(run, 1600);
  }

  async function ensureViewRuntime(view) {
    const files = viewDependencies[view] || [];
    if (!files.length) return;
    try {
      await waitForOperationsProfile();
      await loadSequence(files);
    } catch (error) {
      console.error(`Portal ${view} runtime load failed:`, error);
      window.GotCrackedDiagnostics?.error?.(error, { context:`Unable to open ${view}` });
    }
  }

  function scheduleCriticalStart() {
    const run = () => startCriticalRuntime();
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function watchLoginState() {
    const login = document.getElementById('login-screen');
    if (!login) return;
    if (login.classList.contains('hidden')) { scheduleCriticalStart(); return; }

    const observer = new MutationObserver(() => {
      if (!login.classList.contains('hidden')) return;
      observer.disconnect();
      scheduleCriticalStart();
    });
    observer.observe(login, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('[data-view]') : null;
    const view = target?.dataset.view;
    if (view) ensureViewRuntime(view);
  }, true);

  window.addEventListener('hashchange', () => {
    const view = location.hash.slice(1).split('/')[0];
    if (view) ensureViewRuntime(view);
  });

  window.GotCrackedRuntime = {
    ensureView: ensureViewRuntime,
    startDeferred: startDeferredRuntime,
    waitForProfile: waitForOperationsProfile,
    get profile(){ return profileReady; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLoginState, { once: true });
  else watchLoginState();
})();
