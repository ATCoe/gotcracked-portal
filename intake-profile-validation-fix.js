(() => {
  'use strict';

  if (window.GotCrackedIntakeProfileValidationFix) return;

  const optionalFields = [
    'last_name',
    'contact_phone',
    'email',
    'address_line_1',
    'city',
    'state',
    'postal_code'
  ];

  function profileState() {
    const state = window.GotCrackedOperationsV1?.state;
    const intake = state?.intake;
    if (!state || !intake || Number(intake.step || 0) !== 1) return null;
    return { state, intake };
  }

  function field(dialog, key) {
    return dialog.querySelector(`[data-intake-customer="${key}"]`);
  }

  function syncProfileValidation() {
    const current = profileState();
    const dialog = document.getElementById('v1-intake-dialog');
    if (!current || !dialog?.open) return;

    const firstName = field(dialog, 'first_name');
    const phone = field(dialog, 'phone');
    const next = dialog.querySelector('[data-v1-intake-next]');

    for (const key of optionalFields) {
      const input = field(dialog, key);
      if (!input) continue;
      input.required = false;
      input.removeAttribute('aria-required');
    }

    if (firstName) {
      firstName.required = true;
      firstName.setAttribute('aria-required', 'true');
    }
    if (phone) {
      phone.required = true;
      phone.setAttribute('aria-required', 'true');
    }

    const ready = Boolean(firstName?.value.trim() && phone?.value.trim());
    if (next) next.disabled = !ready;

    const body = dialog.querySelector('.v1-intake-body');
    let note = body?.querySelector('[data-v1-guidance="profile"]');
    if (body && !note) {
      note = document.createElement('div');
      note.dataset.v1Guidance = 'profile';
      body.prepend(note);
    }
    if (note) {
      note.className = `v1-intake-guidance ${ready ? 'success' : 'warning'}`;
      note.textContent = ready
        ? 'Customer name and phone number are ready. Optional details can be completed now or later.'
        : 'Customer name and phone number are required. Everything else is optional.';
    }
  }

  function scheduleSync() {
    requestAnimationFrame(() => requestAnimationFrame(syncProfileValidation));
  }

  const style = document.createElement('style');
  style.id = 'gc-intake-profile-validation-fix-style';
  style.textContent = `
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="last_name"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="contact_phone"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="email"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="address_line_1"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="city"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="state"])::after,
    #v1-intake-dialog label.v1-required-field:has([data-intake-customer="postal_code"])::after {
      display:none!important;
      content:none!important;
    }
  `;
  document.head.appendChild(style);

  document.addEventListener('input', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#v1-intake-dialog')) return;
    scheduleSync();
  });
  document.addEventListener('change', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#v1-intake-dialog')) return;
    scheduleSync();
  });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#v1-intake-dialog')) return;
    scheduleSync();
  }, true);

  const observer = new MutationObserver(records => {
    if (!records.some(record => record.type === 'childList' || ['open','required','disabled'].includes(record.attributeName))) return;
    scheduleSync();
  });
  observer.observe(document.documentElement, {
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['open','required','disabled']
  });

  document.addEventListener('gc-portal-runtime-ready', scheduleSync);
  scheduleSync();

  window.GotCrackedIntakeProfileValidationFix = {
    version:'20260827-video4-1',
    sync:syncProfileValidation
  };
})();
