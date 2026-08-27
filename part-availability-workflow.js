(()=>{
  'use strict';
  if(window.GotCrackedPartAvailability)return;

  const client=window.supabaseClient;
  const state={inventory:new Map(),demands:[],ticketId:null,loading:false,loadedAt:0};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const qty=v=>Math.max(0,Number(v)||0);
  const ops=()=>window.GotCrackedOperationsV1;
  const training=()=>localStorage.getItem('gc-training-store')==='1';

  function styles(){
    if(document.getElementById('gc-part-availability-style'))return;
    const s=document.createElement('style');s.id='gc-part-availability-style';s.textContent=`
      .gc-part-health-card{margin:0 0 16px}.gc-part-health-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.gc-part-health-head h2{margin:0 0 5px}.gc-part-health-list{display:grid;gap:9px;margin-top:13px}.gc-part-health-row{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(190px,1fr) auto;gap:12px;align-items:center;padding:11px 12px;border:1px solid var(--line,#dce5ec);border-radius:13px}.gc-part-health-row strong,.gc-part-health-row small{display:block}.gc-part-health-row small{opacity:.7;margin-top:3px}.gc-part-bubble{display:inline-flex;align-items:center;gap:6px;width:max-content;max-width:100%;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.01em;white-space:nowrap}.gc-part-bubble::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.8}.gc-part-good{background:#e7f7ef;color:#19724f}.gc-part-low{background:#fff4d8;color:#9a6700}.gc-part-needed{background:#ffe6e8;color:#b32635}.gc-part-inbound{background:#e7f2ff;color:#1769aa}.gc-part-reserved{background:#e7f7f6;color:#147a72}.gc-part-used{background:#eef1f4;color:#586977}.gc-part-status-strip{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.gc-part-inline{margin-top:6px}.gc-part-health-empty{padding:14px;border:1px dashed var(--line,#dce5ec);border-radius:12px;opacity:.72}html[data-theme="dark"] .gc-part-health-row{border-color:#2e4252}@media(max-width:700px){.gc-part-health-row{grid-template-columns:1fr}.gc-part-health-row .gc-part-bubble{justify-self:start}}
    `;document.head.appendChild(s);
  }

  function inventoryFor(id){return state.inventory.get(id)||null}
  function demandsFor(ticketId,itemId){return state.demands.filter(d=>d.ticket_id===ticketId&&d.inventory_item_id===itemId&&d.status!=='cancelled')}

  function availability(line,ticketId){
    const inv=inventoryFor(line.inventory_item_id);
    const demands=demandsFor(ticketId,line.inventory_item_id);
    const required=Math.max(1,Math.ceil(Number(line.quantity)||1));
    const demandRequired=demands.reduce((n,d)=>n+qty(d.quantity_required),0)||required;
    const reserved=demands.reduce((n,d)=>n+qty(d.quantity_reserved),0);
    const ordered=demands.reduce((n,d)=>n+qty(d.quantity_ordered),0);
    const received=demands.reduce((n,d)=>n+qty(d.quantity_received),0);
    const inbound=Math.max(0,ordered-received);
    const onHand=qty(inv?.quantity_on_hand);
    const allReserved=qty(inv?.reserved_quantity);
    const available=qty(inv?.available_quantity ?? onHand);

    if(line.inventory_applied){
      return {kind:'used',label:'Part Applied',description:`Consumed for this repair · ${available} currently available`,onHand,allReserved,available,inbound};
    }
    if(reserved>=demandRequired){
      return {kind:'reserved',label:'Reserved',description:`${reserved} reserved for this work order · ${onHand} on hand`,onHand,allReserved,available,inbound};
    }
    if(inbound>0||demands.some(d=>['ordered','partially_received'].includes(d.status))){
      return {kind:'inbound',label:'Inbound / Reserved',description:`${inbound||ordered} inbound for this work order · ${available} free stock`,onHand,allReserved,available,inbound};
    }
    if(available>=required){
      const low=available<=Math.max(1,qty(inv?.reorder_point));
      return {kind:low?'low':'good',label:low?'Low Stock':'In Stock',description:`${onHand} on hand · ${allReserved} reserved · ${available} available`,onHand,allReserved,available,inbound};
    }
    return {kind:'needed',label:'Part Needed',description:`${onHand} on hand · ${allReserved} reserved · ${available} available · ${Math.max(1,demandRequired-reserved-inbound)} still needed`,onHand,allReserved,available,inbound};
  }

  function classFor(kind){return `gc-part-bubble gc-part-${kind}`}

  function ticketPartsStatus(ticket,rows){
    if(rows.some(r=>r.info.kind==='needed'))return {kind:'needed',label:'Parts: Need to Order'};
    if(rows.some(r=>r.info.kind==='inbound'))return {kind:'inbound',label:'Parts: Awaiting Parts'};
    if(rows.some(r=>r.info.kind==='reserved'))return {kind:'reserved',label:'Parts: Reserved / Ready'};
    if(rows.some(r=>['good','low'].includes(r.info.kind)))return {kind:'good',label:'Parts: Available'};
    if(rows.length&&rows.every(r=>r.info.kind==='used'))return {kind:'used',label:'Parts: Applied'};
    const raw=String(ticket?.parts_status||'').replaceAll('_',' ');
    return raw&&raw!=='not evaluated'?{kind:'used',label:`Parts: ${raw.replace(/\b\w/g,c=>c.toUpperCase())}`} : null;
  }

  function decorate(){
    styles();
    const root=document.getElementById('work-order');
    const ticket=ops()?.state?.currentWorkOrder;
    if(!root||!ticket||!root.classList.contains('active')&&!location.hash.startsWith('#work-order'))return;
    const lines=(ticket.work_order_items||[]).filter(line=>line.item_type==='part');
    const rows=lines.map(line=>({line,info:availability(line,ticket.id)}));

    root.querySelector('#gc-workorder-part-health')?.remove();
    const main=root.querySelector('.v1-workorder-main');
    if(main){
      const card=document.createElement('section');card.className='card gc-part-health-card';card.id='gc-workorder-part-health';
      card.innerHTML=`<div class="gc-part-health-head"><div><h2>Part Inventory</h2><p class="subtle">Staff only · physical stock is separated from units reserved for other customers and work orders.</p></div></div>${rows.length?`<div class="gc-part-health-list">${rows.map(({line,info})=>`<div class="gc-part-health-row"><div><strong>${esc(line.description||'Repair part')}</strong><small>${esc(line.sku||'No SKU')} · Required ${Math.max(1,Math.ceil(Number(line.quantity)||1))}</small></div><div><strong>${esc(info.description)}</strong><small>${info.inbound?`${info.inbound} inbound · `:''}${info.available} uncommitted available</small></div><span class="${classFor(info.kind)}">${esc(info.label)}</span></div>`).join('')}</div>`:'<div class="gc-part-health-empty">No repair parts are attached to this work order yet.</div>'}`;
      const partsCard=[...main.querySelectorAll('section.card')].find(section=>section.querySelector('h2')?.textContent?.trim()==='Parts & services');
      if(partsCard)partsCard.before(card);else main.appendChild(card);
    }

    const status=ticketPartsStatus(ticket,rows);
    const head=root.querySelector('.v1-workorder-head > div');
    if(head){
      head.querySelector('.gc-part-status-strip')?.remove();
      if(status){const strip=document.createElement('div');strip.className='gc-part-status-strip';strip.innerHTML=`<span class="${classFor(status.kind)}">${esc(status.label)}</span>`;head.appendChild(strip);}
    }

    const visualLines=[...root.querySelectorAll('.v1-line-item')].filter((_,i)=>i<(ticket.work_order_items||[]).length);
    (ticket.work_order_items||[]).forEach((line,index)=>{
      const el=visualLines[index];if(!el||line.item_type!=='part')return;
      el.querySelector('.gc-part-inline')?.remove();
      const info=availability(line,ticket.id);const holder=document.createElement('div');holder.className='gc-part-inline';holder.innerHTML=`<span class="${classFor(info.kind)}">${esc(info.label)} · ${info.available} available</span>`;el.firstElementChild?.appendChild(holder);
    });
  }

  async function load(ticketId,force=false){
    if(training()){
      state.inventory.clear();
      for(const item of ops()?.state?.inventory||[])state.inventory.set(item.id,{...item,reserved_quantity:0,available_quantity:item.quantity_on_hand||0});
      state.demands=[];state.ticketId=ticketId;decorate();return;
    }
    if(!client||state.loading)return;
    if(!force&&state.ticketId===ticketId&&Date.now()-state.loadedAt<8000){decorate();return;}
    state.loading=true;
    try{
      const profile=ops()?.state?.profile;if(!profile?.location_id)return;
      const [inventory,demands]=await Promise.all([
        client.from('inventory_commitment_summary').select('*').eq('location_id',profile.location_id).eq('active',true),
        client.from('part_demand_queue').select('*').eq('location_id',profile.location_id).eq('ticket_id',ticketId)
      ]);
      if(inventory.error)throw inventory.error;if(demands.error)throw demands.error;
      state.inventory=new Map((inventory.data||[]).map(item=>[item.id,item]));state.demands=demands.data||[];state.ticketId=ticketId;state.loadedAt=Date.now();decorate();
    }catch(error){console.warn('Part availability could not be loaded',error)}finally{state.loading=false}
  }

  function refreshFromView(){const ticket=ops()?.state?.currentWorkOrder;if(ticket?.id)void load(ticket.id,true)}
  const observer=new MutationObserver(()=>{const ticket=ops()?.state?.currentWorkOrder;if(ticket?.id)setTimeout(()=>void load(ticket.id),40)});
  const begin=()=>{styles();const root=document.getElementById('work-order');if(root)observer.observe(root,{childList:true,subtree:true});refreshFromView()};
  document.addEventListener('gc-view-changed',event=>{const view=typeof event.detail==='string'?event.detail:location.hash.slice(1).split('/')[0];if(view==='work-order')setTimeout(refreshFromView,40)});
  document.addEventListener('gc-portal-runtime-ready',()=>setTimeout(begin,80));
  window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#work-order'))setTimeout(refreshFromView,60)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(begin,150),{once:true});else setTimeout(begin,150);

  window.GotCrackedPartAvailability={version:'1.0.0',state,load,refresh:refreshFromView};
})();
