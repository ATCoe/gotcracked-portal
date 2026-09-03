(() => {
  'use strict';
  if (window.GotCrackedRmaFlowLabs || !window.supabaseClient) return;
  const db=window.supabaseClient;
  const state={enabled:false,manage:false,tab:'overview',inventory:[],registry:[],demands:[],orders:[],lines:[],reviews:[],returns:[],tickets:[]};
  let realtimeChannel=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile;
  const money=v=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0)/100);
  const label=v=>String(v||'unknown').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
  const safeUrl=v=>{try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return''}};
  const join=rows=>rows.join('');

  function addShell(){
    if(document.getElementById('rma-flow-labs'))return;
    const link=document.querySelector('.nav-link[data-view="inventory"]');
    link?.insertAdjacentHTML('afterend','<a class="nav-link" href="#rma-flow-labs" data-view="rma-flow-labs"><span>↺</span>RMA Flow <small style="margin-left:auto">Labs</small></a>');
    document.querySelector('main')?.insertAdjacentHTML('beforeend','<section id="rma-flow-labs" class="view"><div class="empty-card"><span>↺</span><h2>Loading RMA Flow Labs…</h2></div></section>');
    if(location.hash.startsWith('#rma-flow-labs'))setTimeout(()=>document.querySelector('.nav-link[data-view="rma-flow-labs"]')?.click(),0);
  }
  function removeShell(){
    document.querySelector('.nav-link[data-view="rma-flow-labs"]')?.remove();
    document.getElementById('rma-flow-labs')?.remove();
    if(location.hash.startsWith('#rma-flow-labs'))location.hash='#inventory';
  }
  function addStyle(){
    if(document.getElementById('gc-rma-style'))return;
    const s=document.createElement('style');s.id='gc-rma-style';
    s.textContent=[
      '.gc-rma-head,.gc-rma-subhead{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}',
      '.gc-labs-badge,.gc-rma-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#eef3f6;font-size:11px;font-weight:900}',
      '.gc-labs-badge{background:#fff0b5;color:#6f5100}.gc-rma-tabs{display:flex;gap:8px;overflow:auto;margin:16px 0}',
      '.gc-rma-tab{white-space:nowrap;border:1px solid var(--line,#dae3e9);background:transparent;border-radius:999px;padding:8px 12px;font-weight:800;cursor:pointer}',
      '.gc-rma-tab.active{background:#112433;color:#fff;border-color:#112433}.gc-rma-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
      '.gc-rma-stat{border:1px solid var(--line,#dae3e9);border-radius:13px;padding:13px}.gc-rma-stat small,.gc-rma-stat strong{display:block}.gc-rma-stat strong{font-size:1.35rem}',
      '.gc-rma-note{margin-top:12px;padding:12px;border-left:4px solid #d5a800;background:rgba(213,168,0,.09);border-radius:8px}',
      '.gc-rma-table{width:100%;border-collapse:collapse}.gc-rma-table th,.gc-rma-table td{padding:10px;border-bottom:1px solid var(--line,#e3e9ee);text-align:left;vertical-align:top}',
      '.gc-rma-table small{display:block;opacity:.68}.gc-rma-pill.authorized,.gc-rma-pill.shipped{background:#e1f1ff;color:#145f93}.gc-rma-pill.resolved,.gc-rma-pill.approved{background:#e5f7ec;color:#176841}',
      '.gc-rma-actions{display:flex;gap:6px;flex-wrap:wrap}.gc-rma-dialog{width:min(680px,calc(100vw - 24px));border:0;border-radius:18px;padding:0;box-shadow:0 22px 80px #0006}',
      '.gc-rma-dialog::backdrop{background:#07131dcc}.gc-rma-form{padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-rma-form h2,.gc-rma-form .full,.gc-rma-form-actions{grid-column:1/-1}',
      '.gc-rma-form label{display:grid;gap:5px;font-weight:700}.gc-rma-form input,.gc-rma-form select,.gc-rma-form textarea{width:100%}.gc-rma-form-actions{display:flex;justify-content:flex-end;gap:8px}',
      '@media(max-width:800px){.gc-rma-stats{grid-template-columns:1fr 1fr}.gc-rma-table{min-width:700px}}',
      '@media(max-width:560px){.gc-rma-head,.gc-rma-subhead{display:grid}.gc-rma-stats,.gc-rma-form{grid-template-columns:1fr}.gc-rma-form>*{grid-column:1!important}.gc-rma-actions>*{flex:1 1 auto}}'
    ].join('');document.head.appendChild(s);
  }
  async function checkAccess(){
    const p=profile();if(!p?.id)return false;
    const results=await Promise.all([
      db.from('rma_flow_labs_access').select('enabled').eq('profile_id',p.id).eq('feature_key','RMA_FLOW_LABS').maybeSingle(),
      db.rpc('has_permission',{permission_key:'purchasing.manage'})
    ]);
    state.enabled=results[0].data?.enabled===true;
    state.manage=results[1].data===true||p.role==='owner';
    state.enabled?addShell():removeShell();
    return state.enabled;
  }
  async function load(){
    if(!(await checkAccess()))return;
    const loc=profile().location_id;
    const results=await Promise.all([
      db.from('inventory_commitment_summary').select('*').eq('location_id',loc).eq('active',true).order('name'),
      db.from('parts_registry_latest_source').select('*').order('listing_last_seen_at',{ascending:false}).limit(100),
      db.from('part_demand_queue').select('*').eq('location_id',loc).order('created_at',{ascending:false}).limit(100),
      db.from('purchase_orders').select('*').eq('location_id',loc).order('created_at',{ascending:false}).limit(100),
      db.from('purchase_order_items').select('*,inventory_items(name,sku)').order('created_at',{ascending:false}).limit(300),
      db.from('rma_flow_purchase_reviews').select('*').eq('location_id',loc),
      db.from('rma_flow_supplier_returns').select('*,purchase_order_items(description,supplier_sku,purchase_orders(po_number,supplier_name)),repair_tickets(ticket_number)').eq('location_id',loc).order('updated_at',{ascending:false}),
      db.from('repair_tickets').select('id,ticket_number,status').eq('location_id',loc).order('updated_at',{ascending:false}).limit(100)
    ]);
    for(const result of results)if(result.error)throw result.error;
    [state.inventory,state.registry,state.demands,state.orders,state.lines,state.reviews,state.returns,state.tickets]=results.map(r=>r.data||[]);
    render();
    if(!realtimeChannel){
      realtimeChannel=db.channel('rma-flow-labs-'+loc);
      ['rma_flow_purchase_reviews','rma_flow_supplier_returns','rma_flow_supplier_return_events'].forEach(table=>{
        realtimeChannel.on('postgres_changes',{event:'*',schema:'public',table},()=>{if(location.hash.startsWith('#rma-flow-labs'))void load()});
      });
      realtimeChannel.subscribe();
    }
  }
  function overview(){
    const physical=state.inventory.reduce((s,r)=>s+Number(r.quantity_on_hand||0),0);
    const demand=state.demands.filter(r=>!['fulfilled','cancelled'].includes(r.status)).length;
    const orders=state.orders.filter(r=>['draft','submitted'].includes(r.status)).length;
    const returns=state.returns.filter(r=>!['resolved','rejected','cancelled'].includes(r.status)).length;
    return '<div class="gc-rma-stats">'+join([
      ['Physical units on hand',physical],['Open part demand',demand],['Orders awaiting action',orders],['Open supplier returns',returns]
    ].map(x=>'<div class="gc-rma-stat"><small>'+x[0]+'</small><strong>'+x[1]+'</strong></div>'))+'</div><div class="gc-rma-note"><strong>Inventory integrity boundary</strong><div>Registry and supplier availability describe what can be sourced. Only PO Receiving changes physical on-hand quantity. RMA Flow tracks approval, evidence, and resolution without silently changing stock.</div></div>';
  }
  function stock(){
    const rows=join(state.inventory.map(r=>'<tr><td><strong>'+esc(r.name)+'</strong><small>'+esc(r.sku||'No SKU')+'</small></td><td>'+Number(r.quantity_on_hand||0)+'</td><td>'+Number(r.reserved_quantity||0)+'</td><td>'+Number(r.available_quantity||0)+'</td><td>'+(r.registry_part_id?'Linked':'Store-only')+'</td></tr>'));
    return '<div class="gc-rma-subhead"><div><h2>Physical stock vs. Registry</h2><p class="subtle">Store-owned inventory is kept separate from the organization-wide sourceable catalog.</p></div><a class="secondary-button" href="#inventory">Open Inventory</a></div><div class="table-wrap"><table class="gc-rma-table"><thead><tr><th>Physical part</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Registry link</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5">No physical inventory recorded.</td></tr>')+'</tbody></table></div>';
  }
  function suppliers(){
    const rows=join(state.registry.map(r=>{const u=safeUrl(r.source_url);return '<tr><td><strong>'+esc(r.display_name)+'</strong><small>'+esc([r.brand,r.model].filter(Boolean).join(' · '))+'</small></td><td>'+(u?'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(r.source_name)+' ↗</a>':esc(r.source_name))+'</td><td><code>'+esc(r.supplier_sku||'—')+'</code></td><td>'+money(r.price_cents)+'</td><td>'+esc(r.availability||'Unknown')+'</td><td>'+(r.listing_last_seen_at?new Date(r.listing_last_seen_at).toLocaleDateString():'Unknown')+'</td></tr>'}));
    return '<div class="gc-rma-subhead"><div><h2>Supplier Hub</h2><p class="subtle">Normalized, shared Registry evidence. Supplier availability never counts as on-hand stock.</p></div></div><div class="table-wrap"><table class="gc-rma-table"><thead><tr><th>Registry part</th><th>Source</th><th>SKU</th><th>Price</th><th>Availability</th><th>Last seen</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">No supplier listings are available.</td></tr>')+'</tbody></table></div>';
  }
  function purchases(){
    const reviews=new Map(state.reviews.map(r=>[r.purchase_order_id,r]));
    const rows=join(state.orders.map(po=>{const review=reviews.get(po.id);const buttons=state.manage&&['draft','submitted'].includes(po.status)?'<button class="secondary-button" data-gc-review-po="'+po.id+'" data-decision="approved">Approve</button><button class="text-button" data-gc-review-po="'+po.id+'" data-decision="rejected">Reject</button>':'';return '<tr><td><strong>PO-'+String(po.po_number).padStart(6,'0')+'</strong><small>'+esc(po.supplier_name||'Supplier')+'</small></td><td>'+esc(label(po.status))+'<small>'+(po.requires_manual_checkout!==false?'Manual checkout required':'Staff checkout')+'</small></td><td><span class="gc-rma-pill '+esc(review?.state)+'">'+esc(label(review?.state||'not submitted'))+'</span></td><td>'+(po.expected_at?new Date(po.expected_at).toLocaleDateString():'—')+'</td><td><div class="gc-rma-actions">'+buttons+'</div></td></tr>'}));
    return '<div class="gc-rma-subhead"><div><h2>Purchase Queue</h2><p class="subtle">Approval, manual ordering, ETA, and receiving progress.</p></div><a class="secondary-button" href="#purchasing">Open Purchasing</a></div><div class="table-wrap"><table class="gc-rma-table"><thead><tr><th>PO / supplier</th><th>Order state</th><th>Labs review</th><th>ETA</th><th>Action</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5">No purchase orders yet.</td></tr>')+'</tbody></table></div>';
  }
  function returns(){
    const rows=join(state.returns.map(r=>{const next=r.status==='requested'?'authorized':r.status==='authorized'?'shipped':r.status==='shipped'?'received_by_supplier':r.status==='received_by_supplier'?'resolved':'';const action=state.manage&&next?'<button class="secondary-button" data-gc-next-rma="'+r.id+'" data-version="'+r.version+'" data-next="'+next+'">'+(next==='resolved'?'Resolve':label(next))+'</button>':'';return '<tr><td><strong>'+esc(r.purchase_order_items?.description||'Return item')+'</strong><small>'+(r.purchase_order_items?.purchase_orders?.po_number?'PO-'+String(r.purchase_order_items.purchase_orders.po_number).padStart(6,'0'):'Supplier return')+' · Qty '+r.quantity+'</small></td><td>'+(r.repair_tickets?.ticket_number?'GC-'+String(r.repair_tickets.ticket_number).padStart(6,'0'):'—')+'</td><td>'+esc(label(r.reason_code))+'<small>'+esc(r.reason_notes)+'</small></td><td>'+esc(r.tracking_number||r.supplier_reference||'Pending')+'</td><td><span class="gc-rma-pill '+esc(r.status)+'">'+esc(label(r.status))+'</span></td><td>'+action+'</td></tr>'}));
    return '<div class="gc-rma-subhead"><div><h2>RMA / Return Queue</h2><p class="subtle">Supplier reference, tracking, repair linkage, dates, and resolution.</p></div>'+(state.manage?'<button class="primary-button" data-gc-new-rma>+ New return</button>':'')+'</div><div class="table-wrap"><table class="gc-rma-table"><thead><tr><th>Part / PO</th><th>Repair</th><th>Reason</th><th>Tracking / RMA</th><th>Status</th><th>Action</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">No supplier returns recorded.</td></tr>')+'</tbody></table></div>';
  }
  function render(){
    const host=document.getElementById('rma-flow-labs');if(!host)return;addStyle();
    const body=state.tab==='stock'?stock():state.tab==='suppliers'?suppliers():state.tab==='purchases'?purchases():state.tab==='returns'?returns():overview();
    const tabs=join([['overview','Overview'],['stock','Stock & Registry'],['suppliers','Supplier Hub'],['purchases','Purchase Queue'],['returns','Returns']].map(x=>'<button class="gc-rma-tab '+(state.tab===x[0]?'active':'')+'" data-gc-rma-tab="'+x[0]+'" role="tab" aria-selected="'+(state.tab===x[0])+'">'+x[1]+'</button>'));
    host.innerHTML='<div class="gc-rma-head"><div><p class="eyebrow">Internal pilot · current store</p><h1>RMA Flow Labs</h1><p class="subtle">A franchise-ready parts sourcing, approval, receiving, and supplier-return workspace.</p></div><span class="gc-labs-badge">Labs</span></div><div class="gc-rma-tabs" role="tablist">'+tabs+'</div>'+body;
  }
  function returnDialog(){
    let d=document.getElementById('gc-rma-dialog');if(d)return d;const orders=new Map(state.orders.map(r=>[r.id,r]));
    const lines=join(state.lines.filter(l=>l.quantity_received>0&&orders.has(l.purchase_order_id)).map(l=>'<option value="'+l.id+'">PO-'+String(orders.get(l.purchase_order_id).po_number).padStart(6,'0')+' · '+esc(l.description)+' · '+l.quantity_received+' received</option>'));
    const tickets=join(state.tickets.map(t=>'<option value="'+t.id+'">GC-'+String(t.ticket_number).padStart(6,'0')+' · '+esc(label(t.status))+'</option>'));
    d=document.createElement('dialog');d.id='gc-rma-dialog';d.className='gc-rma-dialog';d.innerHTML='<form id="gc-rma-form" class="gc-rma-form"><h2>Create supplier return</h2><label class="full">Received PO line<select name="line" required><option value="">Choose part</option>'+lines+'</select></label><label>Repair link<select name="ticket"><option value="">No linked repair</option>'+tickets+'</select></label><label>Quantity<input name="quantity" type="number" min="1" value="1" required></label><label>Reason<select name="reason"><option value="defective">Defective</option><option value="wrong_item">Wrong item</option><option value="shipping_damage">Shipping damage</option><option value="compatibility">Compatibility</option><option value="quality">Quality</option><option value="other">Other</option></select></label><label>Supplier RMA #<input name="reference" maxlength="160"></label><label class="full">Notes<textarea name="notes" minlength="3" maxlength="500" required></textarea></label><label class="full">Evidence URLs, one per line<textarea name="evidence"></textarea></label><div class="gc-rma-form-actions"><button type="button" class="secondary-button" data-gc-close-rma>Cancel</button><button class="primary-button">Create return</button></div></form>';document.body.appendChild(d);return d;
  }
  async function review(po,decision){const note=decision==='rejected'?prompt('Reason for rejection:')||'Rejected during review':'Approved for manual supplier checkout';const r=await db.rpc('rma_flow_review_purchase_order',{p_purchase_order_id:po,p_decision:decision,p_note:note});if(r.error)throw r.error;await load()}
  async function createReturn(form){const f=new FormData(form);const urls=String(f.get('evidence')||'').split(/\r?\n/).map(safeUrl).filter(Boolean);const r=await db.rpc('rma_flow_create_supplier_return',{p_purchase_order_item_id:f.get('line'),p_ticket_id:f.get('ticket')||null,p_quantity:Number(f.get('quantity')),p_reason_code:f.get('reason'),p_reason_notes:f.get('notes'),p_evidence_urls:urls,p_supplier_reference:f.get('reference')||null});if(r.error)throw r.error;form.closest('dialog').close();form.reset();await load()}
  async function advance(button){const next=button.dataset.next,args={p_return_id:button.dataset.gcNextRma,p_expected_version:Number(button.dataset.version),p_next_status:next,p_note:null,p_supplier_reference:null,p_carrier:null,p_tracking_number:null,p_resolution_code:null,p_credit_cents:null};if(next==='shipped'){args.p_tracking_number=prompt('Tracking number:')?.trim();if(!args.p_tracking_number)return;args.p_carrier=prompt('Carrier (optional):')?.trim()||null}if(next==='resolved'){args.p_resolution_code=prompt('Resolution: credit, replacement, refund, denied, or other')?.trim().toLowerCase();args.p_note=prompt('Resolution note:')?.trim();if(!args.p_resolution_code||!args.p_note)return}const r=await db.rpc('rma_flow_transition_supplier_return',args);if(r.error)throw r.error;await load()}
  document.addEventListener('click',e=>{const t=e.target instanceof Element?e.target:null;if(!t)return;const tab=t.closest('[data-gc-rma-tab]');if(tab){state.tab=tab.dataset.gcRmaTab;render();return}if(t.closest('[data-gc-new-rma]'))return void returnDialog().showModal();if(t.closest('[data-gc-close-rma]'))return void t.closest('dialog')?.close();const rb=t.closest('[data-gc-review-po]');if(rb)return void review(rb.dataset.gcReviewPo,rb.dataset.decision).catch(x=>alert(x.message));const next=t.closest('[data-gc-next-rma]');if(next)return void advance(next).catch(x=>alert(x.message))});
  document.addEventListener('submit',e=>{if(e.target?.id!=='gc-rma-form')return;e.preventDefault();void createReturn(e.target).catch(x=>alert(x.message))});
  document.addEventListener('gc-view-changed',e=>{if(e.detail==='rma-flow-labs')void load().catch(x=>window.GotCrackedDiagnostics?.error?.(x,{context:'Unable to load RMA Flow Labs'}))});
  void checkAccess().then(ok=>{if(ok&&location.hash.startsWith('#rma-flow-labs'))void load()});
  window.GotCrackedRmaFlowLabs=Object.freeze({version:'20260902-light-slice1',state,load,render,normalizeListing:l=>Object.freeze({providerKey:String(l.source_name||''),providerLabel:String(l.source_name||''),supplierSku:String(l.supplier_sku||''),manufacturerPartNumber:String(l.manufacturer_part_number||''),priceCents:Number.isFinite(Number(l.price_cents))?Number(l.price_cents):null,currencyCode:String(l.currency_code||'USD'),availability:l.availability??null,sourceUrl:safeUrl(l.source_url),lastSeenAt:l.listing_last_seen_at||l.last_seen_at||null,isStale:!l.listing_last_seen_at||Date.now()-new Date(l.listing_last_seen_at)>7*864e5})});
})();

