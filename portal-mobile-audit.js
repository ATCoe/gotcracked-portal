(() => {
  'use strict';
  if (document.querySelector('link[data-gc-mobile-audit]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'portal-mobile-audit.css?v=20260826-audit1';
  link.dataset.gcMobileAudit = 'true';
  document.head.appendChild(link);
})();
