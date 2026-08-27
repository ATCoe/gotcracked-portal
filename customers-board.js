(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedCustomers) return;

  const VERSION = '20260827-production1';
  const state = {
    data:null,
    selectedId:null,
    search:'',
    loading:false,
    requestId:0
  };
  let searchTimer=null;

  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const friendly=value=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  const training=()=>localStorage.getItem('gc-training-store')==='1';
  const activeView=()=>location.hash.slice(1).split('/')[0]==='customers';
  const digits=value=>String(value||'').replace(/\D/g,'');
  const customerName=c=>[c?.first_name,c?.last_name].filter(Boolean).join(' ').trim()||'Customer';
  const ticketCode=value=>`GC-${String(value||'').replace(/\D/g,'').padStart(6,'0')}`;
  const date=value=>{
    if(!value)return '—';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '—';
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d);
  };
  const dateTime=value=>{
    if(!value)return '—';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '—';
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
  };

  function injectStyle(){
    if(document.querySelector('style[data-gc-customers-board]'))return;
    const style=document.createElement('style');
    style.dataset.gcCustomersBoard=VERSION;
    style.textContent=`
      #customers .gc-customer-shell{display:grid;gap:18px}
      #customers .gc-customer-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap}
      #customers .gc-customer-header h1{margin:2px 0 5px}
      #customers .gc-customer-actions{display:flex;gap:8px;flex-wrap:wrap}
      #customers .gc-customer-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      #customers .gc-customer-metric{padding:16px;border:1px solid var(--border,rgba(128,128,128,.22));border-radius:14px;background:var(--card-bg,#fff)}
      #customers .gc-customer-metric small{display:block;color:var(--muted,#6b7280);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
      #customers .gc-customer-metric strong{display:block;font-size:1.55rem;margin-top:5px}
      #customers .gc-customer-list-card{border:1px solid var(--border,rgba(128,128,128,.22));border-radius:16px;background:var(--card-bg,#fff);overflow:hidden}
      #customers .gc-customer-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid var(--border,rgba(128,128,128,.22));flex-wrap:wrap}
      #customers .gc-customer-search{min-width:min(520px,100%);flex:1;display:flex;gap:8px;align-items:center}
      #customers .gc-customer-search input{width:100%}
      #customers .gc-customer-results{display:grid}
      #customers .gc-customer-row{display:grid;grid-template-columns:minmax(180px,1.25fr) minmax(155px,1fr) minmax(110px,.6fr) minmax(110px,.6fr) minmax(135px,.75fr);gap:14px;align-items:center;padding:14px 16px;border:0;border-bottom:1px solid var(--border,rgba(128,128,128,.18));background:transparent;color:inherit;text-align:left;width:100%;cursor:pointer}
      #customers .gc-customer-row:hover{background:rgba(100,116,139,.07)}
      #customers .gc-customer-row:last-child{border-bottom:0}
      #customers .gc-customer-row strong,#customers .gc-customer-row small{display:block}
      #customers .gc-customer-row small{color:var(--muted,#6b7280);margin-top:3px}
      #customers .gc-customer-columns{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#6b7280);font-weight:700;cursor:default;background:rgba(100,116,139,.04)}
      #customers .gc-customer-columns:hover{background:rgba(100,116,139,.04)}
      #customers .gc-customer-pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:rgba(59,130,246,.1);font-size:.78rem;font-weight:700}
      #customers .gc-customer-pill.ready{background:rgba(16,185,129,.12)}
      #customers .gc-customer-empty{padding:38px 18px;text-align:center;color:var(--muted,#6b7280)}
      #customers .gc-customer-detail-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
      #customers .gc-customer-detail-head h1{margin:4px 0}
      #customers .gc-customer-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,.42fr);gap:16px}
      #customers .gc-customer-stack{display:grid;gap:16px}
      #customers .gc-customer-card{border:1px solid var(--border,rgba(128,128,128,.22));border-radius:16px;background:var(--card-bg,#fff);padding:16px;min-width:0}
      #customers .gc-customer-card-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
      #customers .gc-customer-card h2,#customers .gc-customer-card h3{margin:0}
      #customers .gc-contact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      #customers .gc-contact-item small{display:block;color:var(--muted,#6b7280);margin-bottom:3px}
      #customers .gc-contact-item strong{overflow-wrap:anywhere}
      #customers .gc-device-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #customers .gc-device{border:1px solid var(--border,rgba(128,128,128,.18));border-radius:12px;padding:12px}
      #customers .gc-device strong,#customers .gc-device small{display:block}
      #customers .gc-device small{color:var(--muted,#6b7280);margin-top:4px}
      #customers .gc-history{display:grid;gap:8px}
      #customers .gc-history-row{display:grid;grid-template-columns:minmax(120px,.7fr) minmax(160px,1fr) minmax(140px,.8fr) minmax(100px,.55fr);gap:10px;align-items:center;border:1px solid var(--border,rgba(128,128,128,.16));border-radius:11px;padding:10px 12px}
      #customers button.gc-history-row{width:100%;background:transparent;color:inherit;text-align:left;cursor:pointer}
      #customers button.gc-history-row:hover{background:rgba(100,116,139,.07)}
      #customers .gc-history-row small{display:block;color:var(--muted,#6b7280);margin-top:3px}
      #customers .gc-customer-contact-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
      #customers .gc-customer-contact-actions a{text-decoration:none}
      #customers .gc-training-note{padding:12px 14px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.09);border-radius:12px}
      .gc-customer-dialog{width:min(720px,calc(100vw - 28px));max-height:90vh;border:0;border-radius:18px;padding:0;background:var(--card-bg,#fff);color:inherit;box-shadow:0 24px 80px rgba(0,0,0,.3)}
      .gc-customer-dialog::backdrop{background:rgba(15,23,42,.56);backdrop-filter:blur(3px)}
      .gc-customer-form{display:grid;gap:16px;padding:20px}
      .gc-customer-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .gc-customer-dialog-head h2{margin:2px 0}
      .gc-customer-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .gc-customer-form-grid label{display:grid;gap:6px}
      .gc-customer-form-grid label.full{grid-column:1/-1}
      .gc-customer-form-grid input,.gc-customer-form-grid select,.gc-customer-form-grid textarea{width:100%;box-sizing:border-box}
      .gc-customer-dialog-actions{display:flex;justify-content:flex-end;gap:8px;align-items:center;flex-wrap:wrap}
      .gc-customer-form-message{margin-right:auto;color:var(--muted,#6b7280)}
      .gc-customer-form-message.error{color:#dc2626}
      @media(max-width:900px){
        #customers .gc-customer-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
        #customers .gc-customer-detail-grid{grid-template-columns:1fr}
        #customers .gc-customer-row{grid-template-columns:1.2fr .9fr .55fr .65fr}
        #customers .gc-customer-row>*:nth-child(5){display:none}
        #customers .gc-history-row{grid-template-columns:1fr 1fr}
      }
      @media(max-width:620px){
        #customers .gc-customer-metrics{grid-template-columns:1fr 1fr}
        #customers .gc-customer-row{grid-template-columns:1fr auto;gap:8px 12px}
        #customers .gc-customer-columns{display:none}
        #customers .gc-customer-row>*:nth-child(2){grid-column:1/2}
        #customers .gc-customer-row>*:nth-child(3){grid-column:2/3;grid-row:1/2}
        #customers .gc-customer-row>*:nth-child(4){grid-column:2/3;grid-row:2/3}
        #customers .gc-customer-row>*:nth-child(5){display:none}
        #customers .gc-contact-grid,#customers .gc-device-grid,.gc-customer-form-grid{grid-template-columns:1fr}
        .gc-customer-form-grid label.full{grid-column:auto}
        #customers .gc-history-row{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function host(){return document.getElementById('customers');}

  function trainingData(){
    const ops=window.GotCrackedOperationsV1?.state;
    const customers=(ops?.customers||[]).map(c=>{
      const repairs=(ops?.workOrders||[]).filter(t=>t.customer_id===c.id);
      return {...c,device_count:(c.devices||[]).length,active_repairs:repairs.filter(t=>!['sale_complete','abandoned','unrepairable','customer_declined','cancelled','completed'].includes(t.status)).length,ready_for_pickup:repairs.filter(t=>['repaired','ready_for_pickup'].includes(t.status)).length,last_activity:repairs[0]?.updated_at||c.created_at};
    });
    const q=state.search.trim().toLowerCase();
    const filtered=customers.filter(c=>!q||[customerName(c),c.phone,c.email,...(c.devices||[]).flatMap(d=>[d.manufacturer,d.model,d.serial_number,d.imei])].filter(Boolean).join(' ').toLowerCase().includes(q));
    const selected=state.selectedId?customers.find(c=>c.id===state.selectedId):null;
    const repairs=selected?(ops?.workOrders||[]).filter(t=>t.customer_id===selected.id):[];
    const appointments=selected?(ops?.appointments||[]).filter(a=>a.customer_id===selected.id):[];
    return {
      can_edit:false,
      can_intake:true,
      can_schedule:false,
      can_financial:true,
      total:filtered.length,
      offset:0,
      limit:100,
      summary:{
        total_customers:customers.length,
        customers_with_active_repairs:customers.filter(c=>c.active_repairs>0).length,
        customers_ready_for_pickup:customers.filter(c=>c.ready_for_pickup>0).length,
        new_last_30_days:customers.length
      },
      customers:filtered,
      detail:selected?{
        customer:selected,
        devices:selected.devices||[],
        repairs,
        appointments,
        leads:(ops?.leads||[]).filter(l=>l.customer_id===selected.id),
        receipts:[],
        stats:{device_count:(selected.devices||[]).length,repair_count:repairs.length,active_repairs:selected.active_repairs,ready_for_pickup:selected.ready_for_pickup,lifetime_paid_cents:repairs.filter(t=>['sale_complete','completed'].includes(t.status)).reduce((sum,t)=>sum+(Number(t.amount_paid_cents)||Number(t.total_cents)||0),0),last_repair_at:repairs[0]?.updated_at||null}
      }:null
    };
  }

  async function load({selectedId=state.selectedId,quiet=false}={}){
    state.selectedId=selectedId||null;
    const requestId=++state.requestId;
    state.loading=true;
    if(!quiet)renderLoading();
    try{
      if(training()){
        state.data=trainingData();
      }else{
        const {data,error}=await client.rpc('get_customer_command_center',{
          search_input:state.search.trim()||null,
          customer_id_input:state.selectedId,
          limit_input:100,
          offset_input:0
        });
        if(error)throw error;
        if(requestId!==state.requestId)return;
        state.data=data||{};
      }
      if(requestId!==state.requestId)return;
      render();
    }catch(error){
      if(requestId!==state.requestId)return;
      console.error('Customer command center load failed:',error);
      renderError(error?.message||'Customer records could not be loaded.');
      window.GotCrackedDiagnostics?.error?.(error,{context:'Customer Command Center could not load'});
    }finally{
      if(requestId===state.requestId)state.loading=false;
    }
  }

  function renderLoading(){
    const target=host();if(!target)return;
    target.innerHTML='<div class="page-heading"><div><p class="eyebrow">Relationships</p><h1>Customers</h1><p class="subtle">Loading customer command center…</p></div></div><div class="empty-card"><span>♙</span><h2>Loading customer records…</h2></div>';
  }

  function renderError(message){
    const target=host();if(!target)return;
    target.innerHTML=`<div class="page-heading"><div><p class="eyebrow">Relationships</p><h1>Customers</h1><p class="subtle">Customer command center</p></div><button class="secondary-button" type="button" data-customer-refresh>Retry</button></div><div class="empty-card"><span>!</span><h2>Customer records could not be loaded.</h2><p>${esc(message)}</p></div>`;
  }

  function render(){
    const target=host();if(!target||!state.data)return;
    if(state.selectedId&&state.data.detail)renderDetail(target,state.data.detail);
    else renderDirectory(target);
  }

  function renderDirectory(target){
    const data=state.data||{},summary=data.summary||{},rows=data.customers||[];
    target.innerHTML=`<div class="gc-customer-shell">
      <div class="gc-customer-header"><div><p class="eyebrow">Relationships</p><h1>Customer command center</h1><p class="subtle">Search every customer, saved device, repair, and contact record from one place.</p></div><div class="gc-customer-actions">${data.can_edit&&!training()?'<button class="primary-button" type="button" data-customer-new>+ New customer</button>':''}<button class="secondary-button" type="button" data-customer-refresh>Refresh</button></div></div>
      ${training()?'<div class="gc-training-note"><strong>Training Store</strong> · Customer profile changes are disabled here. Starting a repair still stays inside the training sandbox.</div>':''}
      <div class="gc-customer-metrics"><div class="gc-customer-metric"><small>Total customers</small><strong>${Number(summary.total_customers)||0}</strong></div><div class="gc-customer-metric"><small>Active repairs</small><strong>${Number(summary.customers_with_active_repairs)||0}</strong></div><div class="gc-customer-metric"><small>Ready for pickup</small><strong>${Number(summary.customers_ready_for_pickup)||0}</strong></div><div class="gc-customer-metric"><small>New · 30 days</small><strong>${Number(summary.new_last_30_days)||0}</strong></div></div>
      <section class="gc-customer-list-card"><div class="gc-customer-toolbar"><div class="gc-customer-search"><span>⌕</span><input data-customer-search type="search" value="${esc(state.search)}" placeholder="Search customer, phone, email, device, serial, IMEI, or GC ticket"></div><span class="subtle">${Number(data.total)||0} result${Number(data.total)===1?'':'s'}</span></div><div class="gc-customer-results"><div class="gc-customer-row gc-customer-columns"><span>Customer</span><span>Location / contact</span><span>Devices</span><span>Open work</span><span>Last activity</span></div>${rows.map(customerRow).join('')||'<div class="gc-customer-empty"><strong>No matching customers.</strong><p>Try a different name, phone number, email, device, or ticket number.</p></div>'}</div></section>
    </div>`;
    const input=target.querySelector('[data-customer-search]');
    if(input&&document.activeElement?.dataset?.customerSearch!==undefined){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
  }

  function customerRow(c){
    const location=[c.city,c.state].filter(Boolean).join(', ')||c.email||c.phone||'Contact not recorded';
    return `<button class="gc-customer-row" type="button" data-customer-open="${esc(c.id)}"><span><strong>${esc(customerName(c))}</strong><small>${esc(c.phone||c.email||'No contact')}</small></span><span><strong>${esc(location)}</strong><small>${esc(c.email||'')}</small></span><span><span class="gc-customer-pill">${Number(c.device_count)||0} device${Number(c.device_count)===1?'':'s'}</span></span><span>${Number(c.ready_for_pickup)>0?`<span class="gc-customer-pill ready">${Number(c.ready_for_pickup)} ready</span>`:`<span class="gc-customer-pill">${Number(c.active_repairs)||0} active</span>`}</span><span><strong>${esc(date(c.last_activity))}</strong><small>${c.active_repairs?'Repair in progress':'Customer activity'}</small></span></button>`;
  }

  function renderDetail(target,detail){
    const c=detail.customer||{},stats=detail.stats||{},devices=detail.devices||[],repairs=detail.repairs||[],appointments=detail.appointments||[],leads=detail.leads||[],receipts=detail.receipts||[];
    const phone=digits(c.contact_phone||c.phone);
    const address=[c.address_line_1,c.address_line_2,c.city,c.state,c.postal_code].filter(Boolean).join(', ');
    target.innerHTML=`<div class="gc-customer-shell">
      <div class="gc-customer-detail-head"><div><button class="text-button" type="button" data-customer-back>← All customers</button><p class="eyebrow">Customer profile</p><h1>${esc(customerName(c))}</h1><p class="subtle">Customer since ${esc(date(c.created_at))} · Prefers ${esc(friendly(c.preferred_contact||'sms'))}</p></div><div class="gc-customer-actions">${state.data.can_intake?'<button class="primary-button" type="button" data-customer-start-repair>+ Start repair</button>':''}${state.data.can_schedule&&!training()?'<button class="secondary-button" type="button" data-customer-schedule>Schedule appointment</button>':''}${state.data.can_edit&&!training()?'<button class="secondary-button" type="button" data-customer-edit>Edit customer</button>':''}</div></div>
      ${training()?'<div class="gc-training-note"><strong>Training Store</strong> · This customer record is sandbox data.</div>':''}
      <div class="gc-customer-metrics"><div class="gc-customer-metric"><small>Saved devices</small><strong>${Number(stats.device_count)||0}</strong></div><div class="gc-customer-metric"><small>Repair history</small><strong>${Number(stats.repair_count)||0}</strong></div><div class="gc-customer-metric"><small>Active repairs</small><strong>${Number(stats.active_repairs)||0}</strong></div><div class="gc-customer-metric"><small>${state.data.can_financial?'Lifetime paid':'Ready for pickup'}</small><strong>${state.data.can_financial?money(stats.lifetime_paid_cents):Number(stats.ready_for_pickup)||0}</strong></div></div>
      <div class="gc-customer-detail-grid"><main class="gc-customer-stack">
        <section class="gc-customer-card"><div class="gc-customer-card-head"><h2>Repair history</h2><span class="subtle">${repairs.length} work order${repairs.length===1?'':'s'}</span></div><div class="gc-history">${repairs.map(repairRow).join('')||'<p class="subtle">No repair history yet.</p>'}</div></section>
        <section class="gc-customer-card"><div class="gc-customer-card-head"><h2>Saved devices</h2><span class="subtle">Reusable at intake</span></div><div class="gc-device-grid">${devices.map(deviceCard).join('')||'<p class="subtle">No saved devices yet.</p>'}</div></section>
        <section class="gc-customer-card"><div class="gc-customer-card-head"><h2>Appointments</h2><span class="subtle">${appointments.length} linked</span></div><div class="gc-history">${appointments.map(appointmentRow).join('')||'<p class="subtle">No appointments linked to this customer yet.</p>'}</div></section>
      </main><aside class="gc-customer-stack">
        <section class="gc-customer-card"><div class="gc-customer-card-head"><h2>Contact</h2></div><div class="gc-contact-grid"><div class="gc-contact-item"><small>Primary phone</small><strong>${esc(c.phone||'—')}</strong></div><div class="gc-contact-item"><small>Alternate phone</small><strong>${esc(c.contact_phone&&c.contact_phone!==c.phone?c.contact_phone:'—')}</strong></div><div class="gc-contact-item"><small>Email</small><strong>${esc(c.email||'—')}</strong></div><div class="gc-contact-item"><small>Preferred</small><strong>${esc(friendly(c.preferred_contact||'sms'))}</strong></div><div class="gc-contact-item" style="grid-column:1/-1"><small>Address</small><strong>${esc(address||'—')}</strong></div><div class="gc-contact-item" style="grid-column:1/-1"><small>Notes</small><strong>${esc(c.notes||'No customer notes')}</strong></div></div><div class="gc-customer-contact-actions">${phone?`<a class="secondary-button" href="tel:${phone}">Call</a><a class="secondary-button" href="sms:${phone}">Text</a>`:''}${c.email?`<a class="secondary-button" href="mailto:${esc(c.email)}">Email</a>`:''}</div></section>
        <section class="gc-customer-card"><div class="gc-customer-card-head"><h3>Recent leads</h3><span class="subtle">${leads.length}</span></div><div class="gc-history">${leads.slice(0,8).map(leadRow).join('')||'<p class="subtle">No linked leads.</p>'}</div></section>
        ${state.data.can_financial?`<section class="gc-customer-card"><div class="gc-customer-card-head"><h3>Receipts</h3><span class="subtle">${receipts.length}</span></div><div class="gc-history">${receipts.slice(0,10).map(receiptRow).join('')||'<p class="subtle">No receipts recorded.</p>'}</div></section>`:''}
      </aside></div>
    </div>`;
  }

  function repairRow(r){
    const device=[r.device?.manufacturer,r.device?.model].filter(Boolean).join(' ')||r.device?.category||'Device';
    return `<button class="gc-history-row" type="button" data-customer-work-order="${esc(r.id)}"><span><strong>${esc(ticketCode(r.ticket_number))}</strong><small>${esc(date(r.created_at))}</small></span><span><strong>${esc(device)}</strong><small>${esc(r.customer_issue||'No issue recorded')}</small></span><span><strong>${esc(friendly(r.status))}</strong><small>${esc(r.assigned_name||'Unassigned')}</small></span><span><strong>${esc(money(r.total_cents))}</strong><small>${esc(friendly(r.payment_status||'unpaid'))}</small></span></button>`;
  }
  function deviceCard(d){return `<article class="gc-device"><strong>${esc([d.manufacturer,d.model].filter(Boolean).join(' ')||d.category||'Device')}</strong><small>${esc([d.model_number,d.color,d.storage_size].filter(Boolean).join(' · ')||'Details not recorded')}</small><small>${esc(d.serial_number?`Serial ${d.serial_number}`:d.imei?`IMEI ${d.imei}`:'No serial / IMEI')}</small><small>${esc(d.device_condition?`Condition: ${d.device_condition}`:'Condition not recorded')}</small></article>`;}
  function appointmentRow(a){const when=a.starts_at?dateTime(a.starts_at):[a.preferred_date,a.preferred_time].filter(Boolean).join(' · ')||'Unscheduled';return `<div class="gc-history-row"><span><strong>${esc(when)}</strong><small>${esc(friendly(a.status))}</small></span><span><strong>${esc(a.service_requested||'Repair visit')}</strong><small>${esc(a.device_description||'Device not specified')}</small></span><span><strong>${esc(a.assigned_name||'Unassigned')}</strong><small>${Number(a.duration_minutes)||60} min</small></span><span><strong>${esc(friendly(a.source||'website'))}</strong><small>${esc(date(a.created_at))}</small></span></div>`;}
  function leadRow(l){return `<div class="gc-history-row" style="grid-template-columns:1fr"><span><strong>${esc(l.service||l.customer_issue||'Repair inquiry')}</strong><small>${esc(friendly(l.pipeline_status||l.status))} · ${esc(date(l.created_at))}</small></span></div>`;}
  function receiptRow(r){return `<div class="gc-history-row" style="grid-template-columns:1fr auto"><span><strong>${esc(r.receipt_number||ticketCode(r.ticket_number))}</strong><small>${esc(date(r.created_at))} · ${esc(friendly(r.payment_method))}</small></span><strong>${esc(money(r.amount_paid_cents||r.total_cents))}</strong></div>`;}

  function ensureDialog(){
    let dialog=document.getElementById('gc-customer-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='gc-customer-dialog';dialog.className='gc-customer-dialog';
    document.body.appendChild(dialog);
    return dialog;
  }

  function openCustomerForm(customer=null){
    if(training()||!state.data?.can_edit)return;
    const c=customer||{};const dialog=ensureDialog();
    dialog.innerHTML=`<form id="gc-customer-form" class="gc-customer-form"><div class="gc-customer-dialog-head"><div><p class="eyebrow">Customer profile</p><h2>${c.id?'Edit customer':'New customer'}</h2><p class="subtle">Keep contact information current so every repair stays connected.</p></div><button class="icon-button" type="button" data-customer-dialog-close>×</button></div><div class="gc-customer-form-grid"><label>First name<input name="first_name" required value="${esc(c.first_name||'')}"></label><label>Last name<input name="last_name" value="${esc(c.last_name||'')}"></label><label>Primary phone<input name="phone" type="tel" required value="${esc(c.phone||'')}"></label><label>Alternate phone<input name="contact_phone" type="tel" value="${esc(c.contact_phone&&c.contact_phone!==c.phone?c.contact_phone:'')}"></label><label>Email<input name="email" type="email" value="${esc(c.email||'')}"></label><label>Preferred contact<select name="preferred_contact"><option value="sms" ${c.preferred_contact==='sms'?'selected':''}>Text / SMS</option><option value="call" ${c.preferred_contact==='call'?'selected':''}>Phone call</option><option value="email" ${c.preferred_contact==='email'?'selected':''}>Email</option></select></label><label class="full">Address<input name="address_line_1" value="${esc(c.address_line_1||'')}"></label><label class="full">Address line 2<input name="address_line_2" value="${esc(c.address_line_2||'')}"></label><label>City<input name="city" value="${esc(c.city||'')}"></label><label>State<input name="state" maxlength="2" value="${esc(c.state||'')}"></label><label>ZIP<input name="postal_code" value="${esc(c.postal_code||'')}"></label><label class="full">Customer notes<textarea name="notes" rows="4">${esc(c.notes||'')}</textarea></label></div><input type="hidden" name="customer_id" value="${esc(c.id||'')}"><div class="gc-customer-dialog-actions"><span class="gc-customer-form-message" role="status"></span><button class="secondary-button" type="button" data-customer-dialog-close>Cancel</button><button class="primary-button" type="submit">${c.id?'Save customer':'Create customer'}</button></div></form>`;
    dialog.showModal();
  }

  function closeDialog(){const dialog=document.getElementById('gc-customer-dialog');if(dialog?.open)dialog.close();}
  function formMessage(form,message,isError=false){const el=form.querySelector('.gc-customer-form-message');if(!el)return;el.textContent=message||'';el.classList.toggle('error',isError);}

  async function saveCustomer(form){
    const values=Object.fromEntries(new FormData(form));const button=form.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent='Saving…';}
    formMessage(form,'Saving customer…');
    try{
      const {data,error}=await client.rpc('save_customer_profile',{
        customer_id_input:values.customer_id||null,
        first_name_input:values.first_name||null,
        last_name_input:values.last_name||null,
        phone_input:values.phone||null,
        contact_phone_input:values.contact_phone||null,
        email_input:values.email||null,
        preferred_contact_input:values.preferred_contact||'sms',
        address_line_1_input:values.address_line_1||null,
        address_line_2_input:values.address_line_2||null,
        city_input:values.city||null,
        state_input:values.state||null,
        postal_code_input:values.postal_code||null,
        notes_input:values.notes||null
      });
      if(error)throw error;
      closeDialog();
      state.search='';
      await window.GotCrackedOperationsV1?.reload?.();
      await load({selectedId:data?.id||values.customer_id||null});
    }catch(error){
      console.error('Customer save failed:',error);formMessage(form,error?.message||'Customer could not be saved.',true);
      window.GotCrackedDiagnostics?.error?.(error,{context:'Customer could not be saved'});
    }finally{if(button){button.disabled=false;button.textContent=values.customer_id?'Save customer':'Create customer';}}
  }

  function selectedDetail(){return state.data?.detail||null;}

  function startRepair(){
    const detail=selectedDetail();if(!detail||!state.data?.can_intake)return;
    const customer={...detail.customer,devices:detail.devices||[]};
    window.GotCrackedOperationsV1?.openIntake?.({customer});
  }

  async function scheduleAppointment(){
    const detail=selectedDetail();if(!detail||!state.data?.can_schedule||training())return;
    const customer=detail.customer||{};const preferredDevice=detail.devices?.[0]||null;
    location.hash='#appointments';
    try{await window.GotCrackedRuntime?.ensureView?.('appointments');}catch{}
    let tries=0;
    const open=()=>{
      const button=document.querySelector('#appointments [data-appt-new]');
      if(!button&&tries++<12){setTimeout(open,80);return;}
      if(!button)return;
      button.click();
      requestAnimationFrame(()=>{
        const form=document.getElementById('gc-appt-new-form');if(!form)return;
        const values={customer_name:customerName(customer),phone:customer.phone||'',email:customer.email||'',device:preferredDevice?[preferredDevice.manufacturer,preferredDevice.model].filter(Boolean).join(' '):''};
        for(const [name,value] of Object.entries(values)){const input=form.elements.namedItem(name);if(input)input.value=value;}
        form.elements.namedItem('service')?.focus();
      });
    };
    setTimeout(open,30);
  }

  async function openWorkOrder(id){
    const ops=window.GotCrackedOperationsV1;
    if(!ops)return;
    if(!ops.state?.workOrders?.some(t=>t.id===id))await ops.reload?.();
    if(ops.state?.workOrders?.some(t=>t.id===id))ops.openWorkOrder?.(id);
    else{location.hash='#repairs';window.GotCrackedDiagnostics?.error?.(new Error('This older work order is outside the loaded repair window.'),{context:'Open the Repairs search to find this work order'});}
  }

  injectStyle();

  document.addEventListener('input',event=>{
    const input=event.target instanceof Element?event.target.closest('[data-customer-search]'):null;
    if(!input)return;
    state.search=input.value;
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>load({selectedId:null,quiet:true}),220);
  });

  document.addEventListener('submit',event=>{
    if(event.target?.id!=='gc-customer-form')return;
    event.preventDefault();saveCustomer(event.target);
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-customer-dialog-close]')){closeDialog();return;}
    if(target.closest('[data-customer-refresh]')){load();return;}
    if(target.closest('[data-customer-new]')){openCustomerForm();return;}
    if(target.closest('[data-customer-back]')){state.selectedId=null;load({selectedId:null});return;}
    const open=target.closest('[data-customer-open]');if(open){load({selectedId:open.dataset.customerOpen});return;}
    if(target.closest('[data-customer-edit]')){openCustomerForm(selectedDetail()?.customer||null);return;}
    if(target.closest('[data-customer-start-repair]')){startRepair();return;}
    if(target.closest('[data-customer-schedule]')){scheduleAppointment();return;}
    const work=target.closest('[data-customer-work-order]');if(work){openWorkOrder(work.dataset.customerWorkOrder);return;}
  });

  document.addEventListener('gc-cross-user-sync',()=>{if(activeView())load({quiet:true});});
  document.addEventListener('gc-portal-runtime-ready',()=>{if(activeView())load();});
  window.addEventListener('hashchange',()=>{if(activeView())setTimeout(()=>load(),50);});

  if(activeView())setTimeout(()=>load(),50);
  window.GotCrackedCustomers={load,openCustomer:id=>load({selectedId:id}),get state(){return state;}};
})();