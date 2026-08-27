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

  function loadStyle(href, marker) {
    if (document.querySelector(`link[data-${marker}]`)) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = href;
    style.dataset[marker] = 'true';
    document.head.appendChild(style);
  }

  async function loadMarlon() {
    const version = '20260827-marlon21';
    loadStyle(`marlon-assistant.css?v=${version}`, 'gcMarlonStyle');
    loadStyle(`marlon-extensions.css?v=${version}`, 'gcMarlonExtensions');
    await loadScript(`marlon-config.js?v=${version}`, 'gcMarlonConfig');
    await loadScript(`marlon-assistant.js?v=${version}`, 'gcMarlonRuntime');
    await loadScript(`marlon-support.js?v=${version}`, 'gcMarlonSupport');
    await loadScript(`marlon-approval-gate.js?v=${version}`, 'gcMarlonApprovalGate');
    await loadScript(`staff-badges-v2.js?v=${version}`, 'gcStaffBadges');
    await loadScript(`marlon-releases.js?v=${version}`, 'gcMarlonReleases');
    await loadScript(`marlon-monitor.js?v=${version}`, 'gcMarlonMonitor');
    await loadScript(`parts-registry.js?v=${version}`, 'gcPartsRegistry');
    await loadScript(`mobilesentrix-integration.js?v=${version}`, 'gcMobileSentrixIntegration');
    await loadScript(`pc-build-policy-settings.js?v=${version}`, 'gcPcBuildPolicy');
    const profile = window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
    if (profile) window.dispatchEvent(new CustomEvent('gotcracked:staff-ready', { detail:profile }));
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