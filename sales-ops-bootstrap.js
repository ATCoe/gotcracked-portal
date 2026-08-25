(() => {
  'use strict';
  const VERSION = '20260825-release10';
  for (const file of ['sales-ops.css','checkout-receipts.css']) {
    if (document.querySelector(`link[data-gc-finance-style="${file}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${file}?v=${VERSION}`;
    link.dataset.gcFinanceStyle = file;
    document.head.appendChild(link);
  }
})();

