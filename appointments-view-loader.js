(() => {
  'use strict';
  if (window.GotCrackedAppointmentsViewLoader) return;
  window.GotCrackedAppointmentsViewLoader = true;
  const load = () => {
    if (document.querySelector('script[data-gc-appointments-board]') || window.GotCrackedAppointments) return;
    const script = document.createElement('script');
    script.src = 'appointments-board.js?v=20260827-production1';
    script.async = false;
    script.dataset.gcAppointmentsBoard = 'true';
    document.body.appendChild(script);
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
