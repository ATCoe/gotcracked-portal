(() => {
  'use strict';

  if (window.GotCrackedMobileRuntimeRegressionFixes) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const digits = value => String(value || '').replace(/\D/g, '');

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

  function operationsState() {
    return window.GotCrackedOperationsV1?.state || null;
  }

  function validContact(value) {
    const query = String(value || '').trim();
    if (!query) return false;
    if (query.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
    return digits(query).length >= 7;
  }

  function customerMatches(query) {
    const state = operationsState();
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

  function syncLookupGuidance(value) {
    const state = operationsState();
    const intake = state?.intake;
    const dialog = document.getElementById('v1-intake-dialog');
    if (!dialog?.open || !intake || Number(intake.step || 0) !== 0) return;

    const body = dialog.querySelector('.v1-intake-body');
    const next = dialog.querySelector('[data-v1-intake-next]');
    if (!body) return;

    const query = String(value ?? dialog.querySelector('#v1-intake-search')?.value ?? intake.search ?? '').trim();
    const ready = Boolean(intake.customer) || validContact(query);
    if (next) next.disabled = !ready;

    let note = body.querySelector('[data-v1-guidance="lookup"]');
    if (!note) {
      note = document.createElement('div');
      note.dataset.v1Guidance = 'lookup';
      body.prepend(note);
    }

    if (ready) {
      note.className = 'v1-intake-guidance success';
      note.textContent = 'Customer lookup is ready. Continue to verify the profile.';
    } else if (query) {
      note.className = 'v1-intake-guidance warning';
      note.textContent = 'Enter a valid phone number or email before continuing.';
    } else {
      note.className = 'v1-intake-guidance';
      note.textContent = 'Search by phone number or email to find an existing customer.';
    }
  }

  function redrawCustomerResults(value) {
    const state = operationsState();
    const intake = state?.intake;
    if (!intake || Number(intake.step || 0) !== 0) return;

    intake.search = value;
    const results = document.querySelector('#v1-intake-dialog .v1-customer-results');
    if (!results) {
      syncLookupGuidance(value);
      return;
    }

    const query = String(value || '').trim();
    if (!query) {
      results.innerHTML = '<p class="v1-muted">Enter a phone number or email to search.</p>';
      syncLookupGuidance(value);
      return;
    }

    const matches = customerMatches(query);
    results.innerHTML = matches.length
      ? matches.map(customer => `<button type="button" class="v1-choice ${intake.customer?.id === customer.id ? 'selected' : ''}" data-v1-intake-customer="${esc(customer.id)}"><strong>${esc(customer.first_name)} ${esc(customer.last_name)}</strong><small>${esc(customer.phone)} · ${esc(customer.email || 'No email')} · ${(customer.devices || []).length} saved device(s)</small></button>`).join('')
      : '<p>No matching customer. Continue to create a profile.</p>';
    syncLookupGuidance(value);
  }

  function intakeSearchInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v1-intake-search') return;
    /*
     * operations-v1-core redraws the entire intake wizard from its document
     * input handler. On Android/Samsung keyboard replacement text that destroys
     * the focused node during the same event, so the committed autofill value
     * disappears. Own this one field at window capture and update only results.
     */
    event.stopImmediatePropagation();
    redrawCustomerResults(input.value);
  }

  function scheduleIntakeSync() {
    requestAnimationFrame(() => {
      const input = document.querySelector('#v1-intake-dialog[open] #v1-intake-search');
      if (input instanceof HTMLInputElement) syncLookupGuidance(input.value);
    });
  }

  window.addEventListener('input', intakeSearchInput, true);
  window.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v1-intake-search') return;
    event.stopImmediatePropagation();
    redrawCustomerResults(input.value);
  }, true);
  window.addEventListener('compositionend', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v1-intake-search') return;
    setTimeout(() => redrawCustomerResults(input.value), 0);
  }, true);
  window.addEventListener('beforeinput', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'v1-intake-search') return;
    setTimeout(() => redrawCustomerResults(input.value), 0);
  }, true);

  const intakeObserver = new MutationObserver(scheduleIntakeSync);
  intakeObserver.observe(document.documentElement, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['open']
  });

  function isoDate(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function parseDate(value) {
    return new Date(`${value}T12:00:00`);
  }

  function addDays(value, count) {
    const date = parseDate(value);
    date.setDate(date.getDate() + count);
    return isoDate(date);
  }

  function startOfWeek() {
    const date = new Date();
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    local.setDate(local.getDate() - local.getDay());
    return isoDate(local);
  }

  function appointmentNavigation(event) {
    if (location.hash.slice(1).split('/')[0] !== 'appointments') return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('[data-appt-week],[data-appt-today],[data-appt-refresh]');
    if (!control) return;

    const appointments = window.GotCrackedAppointments;
    const state = appointments?.state;
    if (!appointments || !state || state.loading) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (control.hasAttribute('data-appt-week')) {
      state.weekStart = addDays(state.weekStart || startOfWeek(), Number(control.dataset.apptWeek) || 0);
    } else if (control.hasAttribute('data-appt-today')) {
      state.weekStart = startOfWeek();
    }

    const targetHost = document.getElementById('appointments');
    targetHost?.setAttribute('aria-busy', 'true');
    Promise.resolve(appointments.load({ quiet:true }))
      .catch(error => {
        console.error('Appointment soft refresh failed:', error);
        window.GotCrackedDiagnostics?.error?.(error, { context:'Appointments could not be refreshed' });
      })
      .finally(() => targetHost?.removeAttribute('aria-busy'));
  }

  window.addEventListener('click', appointmentNavigation, true);

  injectThemeFixes();
  scheduleIntakeSync();

  window.GotCrackedMobileRuntimeRegressionFixes = {
    version:'20260827-video3-1',
    redrawCustomerResults,
    syncLookupGuidance
  };
})();
