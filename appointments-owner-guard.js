(() => {
  'use strict';

  if (window.GotCrackedAppointmentsOwnerGuard) return;

  let frame = 0;
  let observer = null;

  const activeView = () => location.hash.slice(1).split('/')[0] === 'appointments';
  const host = () => document.getElementById('appointments');
  const premiumMarkupPresent = target => Boolean(target?.querySelector('.gc-appt-shell, .gc-appt-loading'));

  function conceal(target) {
    if (!target) return;
    target.style.setProperty('visibility', 'hidden');
    target.setAttribute('aria-busy', 'true');
  }

  function reveal(target) {
    if (!target) return;
    target.style.removeProperty('visibility');
    target.removeAttribute('aria-busy');
  }

  async function restorePremiumView() {
    frame = 0;
    if (!activeView()) return;

    const target = host();
    const appointments = window.GotCrackedAppointments;
    if (!target || !appointments) return;
    if (premiumMarkupPresent(target)) {
      reveal(target);
      return;
    }

    conceal(target);
    try {
      await appointments.load({ quiet:true });
      if (premiumMarkupPresent(target)) reveal(target);
      else {
        target.innerHTML = '<div class="gc-appt-loading">Loading appointment command center…</div>';
        reveal(target);
        setTimeout(scheduleRestore, 80);
      }
    } catch (error) {
      reveal(target);
      console.error('Appointment command center ownership restore failed:', error);
      window.GotCrackedDiagnostics?.error?.(error, { context:'Appointments could not be restored' });
    }
  }

  function scheduleRestore() {
    if (frame || !activeView()) return;
    const target = host();
    if (target && !premiumMarkupPresent(target)) conceal(target);
    frame = requestAnimationFrame(restorePremiumView);
  }

  function observeHost() {
    const target = host();
    if (!target || observer) return;
    observer = new MutationObserver(() => {
      if (!activeView()) {
        reveal(target);
        return;
      }
      if (premiumMarkupPresent(target)) reveal(target);
      else {
        conceal(target);
        scheduleRestore();
      }
    });
    observer.observe(target, { childList:true });
  }

  document.addEventListener('gc-view-changed', event => {
    const view = typeof event.detail === 'string'
      ? event.detail
      : (event.detail?.view || location.hash.slice(1).split('/')[0]);
    const target = host();
    if (view !== 'appointments') {
      reveal(target);
      return;
    }
    observeHost();
    if (target && !premiumMarkupPresent(target)) conceal(target);
    scheduleRestore();
  });

  document.addEventListener('gc-cross-user-sync', () => {
    if (activeView()) scheduleRestore();
  });

  window.addEventListener('hashchange', () => {
    const target = host();
    if (!activeView()) {
      reveal(target);
      return;
    }
    observeHost();
    if (target && !premiumMarkupPresent(target)) conceal(target);
    scheduleRestore();
  });

  observeHost();
  if (activeView()) scheduleRestore();

  window.GotCrackedAppointmentsOwnerGuard = {
    version:'20260827-owner2',
    restore:scheduleRestore
  };
})();
