(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format((Number(cents) || 0) / 100);
  const dollarsToCents = value => Math.round((Number(value) || 0) * 100);
  const centsToDollars = value => ((Number(value) || 0) / 100).toFixed(2);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const managementRole = role => ['owner','manager'].includes(role);
  const snapshotRole = role => ['owner','manager','front_desk'].includes(role);
  const showFormError = (form,error,context='Failure to update sales') => {const message=error?.message||String(error||'Unknown error');const status=form.querySelector('.auth-message');if(status)status.textContent=message;window.GotCrackedDiagnostics?.error(error,{context});};
  const methodLabels = {
    manual_override:'Manual goal', scheduled_labor_x_splh:'Scheduled labor × SPLH', weekly_forecast_by_labor_share:'Weekly forecast allocation',
    launch_baseline:'Launch baseline', adaptive_launch:'Adaptive launch goal', adaptive_history:'Adaptive historical goal', history_only:'Historical average', unset:'Goal not configured'
  };

  let profile = null;
  let settings = null;
  let goalSettings = null;
  let summary = null;
  let workOrderObserver = null;

  function todayLocal() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  }

  function trainingData() {
    const stored = JSON.parse(localStorage.getItem('gc-training-sales-v1') || 'null');
    return stored || {
      business_date:todayLocal(), current_sales_cents:0, goal_cents:150000, remaining_cents:150000, percent_to_goal:0,
      goal_method:'launch_baseline', history_days:0, is_closed:false, close_status:null, last_updated_at:null, scheduled_hours:8, target_splh:125
    };
  }

  function saveTrainingData(next) {
    summary = { ...trainingData(), ...next };
    summary.remaining_cents = Math.max((summary.goal_cents || 0) - (summary.current_sales_cents || 0), 0);
    summary.percent_to_goal = summary.goal_cents ? Math.round((summary.current_sales_cents / summary.goal_cents) * 1000) / 10 : 0;
    localStorage.setItem('gc-training-sales-v1', JSON.stringify(summary));
  }

  async function loadIdentity() {
    profile = window.GotCrackedOperationsV1?.state?.profile || profile;
    if (profile?.id) return profile;
    const { data:{ user } } = await client.auth.getUser();
    if (!user) return null;
    const result = await client.from('profiles').select('id,location_id,display_name,role,active').eq('id',user.id).maybeSingle();
    if (!result.error) profile = result.data;
    return profile;
  }

  async function loadSettings() {
    if (!profile?.location_id) return;
    const [business, goals] = await Promise.all([
      client.from('business_settings').select('*').eq('location_id',profile.location_id).maybeSingle(),
      client.from('sales_goal_settings').select('*').eq('location_id',profile.location_id).maybeSingle()
    ]);
    if (!business.error) settings = business.data || { location_id:profile.location_id, charge_parts_to_customer:false };
    if (!goals.error) goalSettings = goals.data || { launch_daily_goal_cents:null, adaptive_enabled:true, growth_target_pct:0 };
  }

  async function loadSummary() {
    if (training()) {
      summary = trainingData();
      renderDashboard();
      return summary;
    }
    const result = await client.rpc('get_sales_day_summary', { target_date:null });
    if (result.error) {
      console.warn('Sales day summary unavailable:', result.error.message);
      summary = null;
    } else summary = result.data;
    renderDashboard();
    return summary;
  }

  function syncSalesMetric() {
    if (!summary) return;
    const metric = [...document.querySelectorAll('#dashboard .metrics article')].find(card => card.querySelector('p')?.textContent?.includes('Today’s sales'));
    if (!metric) return;
    const strong = metric.querySelector('strong');
    const small = metric.querySelector('small');
    if (strong) strong.textContent = money(summary.current_sales_cents || 0);
    if (small) small.textContent = summary.is_closed ? 'Final external POS close' : 'External POS snapshot';
  }

  function salesCardMarkup() {
    if (!summary) return `<section id="gc-sales-card" class="card gc-sales-card"><div class="gc-sales-copy"><p class="eyebrow">Sales goal</p><h2>External POS sales</h2><div class="gc-sales-empty">Sales reporting is temporarily unavailable. Repair workflow is unaffected.</div></div></section>`;

    const goal = Number(summary.goal_cents || 0);
    const sales = Number(summary.current_sales_cents || 0);
    const percent = goal ? Math.max(0, Number(summary.percent_to_goal || 0)) : 0;
    const fill = Math.min(percent, 100);
    const closed = Boolean(summary.is_closed);
    const manager = managementRole(profile?.role);
    const canSnapshot = snapshotRole(profile?.role);
    const last = summary.last_updated_at ? new Date(summary.last_updated_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'No POS update yet';
    const method = methodLabels[summary.goal_method] || String(summary.goal_method || 'Goal not configured').replaceAll('_',' ');

    return `<section id="gc-sales-card" class="card gc-sales-card ${percent >= 100 ? 'is-over-goal' : ''}">
      <div class="gc-sales-copy">
        <div class="gc-sales-head"><div><p class="eyebrow">Daily sales goal</p><h2>${closed ? 'Business day closed' : 'Today’s sales pace'}</h2></div><span class="gc-sales-status ${closed?'closed':''}">${closed?'Reconciled':'External POS'}</span></div>
        <div class="gc-sales-primary"><strong>${money(sales)}</strong><span>${goal ? `of ${money(goal)}` : '· goal not configured'}</span></div>
        <div class="gc-sales-progress" role="progressbar" aria-label="Daily sales goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fill)}"><span style="width:${fill}%"></span><i class="gc-sales-goal-marker" aria-hidden="true"></i></div>
        <div class="gc-sales-facts">
          <div class="gc-sales-fact"><small>To goal</small><strong>${goal ? (percent >= 100 ? `${percent.toFixed(1)}% · goal met` : `${money(summary.remaining_cents || 0)} remaining`) : 'Set a launch goal'}</strong></div>
          <div class="gc-sales-fact"><small>Goal basis</small><strong>${esc(method)}</strong></div>
          <div class="gc-sales-fact"><small>Last POS update</small><strong>${esc(last)}</strong></div>
        </div>
        <div class="gc-sales-actions">
          ${!closed && canSnapshot ? '<button type="button" class="secondary-button" data-gc-sales-action="snapshot">Update POS sales</button>' : ''}
          ${!closed && manager ? '<button type="button" class="primary-button" data-gc-sales-action="closeout">End-of-day close</button>' : ''}
          ${manager ? `<button type="button" class="secondary-button" data-gc-sales-action="goal">${goal ? 'Override goal' : 'Set today’s goal'}</button>` : ''}
          ${closed && manager ? '<button type="button" class="secondary-button" data-gc-sales-action="reopen">Reopen day</button>' : ''}
        </div>
        <p class="gc-sales-note">Sales are entered from the external POS. Portal work-order totals do not count as collected sales until payment integration is added.</p>
      </div>
    </section>`;
  }

  function renderDashboard() {
    syncSalesMetric();
    const metrics = document.querySelector('#dashboard .metrics');
    if (!metrics) return;
    let card = document.getElementById('gc-sales-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'gc-sales-card';
      metrics.insertAdjacentElement('afterend', card);
    }
    const markup = salesCardMarkup();
    const temp = document.createElement('div');
    temp.innerHTML = markup.trim();
    card.replaceWith(temp.firstElementChild);
  }

  function ensureDialog() {
    let dialog = document.getElementById('gc-sales-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'gc-sales-dialog';
      dialog.className = 'gc-sales-dialog';
      document.body.appendChild(dialog);
    }
    return dialog;
  }

  function dialogHead(kicker,title) {
    return `<div class="modal-head"><div><p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2></div><button type="button" class="icon-button" data-gc-close-dialog aria-label="Close">×</button></div>`;
  }

  function openSnapshot() {
    const dialog = ensureDialog();
    dialog.innerHTML = `<form id="gc-pos-snapshot-form">${dialogHead('External POS','Update today’s sales')}<div class="gc-form-grid">
      <label>Net sales from POS<input name="net_sales" type="number" min="0" step="0.01" value="${centsToDollars(summary?.current_sales_cents)}" required></label>
      <label>Transactions<input name="transaction_count" type="number" min="0" step="1" placeholder="Optional"></label>
      <label class="full">Note<textarea name="note" placeholder="Optional shift note or POS reference"></textarea></label>
    </div><p class="gc-sales-note">Enter the current net-sales total shown by the external POS. This is a snapshot, not a payment transaction.</p><p class="auth-message"></p><div class="modal-actions"><button type="button" class="secondary-button" data-gc-close-dialog>Cancel</button><button class="primary-button">Save snapshot</button></div></form>`;
    dialog.showModal();
  }

  function openGoal() {
    const dialog = ensureDialog();
    dialog.innerHTML = `<form id="gc-sales-goal-form">${dialogHead('Management','Override today’s goal')}<div class="gc-form-grid">
      <label>Sales goal<input name="goal" type="number" min="0" step="1" value="${((summary?.goal_cents||0)/100).toFixed(0)}" required></label>
      <label class="full">Reason<input name="reason" placeholder="Launch target, event day, staffing adjustment…"></label>
    </div><p class="gc-sales-note">A daily override wins over the adaptive goal for this business date only.</p><p class="auth-message"></p><div class="modal-actions"><button type="button" class="secondary-button" data-gc-close-dialog>Cancel</button><button class="primary-button">Save goal</button></div></form>`;
    dialog.showModal();
  }

  function closeoutPreview(form) {
    const val = name => dollarsToCents(form.elements[name]?.value);
    const opening = val('opening_cash');
    const cash = val('cash_tender');
    const paidOut = val('cash_paid_out');
    const actual = val('actual_drawer');
    const expected = opening + cash - paidOut;
    const cashVariance = actual - expected;
    const collected = val('net_sales') + val('tax_collected');
    const tenderVariance = val('cash_tender') + val('card_tender') + val('other_tender') - collected;
    const host = form.querySelector('.gc-closeout-preview');
    if (host) host.innerHTML = `<div><small>Expected drawer</small><strong>${money(expected)}</strong></div><div><small>Cash over / short</small><strong class="${cashVariance<0?'gc-negative':cashVariance>0?'gc-positive':''}">${money(cashVariance)}</strong></div><div><small>Tender variance</small><strong class="${tenderVariance<0?'gc-negative':tenderVariance>0?'gc-positive':''}">${money(tenderVariance)}</strong></div>`;
  }

  function openCloseout() {
    const dialog = ensureDialog();
    dialog.innerHTML = `<form id="gc-closeout-form">${dialogHead('Management close','End-of-day reconciliation')}<div class="gc-form-grid">
      <label>Business date<input name="business_date" type="date" value="${esc(summary?.business_date || todayLocal())}" required></label>
      <label>POS report / batch reference<input name="pos_reference" placeholder="Optional"></label>
      <label>Gross sales before discounts<input name="gross_sales" type="number" min="0" step="0.01" value="${centsToDollars(summary?.current_sales_cents)}" required></label>
      <label>Discounts<input name="discounts" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Refunds<input name="refunds" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Net sales before tax<input name="net_sales" type="number" min="0" step="0.01" value="${centsToDollars(summary?.current_sales_cents)}" required></label>
      <label>Tax collected<input name="tax_collected" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Transaction count<input name="transaction_count" type="number" min="0" step="1"></label>
      <label>Cash tender<input name="cash_tender" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Card tender<input name="card_tender" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Other tender<input name="other_tender" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Opening cash<input name="opening_cash" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Cash paid out<input name="cash_paid_out" type="number" min="0" step="0.01" value="0.00" required></label>
      <label>Actual drawer count<input name="actual_drawer" type="number" min="0" step="0.01" value="0.00" required></label>
      <label class="full">Closeout notes<textarea name="notes" placeholder="Required if a variance exceeds $1.00"></textarea></label>
    </div><div class="gc-closeout-preview"></div><p class="gc-sales-note">Tender total should equal net sales + tax. Expected drawer = opening cash + cash tender − paid-outs.</p><p class="auth-message"></p><div class="modal-actions"><button type="button" class="secondary-button" data-gc-close-dialog>Cancel</button><button class="primary-button">Close business day</button></div></form>`;
    dialog.showModal();
    closeoutPreview(dialog.querySelector('form'));
  }

  async function reopenDay() {
    const reason = prompt('Reason for reopening this business day');
    if (!reason?.trim()) return;
    if (training()) {
      saveTrainingData({ is_closed:false, close_status:'reopened' });
      return renderDashboard();
    }
    const result = await client.rpc('reopen_business_day', { target_date:summary.business_date, reason:reason.trim() });
    if (result.error) return alert(result.error.message);
    await loadSummary();
  }

  function settingsMarkup() {
    if (!profile || !managementRole(profile.role)) return '';
    const charge = Boolean(settings?.charge_parts_to_customer);
    return `<section id="gc-finance-settings" class="card gc-finance-settings"><div class="card-title"><div><p class="eyebrow">Finance controls</p><h2>Sales goals & part pricing</h2></div></div>
      <div class="gc-settings-switch"><div><strong>Charge customers for parts</strong><p>${charge ? 'ON — new part lines use the inventory sell price.' : 'OFF — inventory is consumed at actual cost, but new customer part lines are forced to $0.00.'} Existing work-order pricing is never rewritten.</p></div><label class="gc-switch"><input id="gc-charge-parts-toggle" type="checkbox" ${charge?'checked':''}><span></span></label></div>
      <form id="gc-goal-settings-form"><div class="gc-finance-settings-grid">
        <label>Launch daily baseline ($)<input name="launch_goal" type="number" min="0" step="1" value="${goalSettings?.launch_daily_goal_cents == null ? '' : ((goalSettings.launch_daily_goal_cents||0)/100).toFixed(0)}" placeholder="Optional fallback"></label>
        <label>Growth target (%)<input name="growth_target" type="number" min="-50" max="200" step="0.5" value="${Number(goalSettings?.growth_target_pct || 0)}"></label>
        <label>Adaptive goals<select name="adaptive"><option value="true" ${goalSettings?.adaptive_enabled!==false?'selected':''}>Enabled</option><option value="false" ${goalSettings?.adaptive_enabled===false?'selected':''}>Disabled</option></select></label>
      </div><p class="gc-sales-note">Launch priority: scheduled labor × target SPLH; then weekly forecast allocation; then this launch baseline. After enough reconciled POS days, historical performance is blended in automatically.</p><p class="auth-message"></p><div class="modal-actions"><button class="primary-button">Save finance settings</button></div></form>
    </section>`;
  }

  function ensureSettingsPanel() {
    const host = document.getElementById('settings');
    if (!host || !profile || !managementRole(profile.role)) return;
    const old = document.getElementById('gc-finance-settings');
    if (old) old.remove();
    host.insertAdjacentHTML('beforeend', settingsMarkup());
  }

  function renderWorkOrderMargin() {
    if (!managementRole(profile?.role)) return;
    const ops = window.GotCrackedOperationsV1;
    const ticket = ops?.state?.currentWorkOrder;
    const totals = document.querySelector('#work-order .v1-ticket-totals');
    if (!ticket || !totals) return;
    totals.parentElement?.querySelector('.gc-workorder-margin')?.remove();
    const parts = (ticket.work_order_items || []).filter(line => line.item_type === 'part');
    const partCost = parts.reduce((sum,line)=>sum+Math.round((Number(line.quantity)||1)*(Number(line.unit_cost_cents)||0)),0);
    const partRevenue = parts.reduce((sum,line)=>sum+Math.round((Number(line.quantity)||1)*(Number(line.unit_price_cents)||0)),0);
    const partMargin = partRevenue - partCost;
    totals.insertAdjacentHTML('afterend', `<section class="gc-workorder-margin"><header><strong>Management margin view</strong><small>Parts only · excludes labor/overhead</small></header><div class="gc-margin-grid"><div><small>Part revenue</small><strong>${money(partRevenue)}</strong></div><div><small>Part cost / COGS</small><strong>${money(partCost)}</strong></div><div><small>Part margin</small><strong class="${partMargin<0?'gc-negative':'gc-positive'}">${money(partMargin)}</strong></div></div></section>`);
  }

  function watchWorkOrders() {
    const host = document.getElementById('work-order');
    if (!host || workOrderObserver) return;
    let pending = false;
    workOrderObserver = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; renderWorkOrderMargin(); });
    });
    workOrderObserver.observe(host, { childList:true, subtree:true });
  }

  async function initialize() {
    await loadIdentity();
    if (!profile?.active) return;
    await loadSettings();
    await loadSummary();
    ensureSettingsPanel();
    watchWorkOrders();
    renderWorkOrderMargin();
  }

  document.addEventListener('click', event => {
    const close = event.target.closest('[data-gc-close-dialog]');
    if (close) return ensureDialog().close();
    const action = event.target.closest('[data-gc-sales-action]')?.dataset.gcSalesAction;
    if (action === 'snapshot') openSnapshot();
    if (action === 'goal') openGoal();
    if (action === 'closeout') openCloseout();
    if (action === 'reopen') reopenDay();
    const view = event.target.closest('[data-view]')?.dataset.view;
    if (view === 'settings') setTimeout(ensureSettingsPanel, 120);
    if (view === 'dashboard') setTimeout(renderDashboard, 120);
  });

  document.addEventListener('input', event => {
    if (event.target.closest('#gc-closeout-form')) closeoutPreview(event.target.closest('form'));
  });

  document.addEventListener('change', async event => {
    if (event.target.id !== 'gc-charge-parts-toggle') return;
    if (!managementRole(profile?.role)) return;
    const enabled = event.target.checked;
    if (training()) {
      localStorage.setItem('gc-training-charge-parts', enabled ? '1' : '0');
      settings = { ...(settings||{}), charge_parts_to_customer:enabled };
      ensureSettingsPanel();
      return;
    }
    const result = await client.from('business_settings').upsert({ location_id:profile.location_id, charge_parts_to_customer:enabled, updated_at:new Date().toISOString() }, { onConflict:'location_id' });
    if (result.error) { event.target.checked = !enabled; return alert(result.error.message); }
    settings = { ...(settings||{}), charge_parts_to_customer:enabled };
    ensureSettingsPanel();
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'gc-pos-snapshot-form') {
      event.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (training()) {
        saveTrainingData({ current_sales_cents:dollarsToCents(d.net_sales), last_updated_at:new Date().toISOString(), is_closed:false });
        ensureDialog().close(); return renderDashboard();
      }
      const result = await client.rpc('record_pos_sales_snapshot', { net_sales_cents:dollarsToCents(d.net_sales), transaction_count:d.transaction_count ? Number(d.transaction_count) : null, note:d.note?.trim() || null });
      if (result.error) return showFormError(form,result.error,'Failure to update POS sales');
      ensureDialog().close(); await loadSummary();
    }

    if (form.id === 'gc-sales-goal-form') {
      event.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (training()) {
        saveTrainingData({ goal_cents:dollarsToCents(d.goal), goal_method:'manual_override' });
        ensureDialog().close(); return renderDashboard();
      }
      const result = await client.rpc('set_daily_sales_goal', { target_date:summary?.business_date || todayLocal(), goal_cents:dollarsToCents(d.goal), reason:d.reason?.trim() || null });
      if (result.error) return showFormError(form,result.error,'Failure to update sales goal');
      ensureDialog().close(); await loadSummary();
    }

    if (form.id === 'gc-goal-settings-form') {
      event.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (training()) return;
      const result = await client.rpc('save_sales_goal_settings', { launch_daily_goal_cents:d.launch_goal ? dollarsToCents(d.launch_goal) : null, adaptive_enabled:d.adaptive === 'true', growth_target_pct:Number(d.growth_target || 0) });
      const status = form.querySelector('.auth-message');
      if (result.error) return showFormError(form,result.error,'Failure to save finance settings');
      status.textContent = 'Finance settings saved.';
      await loadSettings(); await loadSummary(); ensureSettingsPanel();
    }

    if (form.id === 'gc-closeout-form') {
      event.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      if (training()) {
        saveTrainingData({ current_sales_cents:dollarsToCents(d.net_sales), is_closed:true, close_status:'closed', last_updated_at:new Date().toISOString() });
        ensureDialog().close(); return renderDashboard();
      }
      const result = await client.rpc('close_business_day', {
        target_date:d.business_date, pos_reference:d.pos_reference?.trim() || null,
        pos_gross_sales_cents:dollarsToCents(d.gross_sales), pos_discount_cents:dollarsToCents(d.discounts), pos_refund_cents:dollarsToCents(d.refunds), pos_net_sales_cents:dollarsToCents(d.net_sales), tax_collected_cents:dollarsToCents(d.tax_collected),
        cash_tender_cents:dollarsToCents(d.cash_tender), card_tender_cents:dollarsToCents(d.card_tender), other_tender_cents:dollarsToCents(d.other_tender), transaction_count:d.transaction_count ? Number(d.transaction_count) : null,
        opening_cash_cents:dollarsToCents(d.opening_cash), cash_paid_out_cents:dollarsToCents(d.cash_paid_out), actual_drawer_cents:dollarsToCents(d.actual_drawer), notes:d.notes?.trim() || null
      });
      if (result.error) return showFormError(form,result.error,'Failure to close business day');
      ensureDialog().close(); await loadSummary();
    }
  });

  document.addEventListener('gc-portal-runtime-ready', initialize, { once:true });
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#settings')) setTimeout(ensureSettingsPanel,120);
    if (location.hash.startsWith('#dashboard')) setTimeout(renderDashboard,120);
  });

  setTimeout(initialize, 1800);
})();

