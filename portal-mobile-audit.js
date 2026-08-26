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

  const observer = new MutationObserver(() => normalizeIntakeGuidance());
  const start = () => {
    normalizeIntakeGuidance();
    observer.observe(document.body, { childList:true, subtree:true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
