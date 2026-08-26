(() => {
  'use strict';

  // This file intentionally runs synchronously in <head>. It is tiny and only
  // resolves the saved/system theme so the browser never paints the legacy
  // light shell before the final theme CSS is available.
  try {
    const key = 'gc-portal-theme';
    const saved = localStorage.getItem(key);
    const preference = ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
    const resolved = preference === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;

    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.dataset.gcThemeBootstrap = 'ready';
  } catch {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.themePreference = 'system';
    document.documentElement.style.colorScheme = 'light';
    document.documentElement.dataset.gcThemeBootstrap = 'ready';
  }
})();
