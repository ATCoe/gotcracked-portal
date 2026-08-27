(() => {
  'use strict';

  if (!document.querySelector('link[data-gc-mobile-audit]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'portal-mobile-audit.css?v=20260826-audit2';
    link.dataset.gcMobileAudit = 'true';
    document.head.appendChild(link);
  }

  function normalizeIntakeGuidance() {
    const body = document.querySelector('#v1-intake-dialog .v1-intake-body');
    if (!body) return;
    const note = body.querySelector(':scope > .v1-intake-guidance');
    if (!note) return;

    const heading = body.querySelector(':scope > h3');
    const intro = heading?.nextElementSibling?.matches('p') ? heading.nextElementSibling : null;

    // Validation belongs with the step instructions, never above/inside the title.
    if (intro && note.previousElementSibling !== intro) intro.insertAdjacentElement('afterend', note);
    else if (heading && !intro && note.previousElementSibling !== heading) heading.insertAdjacentElement('afterend', note);
  }

  function loadScript(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset[marker] = 'true';
      script.addEventListener('load', resolve, { once:true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once:true });
      document.body.appendChild(script);
    });
  }

  async function loadMarlon() {
    if (!document.querySelector('link[data-gc-marlon-style]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'marlon-assistant.css?v=20260827-marlon1';
      style.dataset.gcMarlonStyle = 'true';
      document.head.appendChild(style);
    }
    await loadScript('marlon-config.js?v=20260827-marlon1', 'gcMarlonConfig');
    await loadScript('marlon-assistant.js?v=20260827-marlon1', 'gcMarlonRuntime');
  }

  const observer = new MutationObserver(() => normalizeIntakeGuidance());
  const start = () => {
    normalizeIntakeGuidance();
    observer.observe(document.body, { childList:true, subtree:true });
    loadMarlon().catch(error => window.GotCrackedDiagnostics?.error?.(error, { context:'Marlon Employee Support failed to load' }));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
