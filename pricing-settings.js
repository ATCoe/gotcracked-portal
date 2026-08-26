(() => {
  'use strict';
  const client = window.supabaseClient;
  if (!client) return;

  const training = () => localStorage.getItem('gc-training-store') === '1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
  let profile = null;
  let settings = null;
  let inventory = [];
  let guides = [];

  function isManager(){ return ['owner','manager'].includes(profile?.role); }

  async function identity(){
    profile = window.GotCrackedOperationsV1?.state?.profile || profile;
    if (profile?.id) return profile;
    const { data:{user} } = await client.auth.getUser();
    if (!user) return null;
    const result = await client.from('profiles').select('id,location_id,display_name,role,active').eq('id',user.id).maybeSingle();
    if (!result.error) profile = result.data;
    return profile;
  }

  function trainingState(){
    const raw = JSON.parse(localStorage.getItem('gc-training-pricing-v1') || 'null');
    const data = JSON.parse(localStorage.getItem('gc-training-data-v1') || '{}');
    return raw || {
      settings:{target_gross_margin_percent:50,target_splh:125,target_labor_percent:.18,charge_parts_to_customer:false,auto_service_taxable:true,custom_pc_build_service_charge_cents:24999,custom_pc_build_estimate_valid_days:7},
      inventory:(data.inventory||[]).map(x=>({...x,estimated_repair_minutes:x.estimated_repair_minutes||null,repair_guide_id:x.repair_guide_id||null})),
      guides:window.GotCrackedOperationsV1?.state?.guides||[]
    };
  }

  async function load(){
    if (training()) {
      const local = trainingState(); settings=local.settings; inventory=local.inventory; guides=local.guides; return;
    }
    const [business,parts,refs] = await Promise.all([
      client.from('business_settings').select('location_id,target_gross_margin_percent,target_splh,target_labor_percent,charge_parts_to_customer,auto_service_taxable,custom_pc_build_service_charge_cents,custom_pc_build_estimate_valid_days').eq('location_id',profile.location_id).maybeSingle(),
      client.from('inventory_items').select('id,sku,name,category,cost_cents,sell_price_cents,repair_guide_id,estimated_repair_minutes').eq('location_id',profile.location_id).eq('active',true).order('name'),
      client.from('repair_guides').select('id,title,device_category,manufacturer,model_family,bench_time_minutes').eq('location_id',profile.location_id).eq('active',true).order('device_category').order('title')
    ]);
    if (!business.error) settings=business.data;
    if (!parts.error) inventory=parts.data||[];
    if (!refs.error) guides=refs.data||[];
  }

  function partOptions(){
    return inventory.map(p=>`<option value="${esc(p.id)}">${esc(p.sku||'NO SKU')} · ${esc(p.name||'Part')}</option>`).join('');
  }
  function guideOptions(){
    return `<option value="">Automatic device-type estimate</option>`+guides.map(g=>`<option value="${esc(g.id)}">${esc(g.device_category||'Device')} · ${esc(g.title)}${g.bench_time_minutes?` · ${g.bench_time_minutes} min`:''}</option>`).join('');
  }

  function render(){
    const host=document.getElementById('settings');
    if(!host||!isManager()) return;
    document.getElementById('gc-pricing-engine-settings')?.remove();
    const hourlyLabor=(Number(settings?.target_splh||0)*Number(settings?.target_labor_percent||0));
    host.insertAdjacentHTML('beforeend',`<section id="gc-pricing-engine-settings" class="card">
      <div class="card-title"><div><p class="eyebrow">Pricing engine</p><h2>Repair pricing targets</h2></div></div>
      <form id="gc-pricing-target-form" class="settings-list">
        <label>Target gross margin (%)<input name="target_gm" type="number" min="0" max="94" step="0.5" value="${Number(settings?.target_gross_margin_percent ?? 50)}" required></label>
        <div class="demo-note"><strong>Current labor-cost basis:</strong> ${money(Math.round(hourlyLabor*100))}/bench hour. Portal derives this from target SPLH × target labor %. The repair target is calculated from part acquisition cost + estimated labor cost, then grossed up to the target GM.</div>
        <div class="demo-note"><strong>Current part mode:</strong> ${settings?.charge_parts_to_customer?'Parts shown separately + labor/service companion':'Part consumed internally at $0 + bundled Repair Service charge'}. Existing quotes are never repriced when this setting changes.</div>
        <p class="auth-message" role="status"></p><button class="primary-button" type="submit">Save target margin</button>
      </form>
      <hr style="border:0;border-top:1px solid var(--line,#27384f);margin:22px 0">
      <div class="card-title"><div><p class="eyebrow">Custom PC builds</p><h2>Build estimate settings</h2></div></div>
      <form id="gc-pc-build-pricing-form" class="settings-list">
        <label>Custom PC build service charge ($)<input name="service_charge" type="number" min="0" max="5000" step="1" value="${(Number(settings?.custom_pc_build_service_charge_cents ?? 24999)/100).toFixed(2)}" required></label>
        <label>Estimate validity (days)<input name="valid_days" type="number" min="1" max="30" step="1" value="${Number(settings?.custom_pc_build_estimate_valid_days ?? 7)}" required></label>
        <div class="demo-note"><strong>Customer presentation:</strong> the planner shows one estimated total that combines researched parts + this service charge. Individual part prices, retailer sourcing, and the service-charge breakdown remain inside the Portal.</div>
        <div class="demo-note"><strong>Compatibility gate:</strong> an automatic estimate is released only after Newegg PC Builder compatibility evidence, manufacturer specifications, and Portal server assertions all pass. Otherwise the request is held for manual review.</div>
        <p class="auth-message" role="status"></p><button class="primary-button" type="submit">Save PC build settings</button>
      </form>
      <hr style="border:0;border-top:1px solid var(--line,#27384f);margin:22px 0">
      <div class="card-title"><div><h2>Part repair-time mapping</h2></div></div>
      <form id="gc-part-pricing-map-form" class="settings-list">
        <label>Inventory part<select name="part_id" required><option value="">Choose a part…</option>${partOptions()}</select></label>
        <label>Repair Reference guide<select name="guide_id">${guideOptions()}</select></label>
        <label>Bench-time override (minutes)<input name="minutes" type="number" min="1" max="1440" step="1" placeholder="Leave blank to use guide/device estimate"></label>
        <div class="demo-note">Pricing-time priority: SKU minute override → linked Repair Reference guide → median bench time for the work order’s device type → 60-minute fallback.</div>
        <p class="auth-message" role="status"></p><button class="primary-button" type="submit">Save part pricing profile</button>
      </form>
      <div class="demo-note" style="margin-top:18px"><strong>Tax note:</strong> customer-facing line structure and taxability are intentionally separate settings. Do not change tax treatment solely to change the receipt presentation; configure taxability according to the applicable tax rules for the business.</div>
    </section>`);
  }

  function populatePart(partId){
    const part=inventory.find(x=>x.id===partId); const form=document.getElementById('gc-part-pricing-map-form'); if(!part||!form)return;
    form.elements.guide_id.value=part.repair_guide_id||'';
    form.elements.minutes.value=part.estimated_repair_minutes||'';
  }

  async function saveTarget(form){
    const value=Number(form.elements.target_gm.value); const status=form.querySelector('.auth-message');
    if(!(value>=0&&value<95)){status.textContent='Gross margin must be between 0% and 94%.';return;}
    if(training()){
      const local=trainingState(); local.settings={...local.settings,target_gross_margin_percent:value}; localStorage.setItem('gc-training-pricing-v1',JSON.stringify(local)); settings=local.settings; status.textContent='Training pricing target saved.'; return;
    }
    const result=await client.from('business_settings').update({target_gross_margin_percent:value,updated_at:new Date().toISOString()}).eq('location_id',profile.location_id);
    if(result.error){status.textContent=result.error.message;return;}
    settings={...settings,target_gross_margin_percent:value}; status.textContent='Pricing target saved. New part lines will use it.';
  }

  async function savePcBuildSettings(form){
    const chargeDollars=Number(form.elements.service_charge.value); const validDays=Number(form.elements.valid_days.value); const status=form.querySelector('.auth-message');
    if(!Number.isFinite(chargeDollars)||chargeDollars<0||chargeDollars>5000){status.textContent='Build service charge must be between $0 and $5,000.';return;}
    if(!Number.isInteger(validDays)||validDays<1||validDays>30){status.textContent='Estimate validity must be 1–30 days.';return;}
    const chargeCents=Math.round(chargeDollars*100);
    if(training()){
      const local=trainingState(); local.settings={...local.settings,custom_pc_build_service_charge_cents:chargeCents,custom_pc_build_estimate_valid_days:validDays}; localStorage.setItem('gc-training-pricing-v1',JSON.stringify(local)); settings=local.settings; status.textContent='Training PC build settings saved.'; return;
    }
    const result=await client.from('business_settings').update({custom_pc_build_service_charge_cents:chargeCents,custom_pc_build_estimate_valid_days:validDays,updated_at:new Date().toISOString()}).eq('location_id',profile.location_id);
    if(result.error){status.textContent=result.error.message;return;}
    settings={...settings,custom_pc_build_service_charge_cents:chargeCents,custom_pc_build_estimate_valid_days:validDays}; status.textContent='Custom PC build settings saved. New estimates will use these values.';
  }

  async function savePartMap(form){
    const partId=form.elements.part_id.value; const guideId=form.elements.guide_id.value||null; const raw=form.elements.minutes.value; const minutes=raw?Number(raw):null; const status=form.querySelector('.auth-message');
    const part=inventory.find(x=>x.id===partId); if(!part){status.textContent='Choose an inventory part.';return;}
    if(minutes!==null&&(!(minutes>=1)||minutes>1440)){status.textContent='Bench time must be 1–1440 minutes.';return;}
    if(training()){
      part.repair_guide_id=guideId; part.estimated_repair_minutes=minutes; const local=trainingState(); local.inventory=inventory; localStorage.setItem('gc-training-pricing-v1',JSON.stringify(local)); status.textContent='Training part pricing profile saved.'; return;
    }
    const result=await client.from('inventory_items').update({repair_guide_id:guideId,estimated_repair_minutes:minutes,updated_at:new Date().toISOString()}).eq('id',partId).eq('location_id',profile.location_id);
    if(result.error){status.textContent=result.error.message;return;}
    part.repair_guide_id=guideId; part.estimated_repair_minutes=minutes; status.textContent='Part pricing profile saved. New work-order additions will use it.';
  }

  document.addEventListener('change',event=>{ if(event.target.matches('#gc-part-pricing-map-form [name="part_id"]')) populatePart(event.target.value); });
  document.addEventListener('submit',event=>{
    if(event.target.id==='gc-pricing-target-form'){event.preventDefault();saveTarget(event.target);}
    if(event.target.id==='gc-pc-build-pricing-form'){event.preventDefault();savePcBuildSettings(event.target);}
    if(event.target.id==='gc-part-pricing-map-form'){event.preventDefault();savePartMap(event.target);}
  });

  async function init(){ await identity(); if(!profile?.active||!isManager())return; await load(); render(); }
  init();
})();
