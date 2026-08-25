(() => {
  'use strict';
  if (document.querySelector('link[data-gc-sales-ops]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'sales-ops.css?v=20260825-release7';
  link.dataset.gcSalesOps = 'true';
  document.head.appendChild(link);
})();
