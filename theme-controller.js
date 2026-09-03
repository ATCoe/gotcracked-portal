(() => {
  'use strict';

  if (window.GotCrackedTheme) return;

  const KEY = 'gc-portal-theme';
  const COMPONENT_STYLE_VERSION = '20260825-dark3';
  const SWITCH_STYLE_VERSION = '20260825-switch2';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');

  function ensureStyle(selector, href, dataKey, dataValue) {
    const existing = document.querySelector(selector);
    if (existing) return existing;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset[dataKey] = dataValue;
    document.head.appendChild(link);
    return link;
  }

  function ensureComponentStyles() {
    // These are normally present in index.html before first paint. Keep these
    // fallbacks for old cached shells without making runtime injection the
    // normal rendering path.
    ensureStyle(
      'link[data-gc-dark-components]',
      `portal-dark-components.css?v=${COMPONENT_STYLE_VERSION}`,
      'gcDarkComponents',
      'true'
    );
    ensureStyle(
      'link[data-gc-theme-switch]',
      `theme-switch.css?v=${SWITCH_STYLE_VERSION}`,
      'gcThemeSwitch',
      'true'
    );
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
    const preference = savedPreference();
    const resolved = document.documentElement.dataset.theme || resolvedTheme(preference);
    const isDark = resolved === 'dark';
    const next = isDark ? 'light' : 'dark';

    button.classList.toggle('is-dark', isDark);
    button.innerHTML = '<span class="theme-switch-track" aria-hidden="true"><span class="theme-switch-symbol sun">☀</span><span class="theme-switch-symbol moon">☾</span><span class="theme-switch-thumb"></span></span>';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', isDark ? 'true' : 'false');
    button.setAttribute('aria-label', `Dark mode ${isDark ? 'on' : 'off'}. Switch to ${next} mode.`);
    button.setAttribute('title', preference === 'system'
      ? `Following device theme · tap for ${next} mode`
      : `Switch to ${next} mode`);
  }

  function removeDeadTopbarControls(actions) {
    actions?.querySelector('.icon-button[aria-label="Notifications"]')?.remove();
    actions?.querySelector('.help')?.remove();
  }

  function bindButton(button) {
    if (!button || button.dataset.gcThemeBound === 'true') return;
    button.dataset.gcThemeBound = 'true';
    button.type = 'button';
    button.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme || resolvedTheme();
      apply(current === 'dark' ? 'light' : 'dark', { persist:true });
    });
  }

  function ensureButton() {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    removeDeadTopbarControls(actions);
    let button = document.getElementById('gc-theme-toggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'gc-theme-toggle';
      button.className = 'theme-toggle';
      actions.prepend(button);
    }
    bindButton(button);
    updateButton();
  }

  function onRuntimeReady(event) {
    ensureButton();
  }

  media?.addEventListener?.('change', () => {
    if (savedPreference() === 'system') apply('system');
  });

  ensureComponentStyles();
  document.addEventListener('gc-portal-runtime-ready', onRuntimeReady, { once:false });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once:true });
  else ensureButton();

  apply(savedPreference());

  window.GotCrackedTheme = {
    get preference(){ return savedPreference(); },
    get resolved(){ return document.documentElement.dataset.theme || resolvedTheme(); },
    set(preference){ return apply(preference, { persist:true }); },
    reset(){ localStorage.removeItem(KEY); return apply('system'); },
    ensureButton,
  };
})();

