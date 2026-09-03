(() => {
  'use strict';
  const load = () => {
    if (window.GotCrackedRmaFlowLabs || document.querySelector('script[data-gc-rma-bootstrap-load]')) return;
    const script = document.createElement('script');
    script.src = 'rma-flow-labs.js?v=20260903-rma-release2';
    script.dataset.gcRmaBootstrapLoad = 'true';
    document.body.appendChild(script);
  };
  document.addEventListener('gc-portal-runtime-ready', load, { once: true });
  if (document.documentElement.dataset.gcPortalBoot === 'ready') load();
})();

