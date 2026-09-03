(()=>{
  'use strict';
  if(window.GotCrackedMarlonShippingSupport)return;
  const client=window.supabaseClient;if(!client)return;
  const state={poRecommendations:new Map(),shipmentDetails:new Map(),busy:false,context:null};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(c)||0)/100);
  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const poCode=n=>`PO-${String(n||'').replace(/\D/g,'').padStart(6,'0')}`;
  const selectedOption=(rec,key)=>Array.isArray(rec?.options)?rec.options.find(x=>x.option_key===key):null;

  function style(){
    if(document.getElementById('gc-marlon-shipping-style'))return;
    const s=document.createElement('style');s.id='gc-marlon-shipping-style';s.textContent=`
      .gc-ms-ship-box{margin:12px 0;padding:12px;border:1px solid rgba(24,128,194,.28);border-radius:12px;background:rgba(24,128,194,.055);display:grid;gap:9px}.gc-ms-ship-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.gc-ms-ship-head small,.gc-ms-ship-help{display:block;opacity:.7}.gc-ms-ship-grid{display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px;align-items:end}.gc-ms-ship-grid label{display:grid;gap:4px}.gc-ms-ship-pick{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;background:#e3f2ff;color:#1767a4}.gc-ms-ship-selected{font-size:12px;font-weight:800}.gc-ship-rate.gc-marlon-rate{outline:2px solid rgba(23,125,189,.5);outline-offset:1px}.gc-marlon-rate-tag{display:inline-flex;margin-top:4px;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:900;background:#e3f2ff;color:#1767a4}.gc-marlon-prefer-rate{display:block;margin-top:4px;padding:0;border:0;background:transparent;color:#1767a4;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.gc-shipping-pref-note{font-size:12px;opacity:.7}@media(max-width:760px){.gc-ms-ship-grid{grid-template-columns:1fr}.gc-ms-ship-head{display:grid}}
    `;document.head.appendChild(s);
  }

  async function refreshContext(){
    try{
      const result=await client.rpc('get_marlon_shipping_context');
      if(!result.error){state.context=result.data||null;window.GotCrackedMarlonOperationalContext={...(window.GotCrackedMarlonOperationalContext||{}),shipping:state.context};}
    }catch{}
  }

  async function recommendationForPo(poId,force=false){
    if(!poId)return null;
    if(!force&&state.poRecommendations.has(poId))return state.poRecommendations.get(poId);
    const result=await client.rpc('get_mobilesentrix_shipping_recommendation',{p_purchase_order_id:poId});
    if(result.error)throw result.error;
    state.poRecommendations.set(poId,result.data||null);
    return result.data||null;
  }

  function exactCarrier(value){return ['FedEx','UPS','USPS'].includes(String(value||''))?String(value):'';}
  function optionMarkup(rec,selectedKey){
    const options=Array.isArray(rec?.options)?rec.options:[];
    return `<option value="">Choose MobileSentrix method</option>${options.map(o=>`<option value="${esc(o.option_key)}" ${o.option_key===selectedKey?'selected':''}>${esc(o.carrier)} · ${esc(o.service)} · ${money(o.effective_cost_cents||0)}${o.transit_days_max!=null?` · ${Number(o.transit_days_min||o.transit_days_max)}–${Number(o.transit_days_max)} day${Number(o.transit_days_max)===1?'':'s'}`:''}</option>`).join('')}`;
  }

  async function decoratePreparedOrders(){
    const cc=window.GotCrackedInventoryCommandCenter;if(!cc?.state?.pos?.length)return;
    const cards=[...document.querySelectorAll('.gc-order-card')];
    for(const card of cards){
      const action=card.querySelector('[data-gc-finalize-order]');const poId=action?.dataset?.gcFinalizeOrder;if(!poId)continue;
      const po=cc.state.pos.find(x=>x.id===poId);if(!po||String(po.supplier_name||'').toLowerCase()!=='mobilesentrix')continue;
      let rec=null;try{rec=await recommendationForPo(poId)}catch(error){console.warn('MobileSentrix shipping recommendation unavailable',error);continue}
      card.querySelector('.gc-ms-ship-box')?.remove();
      const best=rec?.recommended||{};const currentKey=po.supplier_shipping_option_key||best.option_key||'';const currentOption=selectedOption(rec,currentKey)||best;
      const currentCarrier=po.supplier_shipping_carrier||exactCarrier(currentOption?.carrier)||'';
      const currentService=po.supplier_shipping_service||currentOption?.service||'';
      const selectedText=po.supplier_shipping_carrier&&po.supplier_shipping_service?`${po.supplier_shipping_carrier} · ${po.supplier_shipping_service}${po.supplier_shipping_cost_cents!=null?` · ${money(po.supplier_shipping_cost_cents)}`:''}`:'Not saved yet';
      const box=document.createElement('div');box.className='gc-ms-ship-box';box.dataset.gcPoShipping=poId;
      box.innerHTML=`<div class="gc-ms-ship-head"><div><strong>Marlon shipping recommendation</strong><small>${best.service?`${esc(best.carrier)} · ${esc(best.service)} · ${money(best.effective_cost_cents||0)}${best.transit_days_max!=null?` · up to ${Number(best.transit_days_max)} day${Number(best.transit_days_max)===1?'':'s'}`:''}`:'No published method could be recommended.'}</small><small>${esc(rec?.note||'MobileSentrix checkout is authoritative for the exact carrier, price, and availability.')}</small></div><span class="gc-ms-ship-pick">${rec?.ground_only?'Ground required':'Marlon pick'}</span></div><div class="gc-ms-ship-grid"><label>Shipping method<select data-gc-ms-method="${poId}">${optionMarkup(rec,currentKey)}</select></label><label>Exact carrier<select data-gc-ms-carrier="${poId}"><option value="">Choose at checkout</option><option value="FedEx" ${currentCarrier==='FedEx'?'selected':''}>FedEx</option><option value="UPS" ${currentCarrier==='UPS'?'selected':''}>UPS</option><option value="USPS" ${currentCarrier==='USPS'?'selected':''}>USPS</option></select></label><button class="secondary-button" type="button" data-gc-save-ms-shipping="${poId}">Save choice</button></div><div class="gc-ms-ship-selected">Saved for ${poCode(po.po_number)}: ${esc(selectedText)}</div><div class="gc-ms-ship-help">You can also tell Marlon: “Use UPS Ground for ${poCode(po.po_number)}.” This records the supplier shipping choice only; MobileSentrix checkout still has to be completed separately.</div>`;
      const orderActions=card.querySelector('.gc-order-actions');if(orderActions)card.insertBefore(box,orderActions);else card.appendChild(box);
      const method=box.querySelector('[data-gc-ms-method]');
      if(method&&currentService&&!method.value){const match=(rec?.options||[]).find(o=>String(o.service||'').toLowerCase()===String(currentService).toLowerCase());if(match)method.value=match.option_key;}
    }
  }

  async function saveSupplierChoice(poId){
    if(state.busy)return;const method=document.querySelector(`[data-gc-ms-method="${CSS.escape(poId)}"]`),carrierSelect=document.querySelector(`[data-gc-ms-carrier="${CSS.escape(poId)}"]`);const rec=await recommendationForPo(poId);const option=selectedOption(rec,method?.value);
    if(!option){alert('Choose a MobileSentrix shipping method.');return}
    let carrier=String(carrierSelect?.value||'');
    if(!carrier&&exactCarrier(option.carrier))carrier=option.carrier;
    if(!carrier){alert('Choose the exact carrier shown by MobileSentrix checkout before saving this method.');return}
    state.busy=true;try{
      const result=await client.rpc('set_mobilesentrix_shipping_choice',{p_purchase_order_id:poId,p_carrier:carrier,p_service:option.service,p_option_key:option.option_key,p_cost_cents:Number(option.effective_cost_cents||0),p_source:'staff'});if(result.error)throw result.error;
      await window.GotCrackedInventoryCommandCenter?.load?.();state.poRecommendations.delete(poId);await refreshContext();setTimeout(()=>void decoratePreparedOrders(),80);
    }catch(error){window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to save MobileSentrix shipping choice'});alert(error.message||'Unable to save shipping choice.')}finally{state.busy=false}
  }

  function syncCarrierFromMethod(select){
    const poId=select.dataset.gcMsMethod,rec=state.poRecommendations.get(poId),option=selectedOption(rec,select.value),carrier=document.querySelector(`[data-gc-ms-carrier="${CSS.escape(poId)}"]`);if(!option||!carrier)return;
    const exact=exactCarrier(option.carrier);if(exact)carrier.value=exact;else if(!['FedEx','UPS'].includes(carrier.value))carrier.value='';
  }

  async function shipmentDetail(id){
    if(!id)return null;const cached=state.shipmentDetails.get(id);if(cached)return cached;
    const result=await client.from('shipping_shipments').select('id,status,rates,marlon_recommended_rate_id,marlon_recommendation,preferred_rate_id,preferred_carrier,preferred_service').eq('id',id).maybeSingle();if(result.error)throw result.error;state.shipmentDetails.set(id,result.data||null);return result.data||null;
  }

  async function decorateDeviceRates(force=false){
    const shipping=window.GotCrackedIntegratedShipping?.state;if(!shipping?.ratedShipmentId||!shipping?.rates?.length)return;
    if(force)state.shipmentDetails.delete(shipping.ratedShipmentId);
    let detail=null;try{detail=await shipmentDetail(shipping.ratedShipmentId)}catch{return}
    const recommended=detail?.marlon_recommended_rate_id||detail?.marlon_recommendation?.rateId;
    for(const rate of shipping.rates){
      const buy=document.querySelector(`[data-gc-buy-rate="${CSS.escape(String(rate.id))}"]`);const row=buy?.closest('.gc-ship-rate');if(!row)continue;
      row.classList.toggle('gc-marlon-rate',String(rate.id)===String(recommended));
      const first=row.firstElementChild;if(!first)continue;first.querySelector('.gc-marlon-rate-tag')?.remove();first.querySelector('.gc-marlon-prefer-rate')?.remove();
      const isRecommended=String(rate.id)===String(recommended),isPreferred=String(rate.id)===String(detail?.preferred_rate_id);
      if(isRecommended||isPreferred){const tag=document.createElement('span');tag.className='gc-marlon-rate-tag';tag.textContent=isPreferred?'Preferred':'Marlon recommends';first.appendChild(tag);}
      if(!isPreferred){const choose=document.createElement('button');choose.type='button';choose.className='gc-marlon-prefer-rate';choose.dataset.gcPreferDeviceRate=rate.id;choose.textContent=isRecommended?'Use Marlon recommendation':'Set as preferred';first.appendChild(choose);}
    }
  }

  async function preferDeviceRate(rateId){
    const shipping=window.GotCrackedIntegratedShipping?.state;if(state.busy||!shipping?.ratedShipmentId)return;const rate=shipping.rates.find(r=>String(r.id)===String(rateId));if(!rate)return;
    state.busy=true;try{const result=await client.functions.invoke('shipping-provider',{body:{action:'prefer',shipment_id:shipping.ratedShipmentId,rate_id:rate.id,carrier:rate.carrier,service:rate.service,source:'staff'}});if(result.error||result.data?.ok===false)throw new Error(result.data?.error||result.error?.message||'Unable to save preferred rate.');state.shipmentDetails.delete(shipping.ratedShipmentId);await refreshContext();await decorateDeviceRates(true)}catch(error){window.GotCrackedDiagnostics?.error?.(error,{context:'Unable to save preferred device shipping rate'});alert(error.message||'Unable to save preferred rate.')}finally{state.busy=false}
  }

  async function decorateShippingSettings(){
    const grid=document.querySelector('#gc-shipping-provider-form .gc-ship-settings-grid');if(!grid||grid.querySelector('[data-gc-device-shipping-preference]'))return;
    const status=window.GotCrackedIntegratedShipping?.state?.status||{};const label=document.createElement('label');label.innerHTML=`Marlon device shipping preference<select data-gc-device-shipping-preference><option value="balanced" ${status.preference==='balanced'||!status.preference?'selected':''}>Balanced cost + speed</option><option value="lowest_cost" ${status.preference==='lowest_cost'?'selected':''}>Lowest cost</option><option value="fastest" ${status.preference==='fastest'?'selected':''}>Fastest</option></select><small class="gc-shipping-pref-note">Used only to recommend a live carrier rate. It never purchases postage.</small>`;grid.appendChild(label);
  }

  async function saveDevicePreference(select){
    const shipping=window.GotCrackedIntegratedShipping?.state,status=shipping?.status||{},d=status.defaultParcel||{length:10,width:8,height:4,weight_oz:32};
    try{const result=await client.functions.invoke('shipping-provider',{body:{action:'configure',mode:status.mode||'test',preference:select.value,default_parcel:d}});if(result.error||result.data?.ok===false)throw new Error(result.data?.error||result.error?.message||'Unable to save preference.');if(shipping?.status)shipping.status.preference=select.value;await refreshContext()}catch(error){alert(error.message||'Unable to save shipping preference.')}
  }

  let supplierPreferenceDecorating=false;
  async function decorateSupplierPreference(){
    const host=document.querySelector('#gc-mobilesentrix-settings .gc-ms-grid');if(!host||host.querySelector('[data-gc-supplier-shipping-preference]')||supplierPreferenceDecorating)return;const p=profile();if(!p?.location_id)return;
    supplierPreferenceDecorating=true;try{const result=await client.from('business_settings').select('supplier_shipping_preference').eq('location_id',p.location_id).maybeSingle();if(result.error)return; if(host.querySelector('[data-gc-supplier-shipping-preference]'))return;const value=result.data?.supplier_shipping_preference||'balanced';const label=document.createElement('label');label.innerHTML=`Marlon supplier shipping preference<select data-gc-supplier-shipping-preference><option value="balanced" ${value==='balanced'?'selected':''}>Balanced cost + deadline</option><option value="lowest_cost" ${value==='lowest_cost'?'selected':''}>Lowest cost</option><option value="fastest" ${value==='fastest'?'selected':''}>Fastest</option></select><small>Used for MobileSentrix shipping recommendations only.</small>`;host.appendChild(label);}finally{supplierPreferenceDecorating=false}
  }

  async function saveSupplierPreference(select){const p=profile();if(!p?.location_id)return;const result=await client.from('business_settings').update({supplier_shipping_preference:select.value,updated_at:new Date().toISOString()}).eq('location_id',p.location_id);if(result.error){alert(result.error.message||'Unable to save supplier shipping preference.');return}state.poRecommendations.clear();await refreshContext();setTimeout(()=>void decoratePreparedOrders(),80)}

  async function refresh(){style();await refreshContext();if(location.hash.startsWith('#inventory'))await decoratePreparedOrders();if(location.hash.startsWith('#shipping'))await decorateDeviceRates();if(location.hash.startsWith('#settings')){await decorateShippingSettings();await decorateSupplierPreference();}}

  document.addEventListener('click',event=>{const t=event.target instanceof Element?event.target:null;if(!t)return;const save=t.closest('[data-gc-save-ms-shipping]');if(save)return void saveSupplierChoice(save.dataset.gcSaveMsShipping);const prefer=t.closest('[data-gc-prefer-device-rate]');if(prefer)return void preferDeviceRate(prefer.dataset.gcPreferDeviceRate)});
  document.addEventListener('change',event=>{const t=event.target;if(!(t instanceof HTMLSelectElement))return;if(t.matches('[data-gc-ms-method]'))syncCarrierFromMethod(t);else if(t.matches('[data-gc-device-shipping-preference]'))void saveDevicePreference(t);else if(t.matches('[data-gc-supplier-shipping-preference]'))void saveSupplierPreference(t)});
  document.addEventListener('gc-inventory-command-center-rendered',()=>setTimeout(()=>void decoratePreparedOrders(),30));
  const observer=new MutationObserver(()=>{if(location.hash.startsWith('#shipping'))void decorateDeviceRates();if(location.hash.startsWith('#settings')){void decorateShippingSettings();void decorateSupplierPreference();}if(location.hash.startsWith('#inventory'))void decoratePreparedOrders();});observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('gc-view-changed',()=>setTimeout(()=>void refresh(),120));window.addEventListener('hashchange',()=>setTimeout(()=>void refresh(),120));window.addEventListener('gotcracked:staff-ready',()=>setTimeout(()=>void refresh(),150));
  setTimeout(()=>void refresh(),180);
  window.GotCrackedMarlonShippingSupport={version:'1.0.0',state,refresh,recommendationForPo};
})();

