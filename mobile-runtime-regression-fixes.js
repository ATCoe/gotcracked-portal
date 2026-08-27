(() => {
  'use strict';

  if (window.GotCrackedMobileRuntimeRegressionFixes) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);

  function injectThemeFixes() {
    if (document.getElementById('gc-mobile-runtime-regression-style')) return;
    const style = document.createElement('style');
    style.id = 'gc-mobile-runtime-regression-style';
    style.textContent = `
      html[data-theme="dark"] {
        --surface:#111d2a;
        --surface-subtle:#0e1925;
        --text:#edf4fb;
      }
      html[data-theme="dark"] .gc-appt-metric,
      html[data-theme="dark"] .gc-appt-day,
      html[data-theme="dark"] .gc-workforce-premium {
        background:var(--surface)!important;
        color:var(--text)!important;
        border-color:#2b3c4f!important;
      }
      html[data-theme="dark"] .gc-appt-day-head,
      html[data-theme="dark"] .gc-workforce-metric {
        background:var(--surface-subtle)!important;
        color:var(--text)!important;
        border-color:#2b3c4f!important;
      }
      html[data-theme="dark"] .gc-appt-day-head h2,
      html[data-theme="dark"] .gc-appt-metric strong,
      html[data-theme="dark"] .gc-workforce-premium h2,
      html[data-theme="dark"] .gc-workforce-metric strong,
      html[data-theme="dark"] .gc-workforce-metric span {
        color:var(--text)!important;
      }
      html[data-theme="dark"] .gc-appt-day-head span,
      html[data-theme="dark"] .gc-appt-empty,
      html[data-theme="dark"] .gc-appt-metric small,
      html[data-theme="dark"] .gc-workforce-premium-head p,
      html[data-theme="dark"] .gc-workforce-metric small {
        color:#9eafc2!important;
      }
    `;
    document.head.appendChild(style);
  }

  function customerMatches(query) {
    const state = window.GotCrackedOperationsV1?.state;
    const intake = state?.intake;
    if (!state || !intake) return [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return (state.customers || []).filter(customer => {
      const haystack = [
        customer.first_name,
        customer.last_name,
        customer.phone,
        customer.contact_phone,
        customer.email
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    }).slice(0, 10);
  }

  function redrawCustomerResults(value) {
    const state = window.GotCrackedOperationsV1?.state;
    const intake = state?.intake;
    if (!intake || intake.step !== 0) return;

    intake.search = value;
    const results = document.querySelector('#v1-intake-dialog .v1-customer-results');
    if (!results) return;

    const query = String(value || '').trim();
    if (!query) {
      results.innerHTML = '<p class="v1-muted">Enter a phone number or email to search.</p>';
      return;
    }

    const matches = customerMatches(query);
    results.innerHTML = matches.length
      ? matches.map(customer => `<button type="button" class="v1-choice ${intake.customer?.id === customer.id ? 'selected' : ''}" data-v1-intake-customer="${esc(customer.id)}"><strong>${esc(customer.first_name)} ${esc(customer.last_name)}</strong><small>${esc(customer.phone)} · ${esc(customer.email || 'No email')} · ${(customer.devices || []).length} saved device(s)</small></button>`).join('')
      : '<p>No matching customer. Continue to create a profile.</p>';
  }

  /*
   * The original intake search redraws the entire wizard on every input event.
   * Android autofill/IME suggestions can lose their committed value when the
   * focused input node is replaced during that same event. Handle this one field
   * before the legacy document-level listener and redraw only its result list.
   */
  document.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v1-intake-search') return;
    redrawCustomerResults(input.value);
    event.stopPropagation();
  }, true);

  injectThemeFixes();

  window.GotCrackedMobileRuntimeRegressionFixes = {
    version:'20260827-video2-1',
    redrawCustomerResults
  };
})();
