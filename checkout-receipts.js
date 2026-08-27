(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedCheckoutReceipts) return;

  const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format((Number(cents) || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const training = () => localStorage.getItem('gc-training-store') === '1';
  const ticketCode = value => `GC-${String(value || '').replace(/\D/g,'').padStart(6,'0')}`;
  const methodLabel = value => ({
    cash:'Cash',
    external_pos_card:'Card',
    external_pos_cash:'Cash',
    external_pos_other:'Other / mixed tender',
    cash_app:'Cash App',
    zelle:'Zelle',
    chime:'Chime',
    paypal:'PayPal',
    prepaid:'Prepaid',
    split:'Split payment'
  })[value] || String(value || 'Payment').replaceAll('_',' ');

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

  function receiptPaymentBreakdown(receipt) {
    const prepaid = Number(receipt?.prepayment_amount_cents || 0);
    const checkout = Number(receipt?.checkout_amount_cents || 0);
    const rows = [];
    if (prepaid > 0) rows.push(`<span>Verified prepayment <strong>${money(prepaid)}</strong></span><small>${esc(methodLabel(receipt.prepayment_method))}${receipt.prepayment_reference ? ` · ${esc(receipt.prepayment_reference)}` : ''}</small>`);
    if (checkout > 0) rows.push(`<span>Final checkout payment <strong>${money(checkout)}</strong></span><small>${esc(methodLabel(receipt.checkout_payment_method))}${receipt.checkout_payment_reference ? ` · ${esc(receipt.checkout_payment_reference)}` : ''}</small>`);
    if (!rows.length) rows.push(`<span>Amount paid <strong>${money(receipt.amount_paid_cents)}</strong></span>`);
    return rows.join('');
  }

  function receiptMarkup(receipt) {
    const email = receipt.customer_email || '';
    return `<div class="gc-receipt-shell">
      <div class="modal-head"><div><p class="eyebrow">Sale Complete</p><h2>Receipt ${esc(receipt.receipt_number || '')}</h2></div><button type="button" class="icon-button" data-gc-receipt-close aria-label="Close">×</button></div>
      <div class="gc-receipt-success"><span>✓</span><div><strong>Sale recorded</strong><p>${money(receipt.amount_paid_cents ?? receipt.total_cents)} is now posted to the Portal sales and reconciliation ledger for ${esc(receipt.business_date || 'today')}.</p></div></div>
      <section class="gc-receipt-paper" aria-label="Receipt preview">
        <header><div><strong class="gc-receipt-brand">GotCracked</strong><small>WE FIX WHAT LIFE CRACKS</small></div><div class="gc-receipt-number"><small>Receipt</small><strong>${esc(receipt.receipt_number || '')}</strong></div></header>
        <div class="gc-receipt-meta"><div><small>Customer</small><strong>${esc(receipt.customer_name || 'Customer')}</strong></div><div><small>Work order</small><strong>${ticketCode(receipt.ticket_number)}</strong></div><div><small>Device</small><strong>${esc(receipt.device_description || 'Device repair')}</strong></div><div><small>Date</small><strong>${esc(receipt.business_date || '')}</strong></div></div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${lineRows(receipt)}</tbody></table>
        <div class="gc-receipt-totals"><span>Subtotal <strong>${money(receipt.subtotal_cents)}</strong></span><span>Tax <strong>${money(receipt.tax_cents)}</strong></span><span class="total">Total <strong>${money(receipt.total_cents)}</strong></span>${receiptPaymentBreakdown(receipt)}<span>Paid in full <strong>${money(receipt.amount_paid_cents)}</strong></span></div>
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

  async function getCheckoutSummary(ticket) {
    if (training()) {
      const total = Math.max(0,Number(ticket?.total_cents || 0));
      return { ticket_id:ticket?.id,total_cents:total,prepayment_amount_cents:0,balance_due_cents:total,overpayment_cents:0,prepay_required:false };
    }
    const result = await client.rpc('get_checkout_payment_summary',{ target_ticket:ticket.id });
    if (result.error) throw result.error;
    return result.data;
  }

  async function getPaymentConfig() {
    if (training()) return {
      methods:{cash:true,external_pos_card:true,external_pos_other:true,cash_app:true,zelle:true,chime:true,paypal:false},
      routes:{cash:{channel:'external_pos',requires_reference:true},external_pos_card:{channel:'external_pos',requires_reference:true},external_pos_other:{channel:'external_pos',requires_reference:true},cash_app:{channel:'internal',requires_reference:true},zelle:{channel:'internal',requires_reference:true},chime:{channel:'internal',requires_reference:true}}
    };
    const result=await client.rpc('get_payment_configuration');
    if(result.error) throw result.error;
    return result.data || {methods:{},routes:{}};
  }

  function paymentOptions(config) {
    const methods=config?.methods || {}, routes=config?.routes || {};
    const definitions=[
      ['cash','Cash'],['external_pos_card','Card'],['external_pos_other','Other / mixed tender'],
      ['cash_app','Cash App'],['zelle','Zelle'],['chime','Chime'],['paypal','PayPal']
    ];
    const enabled=definitions.filter(([key])=>Boolean(methods[key]));
    const external=enabled.filter(([key])=>(routes[key]?.channel || (key.startsWith('external_pos')||key==='cash'?'external_pos':'internal'))==='external_pos');
    const internal=enabled.filter(([key])=>(routes[key]?.channel || 'internal')==='internal');
    const options=rows=>rows.map(([key,label])=>`<option value="${esc(key)}" data-channel="${esc(routes[key]?.channel || (key.startsWith('external_pos')||key==='cash'?'external_pos':'internal'))}" data-reference="${routes[key]?.requires_reference===false?'optional':'required'}">${esc(label)}</option>`).join('');
    return `${external.length?`<optgroup label="External POS">${options(external)}</optgroup>`:''}${internal.length?`<optgroup label="Direct / internal">${options(internal)}</optgroup>`:''}` || '<option value="external_pos_card">Card</option>';
  }

  function paymentGuidance(select) {
    const option=select?.selectedOptions?.[0];
    const channel=option?.dataset.channel || 'external_pos';
    const label=option?.textContent?.trim() || 'payment';
    return channel==='internal'
      ? `Confirm the ${label} payment directly, then enter its confirmation or transaction reference. This sale will be classified as direct/internal revenue.`
      : `Complete the remaining balance in the external POS, then enter the POS receipt or transaction reference. Portal will include it in expected external sales for End Day reconciliation.`;
  }

  function checkoutMarkup(ticket, summary, config) {
    const total = Number(summary?.total_cents ?? ticket?.total_cents ?? 0);
    const prepaid = Number(summary?.prepayment_amount_cents || 0);
    const balance = Number(summary?.balance_due_cents || 0);
    const overpayment = Number(summary?.overpayment_cents || 0);
    const prepaidDetail = prepaid > 0 ? `${methodLabel(summary.prepayment_method)}${summary.prepayment_reference ? ` · ${esc(summary.prepayment_reference)}` : ''}` : 'No verified prepayment';

    if (overpayment > 0) {
      return `<h3>Payment reconciliation required</h3>
        <div class="gc-pos-checkout-callout"><strong>Work-order total</strong><span>${money(total)}</span></div>
        <div class="gc-payment-warning"><strong>Do not complete checkout.</strong> Verified prepayment exceeds the final work-order total by ${money(overpayment)}. Resolve/refund the excess payment before Sale Complete.</div>
        <input type="hidden" name="balance_due" value="0"><input type="hidden" name="overpayment" value="${overpayment}">
        <button class="primary-button" type="submit" disabled>Sale Complete blocked</button>
        <p class="operation-status" role="status"></p>`;
    }

    const options=paymentOptions(config);
    return `<h3>${balance > 0 ? 'Final checkout' : 'Payment reconciliation'}</h3>
      <div class="gc-pos-checkout-callout"><strong>Work-order total</strong><span>${money(total)}</span></div>
      <div class="gc-pos-checkout-callout"><strong>Verified prepayment credit</strong><span>− ${money(prepaid)}</span></div>
      <p class="gc-payment-note">${esc(prepaidDetail)}</p>
      <div class="gc-pos-checkout-callout"><strong>Remaining balance</strong><span>${money(balance)}</span></div>
      ${balance > 0 ? `<label>Payment method<select name="tender" data-gc-payment-method>${options}</select></label>
      <p class="gc-payment-note" data-gc-payment-guidance></p>
      <label>Receipt / transaction reference<input name="reference" autocomplete="off" required placeholder="Required receipt or transaction reference"></label>
      <label class="gc-pos-confirm"><input type="checkbox" name="confirmed" required><span>I verified the ${money(balance)} customer payment and payment method above.</span></label>` : `<div class="gc-receipt-success"><span>✓</span><div><strong>Nothing else is due.</strong><p>The verified prepayment fully covers the final work-order total.</p></div></div>
      <label class="gc-pos-confirm"><input type="checkbox" name="confirmed" required><span>I verified the prepayment and final total. No additional customer payment is due.</span></label>`}
      <input type="hidden" name="ticket_id" value="${esc(ticket.id)}">
      <input type="hidden" name="balance_due" value="${balance}">
      <input type="hidden" name="overpayment" value="0">
      <button class="primary-button" type="submit">${balance > 0 ? 'Confirm Sale Complete' : 'Complete Sale & Receipt'}</button>
      <p class="operation-status" role="status"></p>`;
  }

  async function enhanceCheckoutForm() {
    const form = document.getElementById('v1-checkout-form');
    const ticket = currentTicket();
    if (!form || !ticket) return;
    if (!['repaired','ready_for_pickup'].includes(String(ticket.status))) return;
    if (form.dataset.gcCheckoutLoading === 'true') return;
    if (form.dataset.gcCheckoutTicket === ticket.id && form.dataset.gcReconciledCheckout === 'true') return;

    form.dataset.gcCheckoutLoading = 'true';
    form.dataset.gcCheckoutTicket = ticket.id;
    try {
      const [summary,config] = await Promise.all([getCheckoutSummary(ticket),getPaymentConfig()]);
      if (!document.body.contains(form) || currentTicket()?.id !== ticket.id) return;
      form.dataset.gcReconciledCheckout = 'true';
      form.innerHTML = checkoutMarkup(ticket,summary,config);
      const select=form.querySelector('[data-gc-payment-method]');
      const guidance=form.querySelector('[data-gc-payment-guidance]');
      if(select&&guidance)guidance.textContent=paymentGuidance(select);
    } catch (error) {
      if (!document.body.contains(form)) return;
      form.dataset.gcReconciledCheckout = 'error';
      form.innerHTML = `<h3>Checkout unavailable</h3><div class="gc-payment-warning">Portal could not verify this work order’s payment balance. Sale Complete is blocked until the payment summary can be loaded.</div><p class="operation-status v1-error">${esc(error?.message || 'Unable to load payment summary.')}</p>`;
      window.GotCrackedDiagnostics?.error?.(error,{context:'Failure to load checkout payment reconciliation'});
    } finally {
      delete form.dataset.gcCheckoutLoading;
    }
  }

  async function getReceiptForTicket(ticketId) {
    if (!ticketId || training()) return null;
    const result = await client.from('receipts').select('*').eq('ticket_id',ticketId).maybeSingle();
    return result.error || !result.data ? null : {...result.data,receipt_id:result.data.id};
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
    button.dataset.gcOpenReceipt = receipt.id || receipt.receipt_id;
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
    workOrderObserver.observe(host,{childList:true,subtree:true});
    refresh();
  }

  function saveTrainingReceipt(ticket,tender,reference,summary) {
    const prepaid = Number(summary?.prepayment_amount_cents || 0);
    const checkout = Number(summary?.balance_due_cents ?? ticket.total_cents ?? 0);
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
      payment_method:prepaid > 0 && checkout > 0 ? 'split' : prepaid > 0 ? summary.prepayment_method : tender,
      payment_reference:reference || summary?.prepayment_reference || null,
      prepayment_amount_cents:prepaid,
      prepayment_method:summary?.prepayment_method || null,
      prepayment_reference:summary?.prepayment_reference || null,
      checkout_amount_cents:checkout,
      checkout_payment_method:checkout > 0 ? tender : null,
      checkout_payment_reference:checkout > 0 ? reference : null,
      line_items:(ticket.work_order_items || []).map(line => ({...line,line_total_cents:Math.round(Number(line.quantity || 1)*Number(line.unit_price_cents || 0))})),
      created_at:new Date().toISOString()
    };
    ticket.payment_status='paid';ticket.amount_paid_cents=ticket.total_cents||0;ticket.payment_method=receipt.payment_method;ticket.payment_reference=receipt.payment_reference;ticket.paid_at=new Date().toISOString();ticket.status='sale_complete';ticket.pickup_at=new Date().toISOString();ticket.completed_at=new Date().toISOString();ticket.sale_completed_at=new Date().toISOString();ticket.sale_business_date=receipt.business_date;
    const data=JSON.parse(localStorage.getItem('gc-training-data-v1')||'{}');
    const storedTicket=(data.workOrders||[]).find(item=>item.id===ticket.id);if(storedTicket)Object.assign(storedTicket,ticket);
    localStorage.setItem('gc-training-data-v1',JSON.stringify(data));
    const receipts=JSON.parse(localStorage.getItem('gc-training-receipts-v1')||'[]');receipts.unshift(receipt);localStorage.setItem('gc-training-receipts-v1',JSON.stringify(receipts.slice(0,50)));
    return receipt;
  }

  async function finalizeCheckout(form) {
    const ticket = currentTicket();
    const status = form.querySelector('.operation-status');
    if (!ticket || !status) return;
    const balance = Math.max(0,Number(form.elements.balance_due?.value || 0));
    const overpayment = Math.max(0,Number(form.elements.overpayment?.value || 0));
    if (overpayment > 0) { status.textContent='Resolve the excess prepayment before completing this sale.'; return; }
    if (!form.elements.confirmed?.checked) { status.textContent='Confirm the payment reconciliation before completing the sale.'; return; }
    const tender = balance > 0 ? (form.elements.tender?.value || 'external_pos_card') : 'prepaid';
    const reference = balance > 0 ? (form.elements.reference?.value?.trim() || null) : null;
    if (balance > 0 && !reference) { status.textContent='Enter the receipt, confirmation, or transaction reference.'; return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent='Recording sale…';status.textContent='';

    try {
      let receipt;
      if (training()) {
        const summary=await getCheckoutSummary(ticket);
        receipt=saveTrainingReceipt(ticket,tender,reference,summary);
      } else {
        const result=await client.rpc('finalize_repair_sale',{target_ticket:ticket.id,payment_method:tender,payment_reference:reference,paid_amount_cents:balance});
        if(result.error)throw result.error;
        receipt=result.data;
      }
      document.dispatchEvent(new CustomEvent('gc-sale-completed',{detail:receipt}));
      showReceipt(receipt);
      try{await ops()?.reload?.();}catch{}
    } catch(error) {
      status.textContent=error?.message||'Unable to complete the sale.';
      window.GotCrackedDiagnostics?.error?.(error,{context:'Failure to complete reconciled work order sale'});
      button.disabled=false;button.textContent=balance>0?'Confirm Sale Complete':'Complete Sale & Receipt';
    }
  }

  function printablePaymentBreakdown(receipt) {
    const prepaid=Number(receipt?.prepayment_amount_cents||0),checkout=Number(receipt?.checkout_amount_cents||0);
    return `${prepaid>0?`<div><span>Verified prepayment</span><strong>${money(prepaid)}</strong></div>`:''}${checkout>0?`<div><span>Final checkout</span><strong>${money(checkout)}</strong></div>`:''}<div><span>Amount paid</span><strong>${money(receipt.amount_paid_cents)}</strong></div>`;
  }

  function printableReceiptHtml(receipt) {
    const logo=new URL('assets/gotcracked-portal-logo.png',location.href).href;
    return `<!doctype html><html><head><title>${esc(receipt.receipt_number)} · GotCracked</title><style>@page{size:Letter;margin:.55in}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#101827;margin:0;font-size:12pt}.sheet{max-width:7.4in;margin:auto}.logo{width:220px;max-height:100px;object-fit:contain;object-position:left center}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0a2342;padding-bottom:18px}.receipt-no{text-align:right}.receipt-no small,.meta small{display:block;color:#667085;text-transform:uppercase;font-size:9pt;letter-spacing:.05em}.receipt-no strong{font-size:17pt}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;margin:22px 0}.meta strong{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:18px}th{background:#eef4fb;text-align:left;padding:10px;border-bottom:1px solid #cfd8e3}th:nth-child(2),td:nth-child(2){text-align:center;width:60px}th:last-child,td:last-child{text-align:right;width:120px}td{padding:11px 10px;border-bottom:1px solid #e5e7eb}td small{display:block;color:#667085;font-size:9pt;margin-top:2px}.totals{width:310px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:5px 0}.totals .grand{border-top:2px solid #0a2342;margin-top:5px;padding-top:10px;font-size:15pt;font-weight:700}.foot{margin-top:42px;border-top:1px solid #d7dde6;padding-top:16px;color:#667085;font-size:10pt}.no-print{margin-top:20px;text-align:right}@media print{.no-print{display:none}}</style></head><body><div class="sheet"><div class="top"><img class="logo" src="${logo}" alt="GotCracked"><div class="receipt-no"><small>Receipt / invoice</small><strong>${esc(receipt.receipt_number)}</strong><p>${esc(receipt.business_date||'')}</p></div></div><div class="meta"><div><small>Customer</small><strong>${esc(receipt.customer_name||'Customer')}</strong></div><div><small>Work order</small><strong>${ticketCode(receipt.ticket_number)}</strong></div><div><small>Device</small><strong>${esc(receipt.device_description||'Device repair')}</strong></div><div><small>Payment</small><strong>${esc(methodLabel(receipt.payment_method))}</strong></div></div><table><thead><tr><th>Repair item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${lineRows(receipt)}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(receipt.subtotal_cents)}</strong></div><div><span>Tax</span><strong>${money(receipt.tax_cents)}</strong></div><div class="grand"><span>Total</span><strong>${money(receipt.total_cents)}</strong></div>${printablePaymentBreakdown(receipt)}</div><div class="foot"><strong>GotCracked</strong><br>Thank you for trusting us with your device. Keep this receipt with your repair records.</div><div class="no-print"><button onclick="window.print()">Print receipt</button></div></div></body></html>`;
  }

  async function printReceipt(receipt) {
    if(!receipt)return;
    const printWindow=window.open('','_blank');
    if(!printWindow)return alert('Allow pop-ups for GotCracked Portal to print the receipt.');
    printWindow.document.open();
    printWindow.document.write(printableReceiptHtml(receipt));
    printWindow.document.close();printWindow.focus();setTimeout(()=>printWindow.print(),250);
    if(!training()&&receipt.receipt_id)client.rpc('record_receipt_print',{target_receipt:receipt.receipt_id}).catch(()=>{});
  }

  async function emailReceipt(receipt,button) {
    const status=ensureReceiptDialog().querySelector('.gc-receipt-status');
    if(!receipt?.receipt_id)return;
    button.disabled=true;button.textContent='Sending…';status.textContent='';
    try{
      const result=await client.functions.invoke('send-receipt',{body:{receiptId:receipt.receipt_id}});
      if(result.error||!result.data?.ok)throw new Error(result.data?.error||result.error?.message||'Unable to send receipt.');
      status.textContent=`Receipt emailed to ${result.data.email}.`;button.textContent='Email sent';
    }catch(error){status.textContent=error?.message||'Unable to send receipt.';window.GotCrackedDiagnostics?.error?.(error,{context:'Failure to email receipt'});button.disabled=false;button.textContent='Email receipt';}
  }

  async function refreshDashboardSales() {
    if(training())return;
    if(window.GotCrackedSalesOps?.loadSummary) return window.GotCrackedSalesOps.loadSummary({quiet:true});
    const result=await client.rpc('get_sales_day_summary',{target_date:null});
    if(result.error||!result.data)return;
    const metric=[...document.querySelectorAll('#dashboard .metrics article')].find(card=>card.querySelector('p')?.textContent?.includes('Today’s sales'));
    if(metric){const strong=metric.querySelector('strong');if(strong)strong.textContent=money(result.data.current_sales_cents);}
  }

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement)||form.id!=='v1-checkout-form'||form.dataset.gcReconciledCheckout!=='true')return;
    event.preventDefault();event.stopImmediatePropagation();finalizeCheckout(form);
  },true);

  document.addEventListener('change',event=>{
    const select=event.target instanceof Element ? event.target.closest('[data-gc-payment-method]') : null;
    if(!select)return;
    const form=select.closest('#v1-checkout-form');
    const guidance=form?.querySelector('[data-gc-payment-guidance]');
    if(guidance)guidance.textContent=paymentGuidance(select);
  });

  document.addEventListener('click',async event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-gc-receipt-close]'))return ensureReceiptDialog().close();
    if(target.closest('[data-gc-print-receipt]'))return printReceipt(lastReceipt);
    const emailButton=target.closest('[data-gc-email-receipt]');if(emailButton)return emailReceipt(lastReceipt,emailButton);
    const receiptButton=target.closest('[data-gc-open-receipt]');if(receiptButton){const result=await client.from('receipts').select('*').eq('id',receiptButton.dataset.gcOpenReceipt).single();if(result.error)return alert(result.error.message);return showReceipt({...result.data,receipt_id:result.data.id});}
    if(target.closest('[data-view="dashboard"]'))setTimeout(refreshDashboardSales,100);
  },true);

  document.addEventListener('gc-sale-completed',()=>setTimeout(refreshDashboardSales,50));
  document.addEventListener('gc-portal-runtime-ready',()=>setTimeout(watchWorkOrder,0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(watchWorkOrder,0),{once:true});else setTimeout(watchWorkOrder,0);

  window.GotCrackedCheckoutReceipts={version:'20260827-payment-reconcile2',refresh:enhanceCheckoutForm};
})();
