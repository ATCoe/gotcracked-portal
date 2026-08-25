(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const isTraining = () => localStorage.getItem('gc-training-store') === '1';
  const ops = () => window.GotCrackedOperationsV1;

  function state(){ return ops()?.state || null; }
  function save(){
    const s=state(); if(!s||!isTraining())return;
    localStorage.setItem('gc-training-data-v1',JSON.stringify({customers:s.customers,workOrders:s.workOrders,leads:s.leads,inventory:s.inventory,services:s.services,purchaseOrders:s.purchaseOrders,poItems:s.poItems,guides:s.guides,intakes:s.intakes,appointments:s.appointments||[]}));
  }

  const LEGACY_WRITE_FORMS = new Set([
    'ticket-form','operation-form','lead-update-form','business-settings-form','work-order-settings-form',
    'inventory-settings-form','media-settings-form','label-settings-form','staff-invite-form'
  ]);
  const LEGACY_WRITE_SELECTORS = [
    '[data-live-action]','[data-adjust-part]','[data-loss-part]','[data-deactivate-part]','[data-deactivate-service]',
    '[data-save-staff]','[data-toggle-staff]','[data-sync-media]','[data-remove-work-item]','[data-use-frequent-code]',
    '[data-open-ticket]','[data-audit-action]','[data-inventory-audit]'
  ].join(',');

  function stop(event,message='Training Store blocked a production action. Use the sandbox controls on this page instead.'){
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(message) alert(message);
  }

  document.addEventListener('click',event=>{
    if(!isTraining())return;
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const openTicket=target.closest('[data-open-ticket]');
    if(openTicket){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      ops()?.openIntake?.();
      return;
    }
    const legacy=target.closest(LEGACY_WRITE_SELECTORS);
    if(legacy&&!target.closest('[data-v1-walkin],[data-v1-new-lead],[data-v1-new-po],[data-v1-open-po],[data-v1-print-ticket],[data-v1-store-switch]')){
      stop(event);
    }
  },true);

  document.addEventListener('submit',event=>{
    if(!isTraining())return;
    if(LEGACY_WRITE_FORMS.has(event.target.id)) stop(event,'Training Store blocked this legacy production form. Use the Training Store sandbox workflow instead.');
  },true);

  function trainingHeader(title,subtitle,actions=''){
    return `<div class="page-heading"><div><p class="eyebrow">Training Store</p><h1>${title}</h1><p class="subtle">${subtitle}</p></div>${actions}</div>`;
  }

  function renderCustomers(){
    const s=state(),host=document.getElementById('customers');if(!isTraining()||!s||!host)return;
    host.innerHTML=`${trainingHeader('Customers','Sandbox customer profiles and saved devices. Production customers are hidden while training.')}<article class="v1-ops-card"><div class="v1-ops-card-head"><div><h2>Training customers</h2><p>${s.customers.length} fake profile${s.customers.length===1?'':'s'}</p></div><div class="v1-table-tools"><input id="training-customer-search" placeholder="Search training customers"></div></div><div id="training-customer-list"></div></article>`;
    drawCustomers('');
  }
  function drawCustomers(query){
    const s=state(),host=document.getElementById('training-customer-list');if(!s||!host)return;const q=String(query||'').toLowerCase();const rows=s.customers.filter(c=>[c.first_name,c.last_name,c.phone,c.email,...(c.devices||[]).flatMap(d=>[d.manufacturer,d.model,d.serial_number])].filter(Boolean).join(' ').toLowerCase().includes(q));
    host.innerHTML=rows.map(c=>`<div class="list-row"><div class="avatar">${esc((c.first_name||'T')[0])}${esc((c.last_name||'S')[0])}</div><div class="row-main"><strong>${esc(c.first_name)} ${esc(c.last_name)}</strong><small>${esc(c.phone||'')} · ${esc(c.email||'')} · ${(c.devices||[]).map(d=>esc([d.manufacturer,d.model].filter(Boolean).join(' '))).join(', ')||'No saved devices'}</small></div><span class="v1-training-chip">FAKE</span></div>`).join('')||'<p class="empty-state">No matching training customers.</p>';
  }

  function renderInventory(){
    const s=state(),host=document.getElementById('inventory');if(!isTraining()||!s||!host)return;
    const manager=['owner','manager'].includes(s.profile?.role);
    host.innerHTML=`${trainingHeader('Inventory','Sandbox stock, counts, damage, receiving, and labels. No production quantities are touched.',manager?'<div class="v1-actions"><button class="primary-button" data-training-add-part>+ Add Training Part</button><button class="secondary-button" data-training-count>Cycle Count</button></div>':'')}<article class="v1-ops-card"><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Part</th><th>SKU</th><th>On hand</th><th>Reorder</th><th>Cost</th><th>Price</th><th>Supplier</th><th></th></tr></thead><tbody>${s.inventory.map(item=>`<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.category||'')}</small></td><td>${esc(item.sku||'NO SKU')}</td><td>${item.quantity_on_hand}</td><td>${item.reorder_point||0}</td><td>${money(item.cost_cents)}</td><td>${money(item.sell_price_cents)}</td><td>${esc(item.supplier_name||'—')}</td><td><button class="secondary-button" data-training-label="${item.id}">Label</button>${manager?` <button class="secondary-button" data-training-adjust="${item.id}">Adjust</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8">No training inventory.</td></tr>'}</tbody></table></div></article>`;
  }

  function renderAppointments(){
    const s=state(),host=document.getElementById('appointments');if(!isTraining()||!s||!host)return;const appointments=s.appointments||[];
    host.innerHTML=`${trainingHeader('Appointments','Fake scheduling records for practicing arrivals and intake.','<button class="primary-button" data-training-appointment>+ Training Appointment</button>')}<article class="v1-ops-card"><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Date</th><th>Customer</th><th>Device / service</th><th>Status</th><th></th></tr></thead><tbody>${appointments.map(a=>`<tr><td>${esc(a.preferred_date||'TBD')}<small>${esc(a.preferred_time||'')}</small></td><td><strong>${esc(a.customer_name||'Training Customer')}</strong></td><td>${esc(a.device_description||'Device')}<small>${esc(a.service_requested||'Repair')}</small></td><td><span class="v1-training-chip">${esc((a.status||'scheduled').toUpperCase())}</span></td><td><button class="secondary-button" data-training-arrive="${a.id}">Arrive / Intake</button></td></tr>`).join('')||'<tr><td colspan="5">No training appointments.</td></tr>'}</tbody></table></div></article>`;
  }

  function renderShipping(){
    const s=state(),host=document.getElementById('shipping');if(!isTraining()||!s||!host)return;const rows=s.workOrders.filter(t=>t.intake_method==='mail_in'||t.shipping_status&&t.shipping_status!=='not_applicable');
    host.innerHTML=`${trainingHeader('Mail-in & Shipping','Sandbox mail-in queue. Carrier labels are not created from Training Store.')}<article class="v1-ops-card"><div class="v1-table-wrap"><table class="v1-table"><thead><tr><th>Work order</th><th>Customer</th><th>Device</th><th>Shipping status</th></tr></thead><tbody>${rows.map(t=>`<tr data-v1-work-order="${t.id}"><td><strong>GC-${String(t.ticket_number).padStart(6,'0')}</strong></td><td>${esc(`${t.customers?.first_name||''} ${t.customers?.last_name||''}`.trim())}</td><td>${esc([t.devices?.manufacturer,t.devices?.model].filter(Boolean).join(' ')||'Device')}</td><td>${esc((t.shipping_status||'awaiting_inbound').replaceAll('_',' '))}</td></tr>`).join('')||'<tr><td colspan="4">No fake mail-in work orders yet.</td></tr>'}</tbody></table></div></article>`;
  }

  function renderReports(){
    const s=state(),host=document.getElementById('reports');if(!isTraining()||!s||!host)return;const complete=s.workOrders.filter(t=>['sale_complete','completed'].includes(t.status));const open=s.workOrders.filter(t=>!['sale_complete','completed','cancelled','abandoned','unrepairable','customer_declined'].includes(t.status));const ready=s.workOrders.filter(t=>['repaired','ready_for_pickup'].includes(t.status));const revenue=complete.reduce((sum,t)=>sum+(t.total_cents||0),0);const converted=s.leads.filter(l=>(l.pipeline_status||l.status)==='converted'||l.status==='won').length;
    host.innerHTML=`${trainingHeader('Reports','Sandbox reporting only. Fake activity never appears in production business reporting.')}<div class="module-grid"><article class="card module-stat"><p>Training sales</p><strong>${money(revenue)}</strong><small>${complete.length} fake completed repairs</small></article><article class="card module-stat"><p>Open training repairs</p><strong>${open.length}</strong><small>Sandbox workload</small></article><article class="card module-stat"><p>Ready for pickup</p><strong>${ready.length}</strong><small>Fake devices</small></article><article class="card module-stat"><p>Lead conversion</p><strong>${s.leads.length?Math.round(converted/s.leads.length*100):0}%</strong><small>${converted} fake conversions</small></article></div>`;
  }

  function renderView(view){
    if(!isTraining())return;
    if(view==='customers')renderCustomers();
    if(view==='inventory')renderInventory();
    if(view==='appointments')renderAppointments();
    if(view==='shipping')renderShipping();
    if(view==='reports')renderReports();
  }

  document.addEventListener('input',event=>{if(isTraining()&&event.target.id==='training-customer-search')drawCustomers(event.target.value);});

  document.addEventListener('click',event=>{
    if(!isTraining())return;const target=event.target instanceof Element?event.target:null;if(!target)return;const s=state();if(!s)return;
    if(target.closest('[data-training-add-part]')){const name=prompt('Training part name');if(!name)return;const sku=(prompt('Training SKU')||`TRAIN-${s.inventory.length+1}`).toUpperCase();const qty=Number(prompt('Starting quantity','1')||0);s.inventory.push({id:uid('training-part'),sku,name,category:'Training part',quantity_on_hand:Math.max(0,qty),reorder_point:1,cost_cents:0,sell_price_cents:0,supplier_name:'Training Vendor',active:true});save();renderInventory();return;}
    const adjust=target.closest('[data-training-adjust]');if(adjust){const item=s.inventory.find(i=>i.id===adjust.dataset.trainingAdjust);if(!item)return;const delta=Number(prompt(`Adjust ${item.name}. Enter + or - quantity:`,'0'));if(!Number.isFinite(delta)||!delta)return;item.quantity_on_hand=Math.max(0,item.quantity_on_hand+delta);save();renderInventory();return;}
    const label=target.closest('[data-training-label]');if(label){const item=s.inventory.find(i=>i.id===label.dataset.trainingLabel);if(item)ops()?.printInventoryLabel?.(item,1);return;}
    if(target.closest('[data-training-count]')){const sku=(prompt('Scan/type the training SKU to count')||'').toUpperCase();const item=s.inventory.find(i=>String(i.sku||'').toUpperCase()===sku);if(!item)return alert('Training SKU not found.');const count=Number(prompt(`Physical count for ${item.name}`,String(item.quantity_on_hand)));if(!Number.isInteger(count)||count<0)return;item.quantity_on_hand=count;save();renderInventory();return;}
    if(target.closest('[data-training-appointment]')){const customer=prompt('Training customer name');if(!customer)return;const date=prompt('Date (YYYY-MM-DD)',new Date().toISOString().slice(0,10))||'';const device=prompt('Device')||'Training device';const service=prompt('Requested service')||'Diagnosis';s.appointments=s.appointments||[];s.appointments.push({id:uid('appt'),customer_name:customer,preferred_date:date,preferred_time:'TBD',device_description:device,service_requested:service,status:'scheduled',created_at:now()});save();renderAppointments();return;}
    const arrive=target.closest('[data-training-arrive]');if(arrive){const appointment=(s.appointments||[]).find(a=>a.id===arrive.dataset.trainingArrive);if(appointment){appointment.status='arrived';save();ops()?.openIntake?.({customer_issue:appointment.service_requested});}return;}
  },true);

  window.addEventListener('gc-view-changed',event=>setTimeout(()=>renderView(event.detail),0));
  window.addEventListener('load',()=>{if(isTraining())setTimeout(()=>renderView(location.hash.slice(1).split('/')[0]||'dashboard'),2200);});

  window.GotCrackedTrainingGuard={renderView,isTraining};
})();
