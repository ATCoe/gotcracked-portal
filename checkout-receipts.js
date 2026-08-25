(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client) return;

  const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format((Number(cents) || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const ticketCode = value => `GC-${String(value || '').replace(/\D/g,'').padStart(6,'0')}`;

  let workOrderObserver = null;
  let lastReceipt = null;

  function ops() { return window.GotCrackedOperationsV1; }
  function currentTicket() { return ops()?.state?.currentWorkOrder || null; }

  function ensureReceiptDialog() {
    let dialog = document.getElementById('gc-receipt-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'gc-receipt-dialog';
      dialog.className = 'gc-receipt-dialog';
      document.body.appendChild(dialog);
    }
    return dialog;
  }

  function lineRows(receipt) {
    const lines = Array.isArray(receipt?.line_items) ? receipt.line_items : [];
    return lines.map(line => `<tr><td><strong>${esc(line.description || line.sku || line.item_type || 'Repair item')}</strong><small>${esc(line.sku || line.item_type || '')}</small></td><td>${esc(line.quantity || 1)}</td><td>${money(line.line_total_cents ?? (Number(line.quantity || 1) * Number(line.unit_price_cents || 0)))}</td></tr>`).join('') || '<tr><td colspan="3">No line items recorded.</td></tr>';
  }

  function receiptMarkup(receipt) {
    const email = receipt.customer_email || '';
    return `<div class="gc-receipt-shell">
      <div class="modal-head"><div><p class="eyebrow">Sale Complete</p><h2>Receipt ${esc(receipt.receipt_number || '')}</h2></div><button type="button" class="icon-button" data-gc-receipt-close aria-label="Close">×</button></div>
      <div class="gc-receipt-success"><span>✓</span><div><strong>External POS sale recorded</strong><p>${money(receipt.amount_paid_cents ?? receipt.total_cents)} is now included in Portal sales/profit reporting for ${esc(receipt.business_date || 'today')}.</p></div></div>
      <section class="gc-receipt-paper" aria-label="Receipt preview">
        <header><div><strong class="gc-receipt-brand">GotCracked</strong><small>WE FIX WHAT LIFE CRACKS</small></div><div class="gc-receipt-number"><small>Receipt</small><strong>${esc(receipt.receipt_number || '')}</strong></div></header>
        <div class="gc-receipt-meta"><div><small>Customer</small><strong>${esc(receipt.customer_name || 'Customer')}</strong></div><div><small>Work order</small><strong>${ticketCode(receipt.ticket_number)}</strong></div><div><small>Device</small><strong>${esc(receipt.device_description || 'Device repair')}</strong></div><div><small>Date</small><strong>${esc(receipt.business_date || '')}</strong></div></div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${lineRows(receipt)}</tbody></table>
        <div class="gc-receipt-totals"><span>Subtotal <strong>${money(receipt.subtotal_cents)}</strong></span><span>Tax <strong>${money(receipt.tax_cents)}</strong></span><span class="total">Total <strong>${money(receipt.total_cents)}</strong></span><span>Paid through external POS <strong>${money(receipt.amount_paid_cents)}</strong></span></div>
        ${receipt.payment_reference ? `<p class="gc-receipt-reference">POS reference: ${esc(receipt.payment_reference)}</p>` : ''}
      </section>
      <p class="gc-receipt-delivery-note">${email ? `Customer email: <strong>${esc(email)}</strong>` : 'No customer email is on file. Print the receipt for the customer.'}</p>
      <p class="auth-message gc-receipt-status" role="status"></p>
      <div class="modal-actions gc-receipt-actions">
        <button type="button" class="secondary-button" data-gc-print-receipt>Print 8.5×11 receipt</button>
        ${email ? '<button type="button" class="primary-button" data-gc-email-receipt>Email receipt</button>' : ''}
        <button type="button" class="secondary-button" data-gc-receipt-close>Done</button>
      </div>
    </div>`;
  }

  function showReceipt(receipt) {
    if (!receipt) return;
    lastReceipt = receipt;
    const dialog = ensureReceiptDialog();
    dialog.innerHTML = receiptMarkup(receipt);
    if (!dialog.open) dialog.showModal();
  }

  function checkoutMarkup(ticket) {
    const total = Number(ticket?.total_cents || 0);
    return `<h3>External POS checkout</h3>
      <div class="gc-pos-checkout-callout"><strong>Amount to ring in POS</strong><span>${money(total)}</span></div>
      <p>Complete the customer transaction in the external POS first. Then confirm it here so Portal can mark the work order Sale Complete and create the receipt.</p>
      <label>POS tender<select name="tender"><option value="external_pos_card">Card</option><option value="external_pos_cash">Cash</option><option value="external_pos_other">Other / mixed tender</option></select></label>
      <label>POS receipt / transaction reference<input name="reference" autocomplete="off" placeholder="Optional POS receipt or batch reference"></label>
      <label class="gc-pos-confirm"><input type="checkbox" name="confirmed" required><span>I completed the ${money(total)} transaction in the external POS.</span></label>
      <input type="hidden" name="ticket_id" value="${esc(ticket.id)}">
      <button class="primary-button" type="submit">Confirm Sale Complete</button>
      <p class="operation-status" role="status"></p>`;
  }

  function enhanceCheckoutForm() {
    const form = document.getElementById('v1-checkout-form');
    const ticket = currentTicket();
    if (!form || !ticket || form.dataset.gcExternalPos === 'true') return;
    if (!['repaired','ready_for_pickup'].includes(String(ticket.status))) return;
    form.dataset.gcExternalPos = 'true';
    form.innerHTML = checkoutMarkup(ticket);
  }

  async function getReceiptForTicket(ticketId) {
    if (!ticketId || training()) return null;
    const result = await client.from('receipts').select('*').eq('ticket_id',ticketId).maybeSingle();
    return result.error ? null : result.data;
  }

  async function enhanceCompletedReceiptAction() {
    const ticket = currentTicket();
    const host = document.querySelector('#work-order .v1-actions');
    if (!ticket || !host || String(ticket.status) !== 'sale_complete' || host.querySelector('[data-gc-open-receipt]')) return;
    const receipt = await getReceiptForTicket(ticket.id);
    if (!receipt || !document.body.contains(host)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.dataset.gcOpenReceipt = receipt.id;
    button.textContent = `Receipt ${receipt.receipt_number}`;
    host.prepend(button);
  }

  function watchWorkOrder() {
    const host = document.getElementById('work-order');
    if (!host || workOrderObserver) return;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        enhanceCheckoutForm();
        enhanceCompletedReceiptAction();
      });
    };
    workOrderObserver = new MutationObserver(refresh);
    workOrderObserver.observe(host, { childList:true, subtree:true });
    refresh();
  }

  function saveTrainingReceipt(ticket, tender, reference) {
    const receipt = {
      receipt_id:`training-receipt-${Date.now()}`,
      receipt_number:`TRAIN-${String(Date.now()).slice(-6)}`,
      ticket_id:ticket.id,
      ticket_number:ticket.ticket_number,
      business_date:new Date().toISOString().slice(0,10),
      customer_name:`${ticket.customers?.first_name || ''} ${ticket.customers?.last_name || ''}`.trim() || 'Training Customer',
      customer_email:ticket.customers?.email || null,
      device_description:[ticket.devices?.manufacturer,ticket.devices?.model].filter(Boolean).join(' ') || 'Training device',
      subtotal_cents:ticket.subtotal_cents || 0,
      tax_cents:ticket.tax_cents || 0,
      total_cents:ticket.total_cents || 0,
      amount_paid_cents:ticket.total_cents || 0,
      payment_method:tender,
      payment_reference:reference || null,
      line_items:(ticket.work_order_items || []).map(line => ({...line,line_total_cents:Math.round(Number(line.quantity || 1)*Number(line.unit_price_cents || 0))})),
      created_at:new Date().toISOString()
    };
    ticket.payment_status = 'paid';
    ticket.amount_paid_cents = ticket.total_cents || 0;
    ticket.payment_method = tender;
    ticket.payment_reference = reference || null;
    ticket.paid_at = new Date().toISOString();
    ticket.status = 'sale_complete';
    ticket.pickup_at = new Date().toISOString();
    ticket.completed_at = new Date().toISOString();
    ticket.sale_completed_at = new Date().toISOString();
    ticket.sale_business_date = receipt.business_date;
    const data = JSON.parse(localStorage.getItem('gc-training-data-v1') || '{}');
    const storedTicket = (data.workOrders || []).find(item => item.id === ticket.id);
    if (storedTicket) Object.assign(storedTicket,ticket);
    localStorage.setItem('gc-training-data-v1',JSON.stringify(data));
    const receipts = JSON.parse(localStorage.getItem('gc-training-receipts-v1') || '[]');
    receipts.unshift(receipt);
    localStorage.setItem('gc-training-receipts-v1',JSON.stringify(receipts.slice(0,50)));
    return receipt;
  }

  async function finalizeCheckout(form) {
    const ticket = currentTicket();
    const status = form.querySelector('.operation-status');
    if (!ticket) return;
    if (!form.elements.confirmed?.checked) {
      status.textContent = 'Confirm that the external POS transaction is complete.';
      return;
    }
    const tender = form.elements.tender?.value || 'external_pos_card';
    const reference = form.elements.reference?.value?.trim() || null;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Recording sale…';
    status.textContent = '';

    try {
      let receipt;
      if (training()) {
        receipt = saveTrainingReceipt(ticket,tender,reference);
      } else {
        const result = await client.rpc('finalize_external_pos_sale', {
          target_ticket:ticket.id,
          pos_reference:reference,
          pos_tender:tender,
          paid_amount_cents:Number(ticket.total_cents || 0)
        });
        if (result.error) throw result.error;
        receipt = result.data;
      }
      document.dispatchEvent(new CustomEvent('gc-sale-completed',{ detail:receipt }));
      showReceipt(receipt);
      try { await ops()?.reload?.(); } catch {}
    } catch (error) {
      status.textContent = error?.message || 'Unable to complete the sale.';
      button.disabled = false;
      button.textContent = 'Confirm Sale Complete';
    }
  }

  function printableReceiptHtml(receipt) {
    const logo = new URL('assets/gotcracked-portal-logo.png', location.href).href;
    return `<!doctype html><html><head><title>${esc(receipt.receipt_number)} · GotCracked</title><style>
      @page{size:Letter;margin:.55in}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#101827;margin:0;font-size:12pt}.sheet{max-width:7.4in;margin:auto}.logo{width:220px;max-height:100px;object-fit:contain;object-position:left center}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0a2342;padding-bottom:18px}.receipt-no{text-align:right}.receipt-no small,.meta small{display:block;color:#667085;text-transform:uppercase;font-size:9pt;letter-spacing:.05em}.receipt-no strong{font-size:17pt}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;margin:22px 0}.meta strong{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:18px}th{background:#eef4fb;text-align:left;padding:10px;border-bottom:1px solid #cfd8e3}th:nth-child(2),td:nth-child(2){text-align:center;width:60px}th:last-child,td:last-child{text-align:right;width:120px}td{padding:11px 10px;border-bottom:1px solid #e5e7eb}td small{display:block;color:#667085;font-size:9pt;margin-top:2px}.totals{width:310px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:5px 0}.totals .grand{border-top:2px solid #0a2342;margin-top:5px;padding-top:10px;font-size:15pt;font-weight:700}.foot{margin-top:42px;border-top:1px solid #d7dde6;padding-top:16px;color:#667085;font-size:10pt}.no-print{margin-top:20px;text-align:right}@media print{.no-print{display:none}}
    </style></head><body><div class="sheet"><div class="top"><img class="logo" src="${logo}" alt="GotCracked"><div class="receipt-no"><small>Receipt / invoice</small><strong>${esc(receipt.receipt_number)}</strong><p>${esc(receipt.business_date || '')}</p></div></div><div class="meta"><div><small>Customer</small><strong>${esc(receipt.customer_name || 'Customer')}</strong></div><div><small>Work order</small><strong>${ticketCode(receipt.ticket_number)}</strong></div><div><small>Device</small><strong>${esc(receipt.device_description || 'Device repair')}</strong></div><div><small>Payment</small><strong>External POS${receipt.payment_reference ? ` · ${esc(receipt.payment_reference)}` : ''}</strong></div></div><table><thead><tr><th>Repair item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${lineRows(receipt)}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(receipt.subtotal_cents)}</strong></div><div><span>Tax</span><strong>${money(receipt.tax_cents)}</strong></div><div class="grand"><span>Total</span><strong>${money(receipt.total_cents)}</strong></div><div><span>Amount paid</span><strong>${money(receipt.amount_paid_cents)}</strong></div></div><div class="foot"><strong>GotCracked</strong><br>Thank you for trusting us with your device. Keep this receipt with your repair records.</div><div class="no-print"><button onclick="window.print()">Print receipt</button></div></div></body></html>`;
  }

  async function printReceipt(receipt) {
    if (!receipt) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert('Allow pop-ups for GotCracked Portal to print the receipt.');
    printWindow.document.open();
    printWindow.document.write(printableReceiptHtml(receipt));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
    if (!training() && receipt.receipt_id) client.rpc('record_receipt_print',{target_receipt:receipt.receipt_id}).catch(()=>{});
  }

  async function emailReceipt(receipt, button) {
    const status = ensureReceiptDialog().querySelector('.gc-receipt-status');
    if (!receipt?.receipt_id) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = '';
    try {
      const result = await client.functions.invoke('send-receipt',{ body:{ receiptId:receipt.receipt_id } });
      if (result.error || !result.data?.ok) throw new Error(result.data?.error || result.error?.message || 'Unable to send receipt.');
      status.textContent = `Receipt emailed to ${result.data.email}.`;
      button.textContent = 'Email sent';
    } catch (error) {
      status.textContent = error?.message || 'Unable to send receipt.';
      button.disabled = false;
      button.textContent = 'Email receipt';
    }
  }

  async function refreshDashboardSales() {
    if (training()) return;
    const result = await client.rpc('get_sales_day_summary',{ target_date:null });
    if (result.error || !result.data) return;
    const s = result.data;
    const metric = [...document.querySelectorAll('#dashboard .metrics article')].find(card => card.querySelector('p')?.textContent?.includes('Today’s sales'));
    if (metric) {
      const strong = metric.querySelector('strong');
      if (strong) strong.textContent = money(s.current_sales_cents);
    }
    const card = document.getElementById('gc-sales-card');
    if (!card) return;
    const percent = Number(s.goal_cents) ? Math.max(0,Number(s.percent_to_goal || 0)) : 0;
    const fill = Math.min(percent,100);
    const thermo = card.querySelector('.gc-thermo-fill');
    const progress = card.querySelector('.gc-sales-progress span');
    if (thermo) thermo.style.height = `${fill}%`;
    if (progress) progress.style.width = `${fill}%`;
    const primary = card.querySelector('.gc-sales-primary');
    if (primary) primary.innerHTML = `<strong>${money(s.current_sales_cents)}</strong><span>${Number(s.goal_cents) ? `of ${money(s.goal_cents)}` : '· goal not configured'}</span>`;
    const toGoal = card.querySelector('.gc-sales-fact strong');
    if (toGoal) toGoal.textContent = Number(s.goal_cents) ? (percent >= 100 ? `${percent.toFixed(1)}% · goal met` : `${money(s.remaining_cents)} remaining`) : 'Set a launch goal';
  }

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'v1-checkout-form' || form.dataset.gcExternalPos !== 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finalizeCheckout(form);
  }, true);

  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-gc-receipt-close]')) return ensureReceiptDialog().close();
    if (target.closest('[data-gc-print-receipt]')) return printReceipt(lastReceipt);
    const emailButton = target.closest('[data-gc-email-receipt]');
    if (emailButton) return emailReceipt(lastReceipt,emailButton);
    const receiptButton = target.closest('[data-gc-open-receipt]');
    if (receiptButton) {
      const result = await client.from('receipts').select('*').eq('id',receiptButton.dataset.gcOpenReceipt).single();
      if (result.error) return alert(result.error.message);
      return showReceipt({...result.data,receipt_id:result.data.id});
    }
    if (target.closest('[data-view="dashboard"]')) setTimeout(refreshDashboardSales,100);
  }, true);

  document.addEventListener('gc-sale-completed', () => setTimeout(refreshDashboardSales,50));
  document.addEventListener('gc-portal-runtime-ready', () => setTimeout(watchWorkOrder,0));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(watchWorkOrder,0), { once:true });
  else setTimeout(watchWorkOrder,0);
})();
