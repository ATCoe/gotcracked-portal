(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedPaymentCenter) return;

  const training = () => localStorage.getItem('gc-training-store') === '1';
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const profile = () => window.GotCrackedRuntimeProfile || window.GotCrackedOperationsV1?.state?.profile || null;
  const state = () => window.GotCrackedOperationsV1?.state || null;
  const isManager = () => ['owner','manager'].includes(profile()?.role);
  const friendlyProvider = value => String(value || 'Payment provider').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

  let config = null;
  let configPromise = null;
  let activePaymentRequestId = null;
  let settingsObserver = null;

  const METHOD_LABELS = {
    cash:'Cash',
    external_pos_card:'Physical card / external POS',
    external_pos_other:'External POS / other',
    cash_app:'Cash App',
    zelle:'Zelle',
    chime:'Chime',
    paypal:'PayPal'
  };

  function defaultConfig(){
    return {
      prepay_required:false,
      routing_mode:'hybrid',
      methods:{cash:true,external_pos_card:true,external_pos_other:true,cash_app:true,zelle:true,chime:true,paypal:false},
      paypal_automatic_verification:false,
      online:{architecture_ready:true,provider_key:null,provider_label:null,connection_status:'disconnected',environment:'test',customer_enabled:false,available:false,partial_payments:false,auto_apply_verified:true,checkout_expiry_minutes:30,capabilities:{}}
    };
  }

  async function loadConfig(force=false){
    if (training()) return defaultConfig();
    if (config && !force) return config;
    if (configPromise && !force) return configPromise;
    configPromise = (async()=>{
      const result = await client.rpc('get_payment_configuration');
      if (result.error) {
        // During a rolling deploy the runtime may arrive before migration 0032.
        // Fail open until the database policy exists; the DB trigger becomes the
        // final authority once the migration is applied.
        console.warn('Payment configuration is not available yet.', result.error);
        return null;
      }
      config = result.data || defaultConfig();
      return config;
    })().finally(()=>{configPromise=null;});
    return configPromise;
  }

  function injectStyle(){
    if (document.getElementById('gc-payment-center-style')) return;
    const style=document.createElement('style');
    style.id='gc-payment-center-style';
    style.textContent=`
      .gc-payment-dialog{border:0;padding:0;border-radius:18px;width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-shadow:0 24px 80px rgba(0,0,0,.35);background:var(--surface,#fff);color:var(--text,#101827)}
      .gc-payment-dialog::backdrop{background:rgba(6,15,28,.68);backdrop-filter:blur(3px)}
      .gc-payment-shell{padding:22px}.gc-payment-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.gc-payment-head h2{margin:.15rem 0 .25rem}.gc-payment-head p{margin:0;color:var(--muted,#667085)}
      .gc-payment-amount{display:grid;grid-template-columns:1fr auto;align-items:end;gap:12px;padding:16px;border:1px solid var(--line,#d9e2ec);border-radius:14px;background:var(--surface-subtle,#f7f9fc);margin:14px 0}.gc-payment-amount label{margin:0}.gc-payment-amount strong{font-size:1.35rem;white-space:nowrap;padding-bottom:9px}
      .gc-payment-form{display:grid;gap:13px}.gc-payment-form label{display:grid;gap:6px}.gc-payment-form input,.gc-payment-form select,.gc-payment-form textarea{width:100%}.gc-payment-confirm{display:flex!important;grid-template-columns:none!important;align-items:flex-start;gap:10px!important;padding:12px;border-radius:12px;background:var(--surface-subtle,#f7f9fc)}.gc-payment-confirm input{width:auto;margin-top:3px}.gc-payment-note{font-size:.88rem;color:var(--muted,#667085);margin:0}.gc-payment-warning{padding:12px 14px;border-radius:12px;background:rgba(235,160,40,.12);border:1px solid rgba(235,160,40,.35);font-size:.9rem}.gc-payment-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:6px}.gc-payment-status{min-height:1.2em;margin:0;color:var(--muted,#667085)}.gc-payment-status.is-error{color:#b42318}
      .gc-pay-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:14px 0}.gc-pay-toggle{display:flex!important;grid-template-columns:none!important;align-items:center;gap:10px!important;padding:12px 14px;border:1px solid var(--line,#d9e2ec);border-radius:12px}.gc-pay-toggle input{width:auto}.gc-pay-settings-row{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr);gap:14px}.gc-pay-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.75rem;font-weight:700;background:rgba(43,124,255,.12)}
      .gc-online-architecture{margin:18px 0;padding:18px;border:1px solid var(--line,#d9e2ec);border-radius:16px;background:var(--surface-subtle,#f7f9fc)}.gc-online-architecture-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.gc-online-architecture-head h3{margin:2px 0 4px}.gc-online-architecture-head p{margin:0;color:var(--muted,#667085)}.gc-online-statuses{display:flex;gap:7px;flex-wrap:wrap}.gc-online-statuses span{border:1px solid var(--line,#d9e2ec);border-radius:999px;padding:5px 9px;font-size:.74rem;font-weight:750}.gc-online-contract{margin-top:12px;padding:12px;border-radius:12px;border:1px dashed var(--line,#d9e2ec);font-size:.84rem;color:var(--muted,#667085)}
      @media(max-width:640px){.gc-payment-shell{padding:17px}.gc-payment-amount{grid-template-columns:1fr}.gc-payment-amount strong{display:none}.gc-pay-settings-row{grid-template-columns:1fr}.gc-payment-actions>*{flex:1 1 140px;min-height:44px}.gc-online-architecture-head{display:grid}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog(){
    injectStyle();
    let dialog=document.getElementById('gc-prepay-dialog');
    if(!dialog){
      dialog=document.createElement('dialog');
      dialog.id='gc-prepay-dialog';
      dialog.className='gc-payment-dialog';
      document.body.appendChild(dialog);
    }
    return dialog;
  }

  function methodOptions(cfg){
    return Object.entries(METHOD_LABELS).filter(([key])=>cfg?.methods?.[key]).map(([key,label])=>{
      const blocked=key==='paypal'&&!cfg?.paypal_automatic_verification;
      return `<option value="${key}" ${blocked?'disabled':''}>${esc(label)}${blocked?' — connection required':''}</option>`;
    }).join('');
  }

  function referenceRequired(method){
    return ['cash','external_pos_card','external_pos_other','cash_app','zelle','chime'].includes(method);
  }

  function methodHelp(method,cfg){
    if(method==='cash') return 'Ring the cash payment in the external POS first, then enter its receipt or transaction reference and confirm the cash was received.';
    if(method==='external_pos_card'||method==='external_pos_other') return 'Complete the transaction in the physical/external POS first, then enter its receipt or transaction reference.';
    if(['cash_app','zelle','chime'].includes(method)) return `${METHOD_LABELS[method]} does not provide GotCracked a universal merchant webhook we can safely trust for every account. Verify the transfer in the provider and record its confirmation/reference before continuing.`;
    if(method==='paypal') return cfg?.paypal_automatic_verification ? 'The work order will stay blocked until PayPal confirms the payment server-to-server.' : 'PayPal automatic verification must be connected before this method can be used.';
    return '';
  }

  function paymentMarkup(cfg){
    return `<div class="gc-payment-shell">
      <div class="gc-payment-head"><div><p class="eyebrow">Required before work order</p><h2>Confirm pre-payment</h2><p>A work order will not be created until this payment is verified.</p></div><button class="icon-button" type="button" data-gc-pay-close aria-label="Close">×</button></div>
      <form id="gc-prepay-form" class="gc-payment-form">
        <div class="gc-payment-amount"><label>Amount received / due<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></label><strong data-gc-payment-preview>$0.00</strong></div>
        <label>Payment method<select name="method" required>${methodOptions(cfg)}</select></label>
        <p class="gc-payment-note" data-gc-method-help></p>
        <label data-gc-reference-wrap>Transaction / receipt reference<input name="reference" autocomplete="off" placeholder="Receipt, confirmation, or transaction ID"></label>
        <label>Payment note<textarea name="note" rows="2" placeholder="Optional internal note"></textarea></label>
        <label class="gc-payment-confirm"><input name="confirmed" type="checkbox" required><span>I verified that the payment shown above was actually received/completed before creating this work order.</span></label>
        <div class="gc-payment-warning">Online payment methods are never marked paid from a customer screenshot alone. Provider-backed methods require a trusted callback; methods without a universal verification API retain an employee-audited confirmation trail.</div>
        <p class="gc-payment-status" role="status"></p>
        <div class="gc-payment-actions"><button class="secondary-button" type="button" data-gc-pay-close>Cancel</button><button class="primary-button" type="submit">Verify payment & create work order</button></div>
      </form>
    </div>`;
  }

  function refreshMethodForm(form,cfg){
    const method=form.elements.method?.value || 'cash';
    const wrap=form.querySelector('[data-gc-reference-wrap]');
    const input=form.elements.reference;
    if(wrap&&input){
      const required=referenceRequired(method);
      input.required=required;
      wrap.style.display=required?'grid':'none';
    }
    const help=form.querySelector('[data-gc-method-help]');
    if(help)help.textContent=methodHelp(method,cfg);
  }

  async function openPrepayDialog(cfg){
    const dialog=ensureDialog();
    dialog.innerHTML=paymentMarkup(cfg);
    const form=dialog.querySelector('#gc-prepay-form');
    refreshMethodForm(form,cfg);
    dialog.showModal();

    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;if(dialog.open)dialog.close();resolve(value);};
      const close=()=>finish(null);
      dialog.querySelectorAll('[data-gc-pay-close]').forEach(btn=>btn.addEventListener('click',close,{once:true}));
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{once:true});
      form.elements.method.addEventListener('change',()=>refreshMethodForm(form,cfg));
      form.elements.amount.addEventListener('input',()=>{
        const cents=Math.round(Number(form.elements.amount.value||0)*100);
        const preview=form.querySelector('[data-gc-payment-preview]');
        if(preview)preview.textContent=money(cents);
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const status=form.querySelector('.gc-payment-status');
        const button=form.querySelector('button[type="submit"]');
        status.classList.remove('is-error');
        status.textContent='';
        const cents=Math.round(Number(form.elements.amount.value||0)*100);
        const method=form.elements.method.value;
        const reference=String(form.elements.reference.value||'').trim();
        const note=String(form.elements.note.value||'').trim();
        if(cents<=0){status.textContent='Enter the amount received.';status.classList.add('is-error');return;}
        if(!form.elements.confirmed.checked){status.textContent='Confirm that the payment was actually received.';status.classList.add('is-error');return;}
        if(referenceRequired(method)&&!reference){status.textContent='Enter the external transaction or receipt reference.';status.classList.add('is-error');return;}
        button.disabled=true;button.textContent='Verifying…';
        try{
          let result;
          if(method==='paypal'){
            result=await client.rpc('create_provider_payment_request',{requested_amount_cents:cents,requested_method:method,payment_note:note||null});
            if(result.error)throw result.error;
            status.textContent='Waiting for automatic PayPal verification. The work order remains blocked.';
            button.disabled=false;button.textContent='Waiting for PayPal';
            return;
          }
          result=await client.rpc('record_manual_prepayment',{paid_amount_cents:cents,paid_method:method,paid_reference:reference||null,payment_note:note||null});
          if(result.error)throw result.error;
          finish(result.data);
        }catch(error){
          status.textContent=error?.message||'Unable to verify this payment.';
          status.classList.add('is-error');
          button.disabled=false;button.textContent='Verify payment & create work order';
          window.GotCrackedDiagnostics?.error?.(error,{context:'Failure to verify repair pre-payment'});
        }
      });
    });
  }

  function patchRepairTicketInsert(){
    if(client.__gcPaymentInsertPatched) return;
    const originalFrom=client.from.bind(client);
    client.from=function(table){
      const builder=originalFrom(table);
      if(table!=='repair_tickets'||!builder||typeof builder.insert!=='function') return builder;
      const originalInsert=builder.insert.bind(builder);
      builder.insert=function(values,options){
        if(!activePaymentRequestId) return originalInsert(values,options);
        const requestId=activePaymentRequestId;
        activePaymentRequestId=null;
        if(Array.isArray(values)) values=values.map(value=>({...value,payment_request_id:value?.payment_request_id||requestId}));
        else values={...(values||{}),payment_request_id:values?.payment_request_id||requestId};
        return originalInsert(values,options);
      };
      return builder;
    };
    client.__gcPaymentInsertPatched=true;
  }

  function replay(button){
    if(!button)return;
    button.dataset.gcPaymentBypass='true';
    button.click();
    setTimeout(()=>delete button.dataset.gcPaymentBypass,0);
  }

  async function interceptWorkOrderCreation(event){
    if(training()) return;
    const target=event.target instanceof Element?event.target:null;
    if(!target) return;
    const intakeButton=target.closest('[data-v1-intake-create]');
    const convertButton=target.closest('[data-v1-convert-lead]');
    const button=intakeButton||convertButton;
    if(!button) return;
    if(button.matches('[data-gc-payment-bypass="true"]')) return;

    // Stop the legacy handler synchronously. Waiting to do this until after an async
    // configuration lookup allows the original click handler to create a work order
    // before the payment gate has a chance to run.
    event.preventDefault();
    event.stopImmediatePropagation();

    let cfg=null;
    try{cfg=await loadConfig();}
    catch(error){
      console.warn('Unable to load payment configuration; allowing legacy workflow.',error);
      replay(button);
      return;
    }

    // Rolling-deploy fail-open: if the new DB functions are not live yet, replay the
    // original action. Once migration 0032 is installed, the database trigger is the
    // final authority and this path can no longer create an unpaid work order.
    if(!cfg||!cfg.prepay_required){
      replay(button);
      return;
    }

    if(convertButton){
      alert('Pre-payment is required before a work order can be created. Keep this customer in Leads until intake/payment, then create the repair from New Repair / Walk-in.');
      return;
    }

    // Legacy pending-arrival tickets already existed before the prepay gate. Do not
    // collect an orphaned second payment simply to receive one of those records.
    if(state()?.intake?.pendingTicket){
      replay(intakeButton);
      return;
    }

    const payment=await openPrepayDialog(cfg);
    if(!payment?.id) return;
    activePaymentRequestId=payment.id;
    replay(intakeButton);
  }

  function settingsMarkup(cfg){
    const m=cfg.methods||{},online={...defaultConfig().online,...(cfg.online||{})};
    const providers=[['','Not selected yet'],['stripe','Stripe'],['square','Square'],['paypal','PayPal'],['clover','Clover'],['custom_api','Custom / payment API']];
    if(online.provider_key&&!providers.some(([key])=>key===online.provider_key))providers.push([online.provider_key,online.provider_label||friendlyProvider(online.provider_key)]);
    const providerOptions=providers.map(([key,label])=>`<option value="${esc(key)}" ${online.provider_key===key?'selected':''}>${esc(label)}</option>`).join('');
    const connectionLabel=String(online.connection_status||'disconnected').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
    return `<article id="gc-payment-settings" class="card" style="margin-bottom:18px">
      <div class="card-title"><div><p class="eyebrow">Payments</p><h2>Payment orchestration</h2><p>One payment ledger for customer checkout, counter payments, receipts, and reconciliation.</p></div><span class="gc-pay-badge">PAYMENT CORE READY</span></div>
      <form id="gc-payment-settings-form" class="settings-list">
        <div class="gc-pay-settings-row"><label>Repair payment timing<select name="prepay"><option value="false" selected>Payment when due / before pickup</option></select><small>Repairs are not blocked at intake. Customer pre-payment can be accepted later when an eligible repair has a balance.</small></label><label>Counter payment routing<select name="routing"><option value="hybrid" ${cfg.routing_mode==='hybrid'?'selected':''}>Hybrid — Portal + external POS</option><option value="internal" ${cfg.routing_mode==='internal'?'selected':''}>Portal-first</option><option value="external" ${cfg.routing_mode==='external'?'selected':''}>External POS-first</option></select></label></div>
        <section class="gc-online-architecture"><div class="gc-online-architecture-head"><div><p class="eyebrow">Customer online checkout</p><h3>Provider-ready payment gateway</h3><p>The customer account, provider callback, refund ledger, receipt credit, and pickup balance are already wired.</p></div><div class="gc-online-statuses"><span>Architecture ready</span><span>${esc(connectionLabel)}</span><span>${online.environment==='live'?'Live mode':'Test mode'}</span></div></div>
          <div class="gc-pay-settings-row"><label>Payment provider<select name="online_provider">${providerOptions}</select><small>Select the provider shell now or leave it unselected until your merchant account exists.</small></label><label>Provider environment<select name="online_environment"><option value="test" ${online.environment!=='live'?'selected':''}>Test / sandbox</option><option value="live" ${online.environment==='live'?'selected':''}>Live / production</option></select><small>Changing this does not connect credentials.</small></label></div>
          <div class="gc-pay-settings-grid"><label class="gc-pay-toggle"><input type="checkbox" name="online_customer_enabled" ${online.customer_enabled?'checked':''}><span><strong>Customer checkout armed</strong><small>Becomes available only after provider connection verifies</small></span></label><label class="gc-pay-toggle"><input type="checkbox" name="online_partial" ${online.partial_payments?'checked':''}><span><strong>Allow partial online payments</strong><small>Off keeps Pay Before Pickup simple</small></span></label><label class="gc-pay-toggle"><input type="checkbox" name="online_auto_apply" ${online.auto_apply_verified!==false?'checked':''}><span><strong>Auto-apply verified payments</strong><small>Trusted callbacks reduce the repair balance</small></span></label></div>
          <label>Hosted checkout expiration (minutes)<input name="online_expiry" type="number" min="5" max="1440" step="1" value="${Number(online.checkout_expiry_minutes||30)}"></label>
          <div class="gc-online-contract"><strong>No API keys belong on this screen.</strong> Provider credentials remain server-side. When the merchant APIs are ready, GotCracked only needs the payment adapter URL/token and signed webhook secret (or a direct provider adapter). Redirects never mark a repair paid; only a verified provider callback can do that.</div>
        </section>
        <div class="card-title"><div><h3>Counter & manual tenders</h3><p>Methods staff can record during in-person reconciliation.</p></div></div><div class="gc-pay-settings-grid">${Object.entries(METHOD_LABELS).map(([key,label])=>`<label class="gc-pay-toggle"><input type="checkbox" name="method_${key}" ${m[key]?'checked':''}><span><strong>${esc(label)}</strong>${key==='paypal'?'<small>Legacy direct-method switch; provider checkout is configured above</small>':''}</span></label>`).join('')}</div>
        <div class="gc-payment-warning"><strong>Verification rules:</strong> customer online payments are provider-verified automatically. Counter cash/card and transfer methods retain a staff-audited reference trail. A customer screenshot or return URL is never accepted as proof of payment.</div>
        <p class="auth-message" role="status"></p><button class="primary-button" type="submit">Save payment architecture</button>
      </form>
    </article>`;
  }

  async function renderSettings(){
    if(!isManager()) return;
    const host=document.getElementById('settings');
    if(!host) return;
    const cfg=await loadConfig();
    if(!cfg) return;
    host.querySelector('#gc-payment-settings')?.remove();
    host.insertAdjacentHTML('afterbegin',settingsMarkup(cfg));
  }

  async function saveSettings(form){
    const status=form.querySelector('.auth-message');
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;status.textContent='Saving…';
    try{
      const args={
        required_default:form.elements.prepay.value==='true',
        routing_mode:form.elements.routing.value,
        cash_enabled:form.elements.method_cash.checked,
        external_card_enabled:form.elements.method_external_pos_card.checked,
        external_other_enabled:form.elements.method_external_pos_other.checked,
        cash_app_enabled:form.elements.method_cash_app.checked,
        zelle_enabled:form.elements.method_zelle.checked,
        chime_enabled:form.elements.method_chime.checked,
        paypal_enabled:form.elements.method_paypal.checked
      };
      const providerSelect=form.elements.online_provider;
      const onlineArgs={provider_key:providerSelect.value||null,provider_label:providerSelect.selectedOptions?.[0]?.textContent?.trim()||'Payment provider',provider_environment:form.elements.online_environment.value,customer_enabled:form.elements.online_customer_enabled.checked,partial_enabled:form.elements.online_partial.checked,auto_apply_verified:form.elements.online_auto_apply.checked,checkout_expiry_minutes:Math.round(Number(form.elements.online_expiry.value||30))};
      if(training()){
        config={...defaultConfig(),...config,prepay_required:false,routing_mode:args.routing_mode,methods:{cash:args.cash_enabled,external_pos_card:args.external_card_enabled,external_pos_other:args.external_other_enabled,cash_app:args.cash_app_enabled,zelle:args.zelle_enabled,chime:args.chime_enabled,paypal:args.paypal_enabled},online:{...defaultConfig().online,...config?.online,provider_key:onlineArgs.provider_key,provider_label:onlineArgs.provider_label,environment:onlineArgs.provider_environment,customer_enabled:onlineArgs.customer_enabled,partial_payments:onlineArgs.partial_enabled,auto_apply_verified:onlineArgs.auto_apply_verified,checkout_expiry_minutes:onlineArgs.checkout_expiry_minutes}};
      }else{
        const result=await client.rpc('save_payment_configuration',args);
        if(result.error)throw result.error;
        const onlineResult=await client.rpc('save_online_payment_configuration',onlineArgs);
        if(onlineResult.error)throw onlineResult.error;
        config=onlineResult.data;
      }
      status.textContent='Payment architecture saved. Provider credentials remain server-side and can be connected later.';
      setTimeout(renderSettings,250);
    }catch(error){
      status.textContent=error?.message||'Unable to save payment settings.';
      window.GotCrackedDiagnostics?.error?.(error,{context:'Failure to save payment settings'});
    }finally{button.disabled=false;}
  }

  function watchSettings(){
    const host=document.getElementById('settings');
    if(!host||settingsObserver) return;
    let queued=false;
    settingsObserver=new MutationObserver(()=>{
      if(location.hash.split('/')[0]!=='#settings'||queued||host.querySelector('#gc-payment-settings'))return;
      queued=true;setTimeout(()=>{queued=false;renderSettings();},80);
    });
    settingsObserver.observe(host,{childList:true,subtree:false});
  }

  patchRepairTicketInsert();
  injectStyle();
  document.addEventListener('click',interceptWorkOrderCreation,true);
  document.addEventListener('submit',event=>{
    const form=event.target.closest?.('#gc-payment-settings-form');
    if(!form)return;
    event.preventDefault();saveSettings(form);
  });
  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:location.hash.slice(1).split('/')[0];
    if(view==='settings')setTimeout(renderSettings,50);
  });
  document.addEventListener('gc-portal-runtime-ready',()=>{watchSettings();loadConfig();if(location.hash.startsWith('#settings'))renderSettings();},{once:true});
  if(document.readyState!=='loading'){watchSettings();loadConfig();}

  window.GotCrackedPaymentCenter={
    get configuration(){return config;},
    refresh:()=>loadConfig(true),
    renderSettings
  };
})();
