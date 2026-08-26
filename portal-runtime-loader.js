(() => {
  'use strict';

  const VERSION = '20260825-release14';

  // Only the modules needed to make the primary repair/dashboard workspace
  // useful belong on the critical post-auth path. Everything else is deferred
  // until idle time or until its view is requested.
  const criticalScripts = [
    'portal-live.js',
    'training-shared-sync.js',
    'operations-v1-core.js',
    'training-store-guard.js',
    'operations-v1-arrival.js',
    'portal-v1-polish.js',
    'portal-v1-final.js',
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
  const loading = new Map();

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

  async function loadSequence(files) {
    for (const file of files) {
      await loadScript(file);
      if (file === 'training-shared-sync.js' && window.GotCrackedTrainingSync?.ready) {
        await window.GotCrackedTrainingSync.ready;
      }
    }
  }

  async function startCriticalRuntime() {
    if (started) return;
    started = true;
    preload(criticalScripts);

    try {
      await loadSequence(criticalScripts);
      document.dispatchEvent(new CustomEvent('gc-portal-runtime-ready'));
      scheduleDeferredRuntime();
    } catch (error) {
      console.error('Portal critical runtime load failed:', error);
      started = false;
    }
  }

  async function startDeferredRuntime() {
    if (deferredStarted) return;
    deferredStarted = true;
    try {
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
    try { await loadSequence(files); }
    catch (error) { console.error(`Portal ${view} runtime load failed:`, error); }
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

  window.GotCrackedRuntime = { ensureView: ensureViewRuntime, startDeferred: startDeferredRuntime };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLoginState, { once: true });
  else watchLoginState();
})();
