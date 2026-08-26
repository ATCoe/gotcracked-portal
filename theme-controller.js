(() => {
  'use strict';

  if (window.GotCrackedTheme) return;

  const KEY = 'gc-portal-theme';
  const COMPONENT_STYLE_VERSION = '20260825-dark2';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');

  function ensureComponentStyles() {
    if (document.querySelector('link[data-gc-dark-components]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `portal-dark-components.css?v=${COMPONENT_STYLE_VERSION}`;
    link.dataset.gcDarkComponents = 'true';
    document.head.appendChild(link);
  }

  function savedPreference() {
    const saved = localStorage.getItem(KEY);
    return ['light','dark','system'].includes(saved) ? saved : 'system';
  }

  function resolvedTheme(preference = savedPreference()) {
    if (preference === 'dark' || preference === 'light') return preference;
    return media?.matches ? 'dark' : 'light';
  }

  function apply(preference = savedPreference(), { persist = false } = {}) {
    if (!['light','dark','system'].includes(preference)) preference = 'system';
    if (persist) localStorage.setItem(KEY, preference);
    ensureComponentStyles();
    const resolved = resolvedTheme(preference);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    updateButton();
    document.dispatchEvent(new CustomEvent('gc-theme-change', { detail:{ preference, resolved } }));
    return resolved;
  }

  function updateButton() {
    const button = document.getElementById('gc-theme-toggle');
    if (!button) return;
    const resolved = document.documentElement.dataset.theme || resolvedTheme();
    const next = resolved === 'dark' ? 'light' : 'dark';
    button.innerHTML = `<span class="theme-icon" aria-hidden="true">${resolved === 'dark' ? '☀' : '☾'}</span>`;
    button.setAttribute('aria-label', `Switch to ${next} mode`);
    button.setAttribute('title', `Switch to ${next} mode`);
    button.setAttribute('aria-pressed', resolved === 'dark' ? 'true' : 'false');
  }

  function removeDeadTopbarControls(actions) {
    actions?.querySelector('.icon-button[aria-label="Notifications"]')?.remove();
    actions?.querySelector('.help')?.remove();
  }

  function ensureButton() {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    removeDeadTopbarControls(actions);
    if (document.getElementById('gc-theme-toggle')) {
      updateButton();
      return;
    }
    const button = document.createElement('button');
    button.id = 'gc-theme-toggle';
    button.className = 'icon-button theme-toggle';
    button.type = 'button';
    button.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme || resolvedTheme();
      apply(current === 'dark' ? 'light' : 'dark', { persist:true });
    });
    actions.prepend(button);
    updateButton();
  }

  media?.addEventListener?.('change', () => {
    if (savedPreference() === 'system') apply('system');
  });

  ensureComponentStyles();
  document.addEventListener('gc-portal-runtime-ready', ensureButton, { once:false });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once:true });
  else ensureButton();

  apply(savedPreference());

  window.GotCrackedTheme = {
    get preference(){ return savedPreference(); },
    get resolved(){ return document.documentElement.dataset.theme || resolvedTheme(); },
    set(preference){ return apply(preference, { persist:true }); },
    reset(){ localStorage.removeItem(KEY); return apply('system'); },
    ensureButton
  };
})();
