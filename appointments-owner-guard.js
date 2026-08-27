(() => {
  'use strict';

  if (window.GotCrackedAppointmentsOwnerGuard) return;

  let frame = 0;
  let observer = null;

  const activeView = () => location.hash.slice(1).split('/')[0] === 'appointments';
  const host = () => document.getElementById('appointments');
  const premiumMarkupPresent = target => Boolean(target?.querySelector('.gc-appt-shell, .gc-appt-loading'));

  async function restorePremiumView() {
    frame = 0;
    if (!activeView()) return;

    const target = host();
    const appointments = window.GotCrackedAppointments;
    if (!target || !appointments || premiumMarkupPresent(target)) return;

    try {
      await appointments.load({ quiet:true });
    } catch (error) {
      console.error('Appointment command center ownership restore failed:', error);
      window.GotCrackedDiagnostics?.error?.(error, { context:'Appointments could not be restored' });
    }
  }

  function scheduleRestore() {
    if (frame || !activeView()) return;
    frame = requestAnimationFrame(restorePremiumView);
  }

  function observeHost() {
    const target = host();
    if (!target || observer) return;
    observer = new MutationObserver(() => {
      if (activeView() && !premiumMarkupPresent(target)) scheduleRestore();
    });
    observer.observe(target, { childList:true });
  }

  document.addEventListener('gc-view-changed', event => {
    const view = typeof event.detail === 'string'
      ? event.detail
      : (event.detail?.view || location.hash.slice(1).split('/')[0]);
    if (view !== 'appointments') return;
    observeHost();
    scheduleRestore();
  });

  document.addEventListener('gc-cross-user-sync', () => {
    if (activeView()) scheduleRestore();
  });

  window.addEventListener('hashchange', () => {
    if (!activeView()) return;
    observeHost();
    scheduleRestore();
  });

  observeHost();
  if (activeView()) scheduleRestore();

  window.GotCrackedAppointmentsOwnerGuard = {
    version:'20260827-owner1',
    restore:scheduleRestore
  };
})();
