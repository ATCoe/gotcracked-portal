(() => {
  'use strict';
  const client = window.supabaseClient;
  const dialog = document.querySelector('#inventory-audit-dialog');
  const host = document.querySelector('#inventory-audit-content');
  let profile = null;
  let audit = null;
  let items = [];
  let filter = 'all';
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((cents||0)/100);

  function ensureButton() {
    const actions = document.querySelector('#inventory .page-heading .quick-actions');
    if (actions && !actions.querySelector('[data-open-inventory-audit]')) actions.insertAdjacentHTML('beforeend','<button class="secondary-button" data-open-inventory-audit>Inventory audit</button>');
  }

  function shownItems() {
    if (filter === 'unscanned') return items.filter(item => !item.last_scanned_at);
    if (filter === 'variance') return items.filter(item => item.counted_quantity !== item.expected_quantity);
    if (filter === 'matched') return items.filter(item => item.last_scanned_at && item.counted_quantity === item.expected_quantity);
    return items;
  }

  function render() {
    if (!audit) {
      host.innerHTML = `<div class="modal-head"><div><p class="eyebrow">Inventory control</p><h2>Start a barcode audit</h2></div><button class="icon-button" type="button" data-close-audit aria-label="Close">×</button></div><div class="audit-intro"><span>▤</span><h3>Snapshot every active inventory item.</h3><p>Scan each physical part label. Repeated scans count multiple units. When a manager completes the audit, Portal adjusts stock to the counted quantities and logs every variance.</p></div>${['owner','manager'].includes(profile?.role) ? '<button class="primary-button" data-start-audit>Start inventory audit</button>' : '<p class="auth-message">An owner or manager must start the audit. Once started, active staff can scan items.</p>'}<p class="audit-status auth-message"></p>`;
      return;
    }
    const scanned = items.filter(item => item.last_scanned_at).length;
    const variances = items.filter(item => item.counted_quantity !== item.expected_quantity);
    const netValue = variances.reduce((sum,item)=>sum+(item.counted_quantity-item.expected_quantity)*(item.inventory_items?.cost_cents||0),0);
    const rows = shownItems();
    host.innerHTML = `<div class="modal-head"><div><p class="eyebrow">Inventory audit in progress</p><h2>Scan every labeled part</h2><p class="subtle">Started ${new Date(audit.started_at).toLocaleString()}</p></div><button class="icon-button" type="button" data-close-audit aria-label="Close">×</button></div><div class="audit-metrics"><div><small>Items scanned</small><strong>${scanned} / ${items.length}</strong></div><div><small>Units expected</small><strong>${items.reduce((sum,item)=>sum+item.expected_quantity,0)}</strong></div><div><small>Units counted</small><strong>${items.reduce((sum,item)=>sum+item.counted_quantity,0)}</strong></div><div><small>Cost variance</small><strong class="${netValue<0?'negative':''}">${money(netValue)}</strong></div></div><form id="audit-scan-form" class="audit-scanner"><label>Scan part barcode<input name="sku" autocomplete="off" autofocus placeholder="Scan SKU and press Enter" required></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required></label><button class="primary-button">Add scan</button></form><p class="audit-status auth-message" role="status"></p><div class="audit-toolbar"><select data-audit-filter><option value="all" ${filter==='all'?'selected':''}>All items</option><option value="unscanned" ${filter==='unscanned'?'selected':''}>Unscanned</option><option value="variance" ${filter==='variance'?'selected':''}>Variances</option><option value="matched" ${filter==='matched'?'selected':''}>Matched</option></select><span>${variances.length} current variances</span></div><div class="audit-table-wrap"><table><thead><tr><th>Item</th><th>SKU</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Status</th></tr></thead><tbody>${rows.map(item=>{const variance=item.counted_quantity-item.expected_quantity;return `<tr class="${!item.last_scanned_at?'unscanned':variance?'variance':'matched'}"><td><strong>${esc(item.inventory_items?.name||'Inventory item')}</strong></td><td><code>${esc(item.inventory_items?.sku||'')}</code></td><td>${item.expected_quantity}</td><td><input data-audit-count="${item.inventory_item_id}" type="number" min="0" step="1" value="${item.counted_quantity}"></td><td class="${variance<0?'negative':variance>0?'positive':''}">${variance>0?'+':''}${variance}</td><td>${!item.last_scanned_at?'Not scanned':variance?'Mismatch':'Matched'}</td></tr>`;}).join('')||'<tr><td colspan="6">No items match this filter.</td></tr>'}</tbody></table></div><div class="modal-actions audit-actions"><button class="danger-button" type="button" data-cancel-audit>Cancel audit</button><button class="primary-button" type="button" data-complete-audit ${['owner','manager'].includes(profile?.role)?'':'disabled'}>Complete & apply counts</button></div>`;
    setTimeout(()=>host.querySelector('[name="sku"]')?.focus(),50);
  }

  async function load() {
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data:p}=await client.from('profiles').select('id,role,location_id').eq('id',user.id).maybeSingle(); profile=p;
    const auditResult=await client.from('inventory_audits').select('*').eq('location_id',profile.location_id).eq('status','in_progress').maybeSingle();
    audit=auditResult.data||null;
    if(audit){const result=await client.from('inventory_audit_items').select('*,inventory_items(name,sku,cost_cents,quantity_on_hand)').eq('audit_id',audit.id);items=(result.data||[]).sort((a,b)=>String(a.inventory_items?.name||'').localeCompare(String(b.inventory_items?.name||'')));}else items=[];
    render();
  }

  document.addEventListener('click',async event=>{
    if(event.target.closest('[data-open-inventory-audit]')){event.preventDefault();dialog.showModal();await load();}
    if(event.target.closest('[data-close-audit]'))dialog.close();
    if(event.target.closest('[data-start-audit]')){const status=host.querySelector('.audit-status');const {error}=await client.rpc('start_inventory_audit',{audit_notes:'Barcode cycle count'});if(error)status.textContent=error.message;else await load();}
    if(event.target.closest('[data-complete-audit]')){const unscanned=items.filter(item=>!item.last_scanned_at).length;const variance=items.filter(item=>item.counted_quantity!==item.expected_quantity).length;if(!confirm(`Complete this audit and adjust inventory? ${unscanned} unscanned items will be counted as zero; ${variance} items currently have a variance.`))return;const {error}=await client.rpc('complete_inventory_audit',{target_audit:audit.id});if(error)host.querySelector('.audit-status').textContent=error.message;else{audit=null;items=[];render();}}
    if(event.target.closest('[data-cancel-audit]')){if(!confirm('Cancel this audit? No inventory quantities will be changed.'))return;const {error}=await client.rpc('cancel_inventory_audit',{target_audit:audit.id});if(error)host.querySelector('.audit-status').textContent=error.message;else{audit=null;items=[];render();}}
  });

  document.addEventListener('submit',async event=>{
    if(event.target.id!=='audit-scan-form')return;
    event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form)),status=host.querySelector('.audit-status');
    const {error}=await client.rpc('scan_inventory_audit',{target_audit:audit.id,scanned_sku:data.sku.trim(),scan_quantity:Number(data.quantity)});
    if(error){status.textContent=error.message;form.elements.sku.select();return;}
    await load();
  });

  document.addEventListener('change',async event=>{
    if(event.target.matches('[data-audit-filter]')){filter=event.target.value;render();return;}
    if(event.target.matches('[data-audit-count]')){const status=host.querySelector('.audit-status');const {error}=await client.rpc('set_inventory_audit_count',{target_audit:audit.id,target_item:event.target.dataset.auditCount,new_count:Number(event.target.value)});if(error)status.textContent=error.message;else await load();}
  });

  const observer=new MutationObserver(ensureButton);observer.observe(document.querySelector('#inventory'),{childList:true,subtree:true});ensureButton();
  client.channel('audit-live').on('postgres_changes',{event:'*',schema:'public',table:'inventory_audit_items'},()=>{if(dialog.open)setTimeout(load,150)}).subscribe();
})();
