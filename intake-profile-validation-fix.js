(() => {
  'use strict';

  if (window.GotCrackedIntakeProfileValidationFix) return;

  const requiredFields = [
    'first_name',
    'last_name',
    'phone',
    'contact_phone',
    'address_line_1',
    'city',
    'state',
    'postal_code'
  ];
  const optionalFields = ['email'];

  function profileState() {
    const state = window.GotCrackedOperationsV1?.state;
    const intake = state?.intake;
    if (!state || !intake || Number(intake.step || 0) !== 1) return null;
    return { state, intake };
  }

  function field(dialog, key) {
    return dialog.querySelector(`[data-intake-customer="${key}"]`);
  }

  function labelFor(input) {
    return input?.closest('label') || null;
  }

  function setLeadingLabelText(label, text) {
    if (!label) return;
    const node = [...label.childNodes].find(child => child.nodeType === Node.TEXT_NODE);
    if (node) node.textContent = text;
  }

  function markRequired(input, required) {
    if (!input) return;
    const label = labelFor(input);
    input.required = required;
    if (required) {
      input.setAttribute('aria-required', 'true');
      label?.classList.add('v1-required-field');
    } else {
      input.removeAttribute('aria-required');
      label?.classList.remove('v1-required-field');
      label?.querySelector('.v1-required')?.remove();
    }
  }

  function syncProfileCopy(dialog) {
    const body = dialog.querySelector('.v1-intake-body');
    const heading = body?.querySelector('h3');
    const intro = heading?.nextElementSibling;
    if (intro?.tagName === 'P') {
      intro.textContent = 'First name, last name, primary phone, alternate phone, and full mailing address are required. Email is optional.';
    }

    setLeadingLabelText(labelFor(field(dialog, 'last_name')), 'Last name ');
    setLeadingLabelText(labelFor(field(dialog, 'email')), 'Email (optional) ');
  }

  function syncProfileValidation() {
    const current = profileState();
    const dialog = document.getElementById('v1-intake-dialog');
    if (!current || !dialog?.open) return false;

    syncProfileCopy(dialog);

    for (const key of requiredFields) markRequired(field(dialog, key), true);
    for (const key of optionalFields) markRequired(field(dialog, key), false);

    const missing = requiredFields.filter(key => !field(dialog, key)?.value.trim());
    const ready = missing.length === 0;
    const next = dialog.querySelector('[data-v1-intake-next]');
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
        ? 'Required customer contact and address details are complete. Email remains optional.'
        : 'Complete first name, last name, both phone fields, address, city, state, and ZIP before continuing. Email is optional.';
    }

    return ready;
  }

  function scheduleSync() {
    requestAnimationFrame(() => requestAnimationFrame(syncProfileValidation));
  }

  document.addEventListener('input', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#v1-intake-dialog')) return;
    scheduleSync();
  });
  document.addEventListener('change', event => {
    if (!(event.target instanceof Element) || !event.target.closest('#v1-intake-dialog')) return;
    scheduleSync();
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#v1-intake-dialog')) return;
    if (target.closest('[data-v1-intake-next]') && Number(window.GotCrackedOperationsV1?.state?.intake?.step || 0) === 1) {
      if (!syncProfileValidation()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
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
    version:'20260827-profile-policy2',
    requiredFields:[...requiredFields],
    optionalFields:[...optionalFields],
    sync:syncProfileValidation
  };
})();
