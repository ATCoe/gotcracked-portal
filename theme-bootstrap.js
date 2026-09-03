(() => {
  'use strict';

  // This file intentionally runs synchronously in <head>. It resolves the
  // saved/system theme before first paint and leaves the real Portal shell
  // visible while authentication and data hydrate. A blank staff screen is a
  // worse experience than a clearly labelled, non-interactive loading state.
  const root = document.documentElement;
  root.dataset.gcPortalBoot = 'loading';

  // Earliest possible, zero-interference input trace. This is registered before
  // every other Portal script so we can prove exactly how far a browser event
  // propagates before later application listeners get a chance to act on it.
  // These listeners never preventDefault(), stopPropagation(), or mutate the UI.
  const earlyTrace = window.__gcEarlyInputTrace = {
    version: '20260826-early1',
    seq: 0,
    last: 'none',
    history: []
  };

  const describeTarget = node => {
    if (!(node instanceof Element)) return String(node?.nodeName || 'none');
    const id = node.id ? `#${node.id}` : '';
    const classes = [...node.classList].slice(0, 3).map(value => `.${value}`).join('');
    const flags = [
      node.hasAttribute('data-v1-walkin') ? '[walkin]' : '',
      node.hasAttribute('data-open-ticket') ? '[open-ticket]' : '',
      node.classList.contains('mobile-menu') ? '[menu]' : '',
      node.hasAttribute('data-v1-new-lead') ? '[new-lead]' : ''
    ].filter(Boolean).join('');
    return `${node.tagName.toLowerCase()}${id}${classes}${flags}`;
  };

  const markEarlyInput = (stage, event) => {
    let x = Number.isFinite(event.clientX) ? Math.round(event.clientX) : null;
    let y = Number.isFinite(event.clientY) ? Math.round(event.clientY) : null;
    if ((x === null || y === null) && event.touches?.[0]) {
      x = Math.round(event.touches[0].clientX);
      y = Math.round(event.touches[0].clientY);
    }
    const row = `${++earlyTrace.seq}:${stage}:${event.type}:${describeTarget(event.target)}${x === null ? '' : `@${x},${y}`} dp=${event.defaultPrevented ? 1 : 0}`;
    earlyTrace.last = row;
    earlyTrace.history.push(row);
    if (earlyTrace.history.length > 16) earlyTrace.history.shift();
  };

  const inputTypes = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click'];
  for (const type of inputTypes) {
    window.addEventListener(type, event => markEarlyInput('W-CAP', event), true);
    document.addEventListener(type, event => markEarlyInput('D-CAP', event), true);
    document.addEventListener(type, event => markEarlyInput('D-BUB', event), false);
    window.addEventListener(type, event => markEarlyInput('W-BUB', event), false);
  }

  // Keep the first-paint shell non-interactive until its runtime is ready, but
  // never hide it. The static markup is the same current Portal design and
  // includes labelled loading content; it is not a legacy overlay.
  const bootStyle = document.createElement('style');
  bootStyle.id = 'gc-portal-boot-style';
  bootStyle.textContent = `
    html[data-gc-portal-boot="loading"] .app-shell{ pointer-events:none!important; }
    html[data-gc-portal-boot="ready"] .app-shell,
    html[data-gc-portal-boot="error"] .app-shell{
      opacity:1;
      visibility:visible;
      pointer-events:auto;
    }
  `;
  document.head.appendChild(bootStyle);

  try {
    const key = 'gc-portal-theme';
    const saved = localStorage.getItem(key);
    const preference = ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
    const resolved = preference === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;

    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    root.dataset.gcThemeBootstrap = 'ready';
  } catch {
    root.dataset.theme = 'light';
    root.dataset.themePreference = 'system';
    root.style.colorScheme = 'light';
    root.dataset.gcThemeBootstrap = 'ready';
  }
})();

