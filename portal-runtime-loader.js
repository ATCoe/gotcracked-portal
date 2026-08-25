(() => {
  'use strict';

  const VERSION = '20260825-release5';
  const scripts = [
    'leads.js',
    'portal-live.js',
    'workforce.js',
    'analytics.js',
    'shipping.js',
    'inventory-audit.js',
    'operations-v1-core.js',
    'training-store-guard.js',
    'operations-v1-arrival.js',
    'portal-v1-polish.js',
    'portal-v1-final.js',
    'master-directory.js'
  ];

  let started = false;

  function srcFor(file) {
    return `${file}?v=${VERSION}`;
  }

  function preload() {
    for (const file of scripts) {
      const href = srcFor(file);
      if (document.querySelector(`link[data-gc-runtime-preload="${file}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = href;
      link.dataset.gcRuntimePreload = file;
      document.head.appendChild(link);
    }
  }

  function loadScript(file) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-gc-runtime="${file}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = srcFor(file);
      script.async = false;
      script.dataset.gcRuntime = file;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${file}`)), { once: true });
      document.body.appendChild(script);
    });
  }

  async function startRuntime() {
    if (started) return;
    started = true;
    preload();

    try {
      for (const file of scripts) await loadScript(file);
      document.dispatchEvent(new CustomEvent('gc-portal-runtime-ready'));
    } catch (error) {
      console.error('Portal runtime load failed:', error);
      started = false;
    }
  }

  function scheduleStart() {
    const run = () => startRuntime();
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 350 });
    } else {
      setTimeout(run, 120);
    }
  }

  function watchLoginState() {
    const login = document.getElementById('login-screen');
    if (!login) return;

    if (login.classList.contains('hidden')) {
      scheduleStart();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!login.classList.contains('hidden')) return;
      observer.disconnect();
      scheduleStart();
    });
    observer.observe(login, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchLoginState, { once: true });
  } else {
    watchLoginState();
  }
})();
