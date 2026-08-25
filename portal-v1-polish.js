(() => {
  'use strict';

  const VERSION = '20260825-v1ops5';
  const client = () => window.supabaseClient;
  const ops = () => window.GotCrackedOperationsV1;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const digits = value => String(value || '').replace(/\D/g, '');
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (!document.querySelector('link[data-gc-v1-polish]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `portal-v1-polish.css?v=${VERSION}`;
    link.dataset.gcV1Polish = 'true';
    document.head.appendChild(link);
  }

  function toast(message, type = '') {
    let region = document.getElementById('v1-toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'v1-toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const item = document.createElement('div');
    item.className = `v1-toast ${type}`.trim();
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 4200);
  }

  function ensureLeadDialog() {
    let dialog = document.getElementById('portal-v1-lead-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'portal-v1-lead-dialog';
    dialog.innerHTML = `
      <form id="portal-v1-lead-form" class="v1-lead-dialog-shell">
        <div class="v1-intake-head">
          <div><p class="v1-kicker">Customer pipeline</p><h2>New Lead</h2><span class="v1-step-label">Need to Contact</span></div>
          <button class="icon-button" type="button" data-v1-polish-close-lead aria-label="Close new lead form">×</button>
        </div>
        <div class="v1-lead-dialog-body">
          <p class="v1-intake-guidance">Capture enough detail for the first contact attempt. The lead will enter <strong>Need to Contact</strong> and cannot advance until activity is documented.</p>
          <div class="v1-form-grid">
            <label class="v1-required-field">Customer name<input name="name" autocomplete="name" required></label>
            <label>Primary phone<input name="phone" inputmode="tel" autocomplete="tel"></label>
            <label>Email<input name="email" type="email" autocomplete="email"></label>
            <label class="v1-required-field">Device type<select name="device_category" required><option value="">Choose device</option><option>Phone</option><option>Tablet</option><option>Laptop</option><option>Desktop</option><option>Console</option><option>Other</option></select></label>
            <label>Manufacturer<input name="manufacturer" placeholder="Apple, Samsung, Google, Sony..."></label>
            <label>Model<input name="model" placeholder="iPhone 15, Galaxy S24, PS5..."></label>
            <label>Source<select name="source"><option>Phone</option><option>Walk-In</option><option>Website</option><option>Referral</option><option>Social</option><option>Other</option></select></label>
            <label>Expected intake<select name="intake_method"><option value="walk_in">Walk-In / Drop-Off</option><option value="mail_in">Mail-In</option></select></label>
            <label class="full v1-required-field">Customer-reported issue<textarea name="customer_issue" required placeholder="Cracked screen, no display, will not charge, intermittent shutdown, etc."></textarea></label>
          </div>
          <p class="v1-intake-guidance">At least a phone number or email is required so the contact attempt can be recorded against a usable lead.</p>
        </div>
        <div class="v1-lead-dialog-actions">
          <p class="operation-status" aria-live="polite"></p>
          <button class="secondary-button" type="button" data-v1-polish-close-lead>Cancel</button>
          <button class="primary-button" type="submit">Create Lead</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function openLeadDialog() {
    const dialog = ensureLeadDialog();
    const form = dialog.querySelector('form');
    form.reset();
    const status = form.querySelector('.operation-status');
    if (status) status.textContent = '';
    dialog.showModal();
    requestAnimationFrame(() => form.elements.name?.focus());
  }

  function persistTrainingState() {
    const state = ops()?.state;
    if (!state) return;
    localStorage.setItem('gc-training-data-v1', JSON.stringify({
      customers: state.customers,
      workOrders: state.workOrders,
      leads: state.leads,
      inventory: state.inventory,
      services: state.services,
      purchaseOrders: state.purchaseOrders,
      poItems: state.poItems,
      guides: state.guides,
      intakes: state.intakes,
      appointments: state.appointments || []
    }));
  }

  async function createLead(form) {
    const state = ops()?.state;
    const db = client();
    if (!state || !db) return;
    const data = Object.fromEntries(new FormData(form));
    const status = form.querySelector('.operation-status');
    const setStatus = (message, error = false) => {
      if (!status) return;
      status.textContent = message;
      status.className = `operation-status ${error ? 'v1-error' : 'v1-success'}`;
    };
    if (!data.name?.trim() || !data.device_category || !data.customer_issue?.trim()) {
      setStatus('Name, device type, and issue are required.', true);
      return;
    }
    if (!digits(data.phone).length && !data.email?.trim()) {
      setStatus('Add a phone number or email.', true);
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setStatus('Creating lead…');
    try {
      const record = {
        id: state.training ? uid('training-lead') : undefined,
        location_id: state.training ? 'training' : state.profile.location_id,
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        email: data.email?.trim().toLowerCase() || null,
        service: data.customer_issue.trim(),
        source: data.source || 'Portal',
        status: 'new',
        pipeline_status: 'need_to_contact',
        intake_method: data.intake_method || 'walk_in',
        device_category: data.device_category,
        manufacturer: data.manufacturer?.trim() || null,
        model: data.model?.trim() || null,
        customer_issue: data.customer_issue.trim(),
        created_at: now(),
        updated_at: now()
      };
      if (state.training) {
        state.leads.unshift(record);
        persistTrainingState();
      } else {
        delete record.id;
        delete record.created_at;
        delete record.updated_at;
        const result = await db.from('leads').insert(record).select().single();
        if (result.error) throw result.error;
      }
      document.getElementById('portal-v1-lead-dialog')?.close();
      await ops()?.reload?.();
      window.GotCrackedUI?.activateView?.('leads');
      toast('Lead created in Need to Contact.', 'success');
    } catch (error) {
      setStatus(error?.message || 'Unable to create lead.', true);
    } finally {
      submit.disabled = false;
    }
  }

  function decorateNewLeadButtons() {
    document.querySelectorAll('[data-v1-new-lead]').forEach(button => {
      button.removeAttribute('data-v1-new-lead');
      button.setAttribute('data-v1-polish-new-lead', '');
      button.title = 'Create a structured lead';
    });
  }

  function decorateGuidedWorkOrderButtons() {
    document.querySelectorAll('[data-open-ticket]').forEach(button => {
      button.dataset.v1GuidedIntake = 'true';
      button.title = 'Start guided customer and device intake';
      button.setAttribute('aria-label', 'New Work Order — guided intake');
    });
  }

  function addGuidance(body, key, message, type = '') {
    if (!body || body.querySelector(`[data-v1-guidance="${key}"]`)) return;
    const note = document.createElement('div');
    note.className = `v1-intake-guidance ${type}`.trim();
    note.dataset.v1Guidance = key;
    note.textContent = message;
    body.prepend(note);
  }

  function decorateIntake() {
    const dialog = document.getElementById('v1-intake-dialog');
    const state = ops()?.state;
    const intake = state?.intake;
    if (!dialog?.open || !intake) return;
    const body = dialog.querySelector('.v1-intake-body');
    const steps = [...dialog.querySelectorAll('.v1-step')];
    const active = steps.findIndex(step => step.classList.contains('active'));
    const step = active >= 0 ? active : Number(intake.step || 0);
    const head = dialog.querySelector('.v1-intake-head > div');
    if (head && !head.querySelector('.v1-step-label')) {
      const label = document.createElement('span');
      label.className = 'v1-step-label';
      label.textContent = `Step ${step + 1} of 5`;
      head.appendChild(label);
    }
    const next = dialog.querySelector('[data-v1-intake-next]');

    if (step === 0) {
      const input = dialog.querySelector('#v1-intake-search');
      const q = input?.value.trim() || '';
      const validSearch = q.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) : digits(q).length >= 7;
      const allowed = Boolean(intake.customer) || validSearch;
      if (next) next.disabled = !allowed;
      addGuidance(body, 'lookup', allowed ? 'Customer lookup is ready. Continue to verify the profile.' : 'Enter a valid phone number or email before continuing.', allowed ? 'success' : 'warning');
    }

    if (step === 1) {
      const required = ['first_name','last_name','phone','contact_phone','email','address_line_1','city','state','postal_code'];
      const fields = required.map(key => dialog.querySelector(`[data-intake-customer="${key}"]`)).filter(Boolean);
      fields.forEach(field => {
        field.required = true;
        field.setAttribute('aria-required', 'true');
        field.closest('label')?.classList.add('v1-required-field');
      });
      const valid = fields.every(field => field.value.trim()) && (!dialog.querySelector('[data-intake-customer="email"]') || dialog.querySelector('[data-intake-customer="email"]').checkValidity());
      if (next) next.disabled = !valid;
      addGuidance(body, 'profile', valid ? 'Customer contact and full address are complete.' : 'Complete the required customer contact and full address fields before continuing.', valid ? 'success' : 'warning');
    }

    if (step === 2) {
      const manufacturer = dialog.querySelector('[data-intake-device="manufacturer"]');
      const model = dialog.querySelector('[data-intake-device="model"]');
      const complaint = dialog.querySelector('[data-intake-complaint]');
      [manufacturer, model, complaint].filter(Boolean).forEach(field => {
        field.required = true;
        field.setAttribute('aria-required', 'true');
        field.closest('label')?.classList.add('v1-required-field');
      });
      const valid = Boolean(manufacturer?.value.trim() && model?.value.trim() && complaint?.value.trim());
      if (next) next.disabled = !valid;
      addGuidance(body, 'device', valid ? 'Device identity and customer complaint are ready for inspection.' : 'Manufacturer, model, and customer-reported issue are required.', valid ? 'success' : 'warning');
    }

    if (step === 3) {
      const selects = [...dialog.querySelectorAll('[data-intake-check]')];
      selects.forEach(select => {
        if (!select.dataset.v1Recorded) {
          select.dataset.v1Recorded = 'true';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        select.dataset.v1CheckState = select.value;
      });
      if (body && !body.querySelector('.v1-check-progress')) {
        const progress = document.createElement('div');
        progress.className = 'v1-check-progress';
        const assessed = selects.filter(select => select.value !== 'not_tested').length;
        const pct = selects.length ? Math.round(assessed / selects.length * 100) : 0;
        progress.innerHTML = `<header><span>Inspection coverage</span><strong>${assessed}/${selects.length} assessed · ${selects.length - assessed} Not Tested</strong></header><div class="v1-check-progress-track"><i style="width:${pct}%"></i></div>`;
        body.prepend(progress);
      } else {
        const assessed = selects.filter(select => select.value !== 'not_tested').length;
        const pct = selects.length ? Math.round(assessed / selects.length * 100) : 0;
        const progress = body?.querySelector('.v1-check-progress');
        if (progress) {
          const strong = progress.querySelector('strong');
          const bar = progress.querySelector('i');
          if (strong) strong.textContent = `${assessed}/${selects.length} assessed · ${selects.length - assessed} Not Tested`;
          if (bar) bar.style.width = `${pct}%`;
        }
      }
    }

    if (step === 4) {
      const review = body?.querySelector('.v1-review');
      if (review && !review.querySelector('.v1-review-banner')) {
        const banner = document.createElement('div');
        banner.className = 'v1-review-banner';
        banner.textContent = intake.pendingTicket
          ? 'Review the intake before receiving this pending work order. Completing intake will move it from Awaiting Customer to Awaiting Repair.'
          : 'Review the intake before creating the work order. Customer, device, complaint, and all checklist states will be saved together.';
        review.prepend(banner);
      }
    }
  }

  function decorateCatalogResults() {
    const state = ops()?.state;
    if (!state) return;
    document.querySelectorAll('#v1-line-results [data-v1-add-line]').forEach(button => {
      const [type, id] = String(button.dataset.v1AddLine || '').split(':');
      if (type !== 'part') return;
      const item = state.inventory.find(row => row.id === id);
      if (!item) return;
      const qty = Number(item.quantity_on_hand || 0);
      button.classList.toggle('v1-out-of-stock', qty <= 0);
      button.classList.toggle('v1-low-stock', qty > 0 && qty <= Number(item.reorder_point || 0));
      button.disabled = qty <= 0;
      if (qty <= 0) {
        button.title = 'Out of stock';
        const small = button.querySelector('small');
        if (small) small.textContent = 'Out of stock';
      }
    });
  }

  function decorateRows() {
    document.querySelectorAll('tr[data-v1-work-order],tr[data-v1-lead]').forEach(row => {
      if (row.hasAttribute('tabindex')) return;
      row.tabIndex = 0;
      const primary = row.querySelector('strong')?.textContent?.trim() || 'record';
      row.setAttribute('aria-label', `Open ${primary}`);
    });
  }

  function decorateDrawer() {
    const drawer = document.getElementById('v1-lead-drawer');
    if (drawer) {
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-label', 'Lead workflow');
    }
    const anyOpen = Boolean(drawer?.classList.contains('open') || document.querySelector('dialog[open]'));
    document.body.classList.toggle('v1-overlay-open', anyOpen);
  }

  function decorate() {
    decorateNewLeadButtons();
    decorateGuidedWorkOrderButtons();
    decorateIntake();
    decorateCatalogResults();
    decorateRows();
    decorateDrawer();
  }

  let queued = false;
  function scheduleDecorate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate();
    });
  }

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','open','hidden'] });

  document.addEventListener('input', event => {
    if (event.target.closest('#v1-intake-dialog')) scheduleDecorate();
  });
  document.addEventListener('change', event => {
    const check = event.target.closest('[data-intake-check]');
    if (check) {
      check.dataset.v1CheckState = check.value;
      scheduleDecorate();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target.id === 'v1-line-search' && event.key === 'Enter') {
      event.preventDefault();
      const state = ops()?.state;
      const q = event.target.value.trim().toUpperCase();
      if (!state || !q) return;
      const part = state.inventory.find(item => String(item.sku || '').toUpperCase() === q);
      const service = state.services.find(item => String(item.sku || '').toUpperCase() === q);
      const match = part || service;
      if (!match) {
        toast('No exact part or service SKU matches that scan.', 'warning');
        return;
      }
      if (part && Number(part.quantity_on_hand || 0) <= 0) {
        toast(`${part.name} is out of stock.`, 'error');
        return;
      }
      const type = part ? 'part' : 'service';
      const button = document.querySelector(`[data-v1-add-line="${CSS.escape(`${type}:${match.id}`)}"]`);
      if (button && !button.disabled) button.click();
      else toast('The scanned item is not currently available to add.', 'warning');
      return;
    }

    const row = event.target.closest?.('tr[data-v1-work-order],tr[data-v1-lead]');
    if (row && event.target === row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      row.click();
    }
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const legacyNewWorkOrder = target.closest('[data-open-ticket]');
    if (legacyNewWorkOrder) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const api = ops();
      if (api?.openIntake) api.openIntake();
      else toast('Portal operations are still loading. Try again in a moment.', 'warning');
      return;
    }

    if (target.closest('[data-v1-polish-new-lead]')) {
      event.preventDefault();
      event.stopPropagation();
      openLeadDialog();
      return;
    }

    if (target.closest('[data-v1-polish-close-lead]')) {
      document.getElementById('portal-v1-lead-dialog')?.close();
      scheduleDecorate();
    }
  }, true);

  document.addEventListener('submit', event => {
    if (event.target.id !== 'portal-v1-lead-form') return;
    event.preventDefault();
    createLead(event.target);
  });

  window.addEventListener('gc-view-changed', scheduleDecorate);
  window.addEventListener('load', () => {
    ensureLeadDialog();
    scheduleDecorate();
    setTimeout(scheduleDecorate, 1600);
    setTimeout(scheduleDecorate, 2600);
  }, { once: true });

  window.GotCrackedPortalPolish = { decorate, toast, openLeadDialog };
})();
