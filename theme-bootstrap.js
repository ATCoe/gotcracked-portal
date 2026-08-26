(() => {
  'use strict';

  // This file intentionally runs synchronously in <head>. It owns two things
  // that must happen before the browser's first paint:
  // 1) resolve the saved/system theme;
  // 2) keep the authenticated app shell hidden until the current Portal runtime
  //    has hydrated the staff profile and the current view.
  const root = document.documentElement;
  root.dataset.gcPortalBoot = 'loading';

  // This is a synchronous pre-paint guard, not a late visual override. Keeping
  // it here prevents the legacy static shell from flashing before the 1.0
  // runtime has finished replacing/hydrating its content.
  const bootStyle = document.createElement('style');
  bootStyle.id = 'gc-portal-boot-style';
  bootStyle.textContent = `
    html[data-gc-portal-boot="loading"] .app-shell{
      opacity:0!important;
      visibility:hidden!important;
      pointer-events:none!important;
    }
    html[data-gc-portal-boot="ready"] .app-shell,
    html[data-gc-portal-boot="error"] .app-shell{
      opacity:1;
      visibility:visible;
    }
    html[data-gc-portal-boot="ready"] .app-shell{
      animation:gcPortalReveal .14s ease-out both;
    }
    @keyframes gcPortalReveal{from{opacity:0}to{opacity:1}}
    @media (prefers-reduced-motion:reduce){
      html[data-gc-portal-boot="ready"] .app-shell{animation:none}
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