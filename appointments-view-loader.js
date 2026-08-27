(() => {
  'use strict';
  if (window.GotCrackedAppointmentsViewLoader) return;
  window.GotCrackedAppointmentsViewLoader = true;

  const VERSION = '20260827-production8';

  const ensureScript = (file, marker) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (file === 'appointments-board.js' && window.GotCrackedAppointments) resolve();
      else if (file === 'appointments-owner-guard.js' && window.GotCrackedAppointmentsOwnerGuard) resolve();
      else existing.addEventListener('load', resolve, { once:true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${file}?v=${VERSION}`;
    script.async = false;
    script.setAttribute(marker, 'true');
    script.addEventListener('load', resolve, { once:true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${file}`)), { once:true });
    document.body.appendChild(script);
  });

  const load = async () => {
    try {
      if (!window.GotCrackedAppointments) {
        await ensureScript('appointments-board.js', 'data-gc-appointments-board');
      }
      if (!window.GotCrackedAppointmentsOwnerGuard) {
        await ensureScript('appointments-owner-guard.js', 'data-gc-appointments-owner-guard');
      }
      window.GotCrackedAppointmentsOwnerGuard?.restore?.();
    } catch (error) {
      console.error('Appointment fallback runtime failed:', error);
      window.GotCrackedDiagnostics?.error?.(error, { context:'Unable to open appointments' });
    }
  };

  if (location.hash.slice(1).split('/')[0] === 'appointments') load();
  document.addEventListener('gc-view-changed', event => {
    const view = typeof event.detail === 'string' ? event.detail : (event.detail?.view || location.hash.slice(1).split('/')[0]);
    if (view === 'appointments') load();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1).split('/')[0] === 'appointments') load();
  });
})();
