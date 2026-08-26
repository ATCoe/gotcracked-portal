(() => {
  'use strict';

  if (window.GotCrackedActionLaunchers) return;
  const client = window.supabaseClient;
  const STYLE_VERSION = '20260826-actions1';

  function ensureStyle() {
    if (document.querySelector('link[data-gc-action-launchers]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `action-launchers.css?v=${STYLE_VERSION}`;
    link.dataset.gcActionLaunchers = 'true';
    document.head.appendChild(link);
  }

  function operations() {
    return window.GotCrackedOperationsV1 || null;
  }

  function ensureLeadDialog() {
    let dialog = document.getElementById('gc-lead-create-dialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'gc-lead-create-dialog';
    dialog.className = 'gc-lead-create-dialog';
    dialog.innerHTML = `
      <form id="gc-lead-create-form">
        <div class="gc-lead-create-head">
          <div><p class="eyebrow">Customer pipeline</p><h2>Create lead</h2></div>
          <button type="button" class="icon-button" data-gc-close-lead aria-label="Close">×</button>
        </div>
        <div class="gc-lead-create-body">
          <label>Customer name<input name="name" maxlength="160" autocomplete="name" required placeholder="Customer name"></label>
          <label>Phone number<input name="phone" maxlength="40" inputmode="tel" autocomplete="tel" placeholder="Phone number"></label>
          <label class="full">Email<input name="email" maxlength="254" type="email" autocomplete="email" placeholder="customer@example.com"></label>
          <label class="full">Device / repair needed<textarea name="issue" maxlength="1200" placeholder="Device and what the customer needs help with"></textarea></label>
          <small class="full">New leads enter Need to Contact. Add detailed contact notes from the lead workflow after creation.</small>
          <p class="gc-lead-create-message" role="status"></p>
        </div>
        <div class="gc-lead-create-actions">
          <button type="button" class="secondary-button" data-gc-close-lead>Cancel</button>
          <button type="submit" class="primary-button">Create Lead</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function openLeadDialog() {
    ensureStyle();
    const dialog = ensureLeadDialog();
    const form = dialog.querySelector('form');
    const message = dialog.querySelector('.gc-lead-create-message');
    if (message) message.textContent = '';
    if (!dialog.open) {
      form?.reset();
      dialog.showModal();
      requestAnimationFrame(() => form?.elements?.name?.focus());
    }
  }

  function saveTrainingSnapshot(state) {
    localStorage.setItem('gc-training-data-v1', JSON.stringify({
      customers: state.customers || [],
      workOrders: state.workOrders || [],
      leads: state.leads || [],
      inventory: state.inventory || [],
      services: state.services || [],
      purchaseOrders: state.purchaseOrders || [],
      poItems: state.poItems || [],
      guides: state.guides || [],
      intakes: state.intakes || [],
      appointments: state.appointments || []
    }));
  }

  async function createLead(form) {
    const ops = operations();
    const state = ops?.state;
    if (!ops || !state?.profile) throw new Error('Portal operations are still loading. Try again in a moment.');

    const fields = Object.fromEntries(new FormData(form));
    const name = String(fields.name || '').trim();
    const phone = String(fields.phone || '').trim();
    const email = String(fields.email || '').trim().toLowerCase();
    const issue = String(fields.issue || '').trim();
    if (!name) throw new Error('Customer name is required.');

    if (state.training) {
      const timestamp = new Date().toISOString();
      state.leads.unshift({
        id: crypto.randomUUID(),
        location_id: 'training',
        name,
        phone,
        email,
        customer_issue: issue,
        service: issue || 'Repair inquiry',
        source: 'Portal',
        pipeline_status: 'need_to_contact',
        status: 'new',
        created_at: timestamp,
        updated_at: timestamp
      });
      saveTrainingSnapshot(state);
      await Promise.resolve(ops.reload?.());
      window.GotCrackedDirectory?.requestRefresh?.('lead-created');
      window.GotCrackedCrossUserSync?.pollNow?.();
      return;
    }

    const { data, error } = await client.functions.invoke('create-lead', {
      body: {
        name,
        phone: phone || null,
        email: email || null,
        service: issue || 'Repair inquiry',
        source: 'portal',
        notes: null
      }
    });
    if (error) throw error;

    const id = data?.id || data?.lead?.id || null;
    if (id) {
      const update = await client.from('leads').update({
        pipeline_status: 'need_to_contact',
        customer_issue: issue || null
      }).eq('id', id);
      if (update.error) throw update.error;
    }

    await Promise.resolve(ops.reload?.());
    window.GotCrackedDirectory?.requestRefresh?.('lead-created');
    window.GotCrackedCrossUserSync?.pollNow?.();
  }

  function openGuidedIntake() {
    const ops = operations();
    if (typeof ops?.openIntake !== 'function') {
      window.GotCrackedDiagnostics?.error?.('Guided intake is still loading.', { context: 'Unable to open intake' });
      return;
    }

    const current = document.getElementById('v1-intake-dialog');
    if (current?.open) return;

    const legacy = document.getElementById('new-ticket');
    if (legacy?.open) legacy.close();

    try {
      ops.openIntake();
    } catch (error) {
      console.error('Unable to open guided intake:', error);
      window.GotCrackedDiagnostics?.error?.(error, { context: 'Unable to open intake' });
    }
  }

  /*
   * Canonical launch ownership. This capture-phase listener intentionally runs
   * before legacy document bubble listeners in app.js / operations-v1-core.js.
   * Each entry point is handled exactly once, then propagation is stopped so an
   * obsolete prompt/modal handler cannot fire underneath the current UI.
   */
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const lead = target.closest('[data-v1-new-lead],[data-live-action="lead"]');
    if (lead) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openLeadDialog();
      return;
    }

    const intake = target.closest('[data-open-ticket],[data-v1-walkin]');
    if (intake) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openGuidedIntake();
    }
  }, true);

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-gc-close-lead]')) return;
    event.preventDefault();
    document.getElementById('gc-lead-create-dialog')?.close();
  });

  document.addEventListener('submit', async event => {
    if (event.target?.id !== 'gc-lead-create-form') return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('.gc-lead-create-message');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Creating…'; }
    if (message) message.textContent = '';
    try {
      await createLead(form);
      document.getElementById('gc-lead-create-dialog')?.close();
    } catch (error) {
      console.error('Create lead failed:', error);
      if (message) message.textContent = error?.message || 'Unable to create lead.';
      window.GotCrackedDiagnostics?.error?.(error, { context: 'Unable to create lead' });
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Create Lead'; }
    }
  });

  ensureStyle();
  ensureLeadDialog();
  window.GotCrackedActionLaunchers = { openLead: openLeadDialog, openIntake: openGuidedIntake };
})();
