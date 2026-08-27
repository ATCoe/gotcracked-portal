(() => {
  'use strict';

  if (window.GotCrackedIntakeExperienceV2) return;

  const VERSION = '20260827-intake-v2-1';
  const client = window.supabaseClient;
  if (!client) return;

  const state = () => window.GotCrackedOperationsV1?.state || null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const label = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

  let manufacturers = null;
  let manufacturersPromise = null;
  let models = [];
  let selectedManufacturer = null;
  let selectedModel = null;
  let decorateFrame = 0;
  let modelSearchTimer = 0;
  let lastDeviceStepKey = '';
  const enrichmentAttempted = new Set();

  function injectStyle() {
    if (document.getElementById('gc-intake-v2-style')) return;
    const style = document.createElement('style');
    style.id = 'gc-intake-v2-style';
    style.textContent = `
      .gc-catalog-shell{display:grid;gap:14px;padding:14px;border:1px solid var(--line,#d9e2ec);border-radius:15px;background:var(--surface-subtle,#f7f9fc);margin:14px 0 18px}
      .gc-catalog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.gc-catalog-head h4{margin:0}.gc-catalog-head p{margin:3px 0 0;color:var(--muted,#667085);font-size:.9rem}
      .gc-catalog-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-catalog-grid label{display:grid;gap:6px}.gc-catalog-grid input,.gc-catalog-grid select{width:100%}
      .gc-model-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;max-height:330px;overflow:auto}
      .gc-model-card{appearance:none;border:1px solid var(--line,#d9e2ec);background:var(--surface,#fff);color:var(--text,#101827);border-radius:13px;padding:10px;text-align:left;display:grid;grid-template-columns:58px minmax(0,1fr);gap:10px;align-items:center;min-height:76px}
      .gc-model-card:hover,.gc-model-card:focus-visible{border-color:var(--accent,#2b7cff);outline:2px solid color-mix(in srgb,var(--accent,#2b7cff) 24%,transparent)}
      .gc-model-card.selected{border-color:var(--accent,#2b7cff);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#2b7cff) 18%,transparent)}
      .gc-model-thumb{width:58px;height:58px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid rgba(120,140,160,.25)}
      .gc-model-thumb-fallback{width:58px;height:58px;border-radius:10px;display:grid;place-items:center;background:var(--surface-subtle,#eef3f8);font-weight:800;color:var(--muted,#667085)}
      .gc-model-copy{min-width:0;display:grid;gap:2px}.gc-model-copy strong{line-height:1.2}.gc-model-copy small{color:var(--muted,#667085);white-space:normal}
      .gc-catalog-empty{padding:12px;border:1px dashed var(--line,#d9e2ec);border-radius:12px;color:var(--muted,#667085)}
      .gc-variant-block{display:grid;gap:9px}.gc-variant-block>strong{font-size:.82rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#667085)}
      .gc-choice-chips{display:flex;flex-wrap:wrap;gap:7px}.gc-choice-chip{appearance:none;border:1px solid var(--line,#d9e2ec);background:var(--surface,#fff);color:var(--text,#101827);border-radius:999px;padding:9px 12px;font-weight:700;min-height:40px}
      .gc-choice-chip.selected{background:var(--accent,#2b7cff);border-color:var(--accent,#2b7cff);color:#fff}
      .gc-catalog-photo-credit{font-size:.72rem;color:var(--muted,#667085)}.gc-catalog-photo-credit a{color:inherit}
      .gc-catalog-managed-field{display:none!important}.gc-catalog-manual .gc-catalog-managed-field{display:grid!important}.gc-catalog-manual .gc-catalog-shell{border-style:dashed}
      .gc-check-controls{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.gc-check-control{appearance:none;border:1px solid var(--line,#d9e2ec);background:var(--surface,#fff);color:var(--text,#101827);border-radius:999px;padding:8px 11px;font-weight:750;min-height:38px}
      .gc-check-control.selected[data-state="pass"]{background:#e8f7ef;border-color:#62b785;color:#17663c}.gc-check-control.selected[data-state="fail"],.gc-check-control.selected[data-state="damaged"],.gc-check-control.selected[data-state="observed"]{background:#fff0ef;border-color:#df7b73;color:#9b281f}.gc-check-control.selected[data-state="not_applicable"]{background:#eef2f6;border-color:#a7b2bf;color:#44515f}
      .v1-check-row.gc-check-upgraded{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;gap:12px!important;padding:12px 10px!important;border-bottom:1px solid var(--line,#d9e2ec)!important}
      .v1-check-row.gc-check-upgraded>span{font-weight:700}.v1-check-row.gc-check-upgraded select{display:none!important}
      .v1-check-row.gc-check-upgraded.gc-assessed{background:color-mix(in srgb,var(--surface-subtle,#f7f9fc) 70%,transparent)}
      .gc-check-group-tools{display:flex;justify-content:flex-end;gap:8px;padding:8px 10px 10px}.gc-check-group-tools button{min-height:38px}
      .gc-inspection-progress{display:grid;gap:8px;padding:14px;border:1px solid var(--line,#d9e2ec);border-radius:14px;background:var(--surface,#fff);margin-bottom:14px;color:var(--text,#101827)}
      .gc-inspection-progress header{display:flex;justify-content:space-between;gap:12px;align-items:center}.gc-inspection-progress strong{color:var(--text,#101827)!important}.gc-inspection-track{height:8px;border-radius:999px;background:var(--line,#d9e2ec);overflow:hidden}.gc-inspection-track i{display:block;height:100%;background:var(--accent,#2b7cff);transition:width .15s ease}
      html[data-theme="dark"] .gc-catalog-shell,html[data-theme="dark"] .gc-inspection-progress{background:#0e1925;border-color:#2b3c4f;color:#edf4fb}
      html[data-theme="dark"] .gc-model-card,html[data-theme="dark"] .gc-choice-chip,html[data-theme="dark"] .gc-check-control{background:#111d2a;border-color:#2b3c4f;color:#edf4fb}
      html[data-theme="dark"] .v1-check-row.gc-check-upgraded.gc-assessed{background:#0f1b28}
      @media(max-width:680px){
        .gc-catalog-grid{grid-template-columns:1fr}.gc-model-results{grid-template-columns:1fr;max-height:280px}.gc-check-controls{justify-content:flex-start;width:100%}.v1-check-row.gc-check-upgraded{grid-template-columns:1fr!important;gap:8px!important}.gc-check-control{flex:1 1 92px}.gc-catalog-head>button{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  async function loadManufacturers() {
    if (manufacturers) return manufacturers;
    if (manufacturersPromise) return manufacturersPromise;
    manufacturersPromise = client.from('device_catalog_manufacturers')
      .select('id,name,categories')
      .eq('active',true)
      .order('name')
      .then(({data,error}) => {
        if (error) throw error;
        manufacturers = data || [];
        return manufacturers;
      })
      .catch(error => {
        console.warn('Device catalog manufacturers unavailable:',error);
        manufacturers = [];
        return manufacturers;
      })
      .finally(()=>{manufacturersPromise=null;});
    return manufacturersPromise;
  }

  function intake() { return state()?.intake || null; }
  function dialog() { return document.getElementById('v1-intake-dialog'); }

  function setNativeField(name,value,eventType='input') {
    const root=dialog();
    const field=root?.querySelector(`[data-intake-device="${name}"]`);
    if (!field) return;
    field.value = value ?? '';
    field.dispatchEvent(new Event(eventType,{bubbles:true}));
    if (eventType !== 'change') field.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function manufacturerOptions(category,current='') {
    const list=(manufacturers||[]).filter(item => !category || !item.categories?.length || item.categories.includes(category));
    return `<option value="">Choose manufacturer</option>${list.map(item=>`<option value="${esc(item.id)}" ${item.name===current?'selected':''}>${esc(item.name)}</option>`).join('')}`;
  }

  async function loadModels(manufacturerId,category) {
    if (!manufacturerId || !category) { models=[]; return []; }
    const result=await client.from('device_catalog_models')
      .select('id,manufacturer_id,category,name,family,release_year,model_numbers,colors,storage_options,image_url,image_source,image_license,image_author,image_attribution_url,source_system,source_key,device_catalog_manufacturers(name)')
      .eq('active',true)
      .eq('manufacturer_id',manufacturerId)
      .eq('category',category)
      .order('release_year',{ascending:false,nullsFirst:false})
      .order('name');
    if (result.error) {
      console.warn('Device catalog models unavailable:',result.error);
      models=[];
      return [];
    }
    models=result.data||[];
    return models;
  }

  function currentManufacturerName() {
    return selectedManufacturer?.name || intake()?.newDevice?.manufacturer || '';
  }

  function modelCard(model) {
    const image=model.image_url
      ? `<img class="gc-model-thumb" src="${esc(model.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="gc-model-thumb-fallback" aria-hidden="true">DEV</span>`;
    const meta=[model.release_year, ...(model.storage_options||[]).slice(0,3)].filter(Boolean).join(' · ');
    return `<button type="button" class="gc-model-card ${selectedModel?.id===model.id?'selected':''}" data-gc-catalog-model="${esc(model.id)}">${image}<span class="gc-model-copy"><strong>${esc(model.name)}</strong><small>${esc(meta||model.family||'Device catalog')}</small></span></button>`;
  }

  function renderModelResults(query='') {
    const host=dialog()?.querySelector('[data-gc-model-results]');
    if (!host) return;
    const q=String(query||'').trim().toLowerCase();
    const filtered=models.filter(model => !q || `${model.name} ${model.family||''} ${(model.model_numbers||[]).join(' ')}`.toLowerCase().includes(q)).slice(0,40);
    host.innerHTML=filtered.length
      ? filtered.map(modelCard).join('')
      : `<div class="gc-catalog-empty">No local catalog match. Use <strong>Search global catalog</strong> or switch to manual entry.</div>`;
  }

  function renderVariantChoices(model) {
    const host=dialog()?.querySelector('[data-gc-variant-host]');
    if (!host) return;
    if (!model) { host.innerHTML=''; return; }
    const d=intake()?.newDevice||{};
    const chipBlock=(title,key,values)=>values?.length?`<div class="gc-variant-block"><strong>${esc(title)}</strong><div class="gc-choice-chips">${values.map(value=>`<button type="button" class="gc-choice-chip ${String(d[key]||'')===String(value)?'selected':''}" data-gc-device-value="${esc(key)}" data-gc-device-option="${esc(value)}">${esc(value)}</button>`).join('')}</div></div>`:'';
    const modelNumbers=model.model_numbers||[];
    const credit=model.image_url&&model.image_source
      ? `<div class="gc-catalog-photo-credit">Photo: ${model.image_attribution_url?`<a href="${esc(model.image_attribution_url)}" target="_blank" rel="noopener">${esc(model.image_source)}</a>`:esc(model.image_source)}${model.image_license?` · ${esc(model.image_license)}`:''}${model.image_author?` · ${esc(model.image_author)}`:''}</div>`
      : '';
    host.innerHTML=`
      ${chipBlock('Storage','storage_size',model.storage_options||[])}
      ${chipBlock('Color','color',model.colors||[])}
      ${modelNumbers.length?`<div class="gc-variant-block"><strong>Model number</strong><div class="gc-choice-chips">${modelNumbers.map(value=>`<button type="button" class="gc-choice-chip ${String(d.model_number||'')===String(value)?'selected':''}" data-gc-device-value="model_number" data-gc-device-option="${esc(value)}">${esc(value)}</button>`).join('')}</div></div>`:''}
      ${credit}`;
  }

  async function selectManufacturer(id) {
    selectedManufacturer=(manufacturers||[]).find(item=>item.id===id)||null;
    selectedModel=null;
    const root=dialog();
    const search=root?.querySelector('[data-gc-model-search]');
    if (selectedManufacturer) setNativeField('manufacturer',selectedManufacturer.name);
    else setNativeField('manufacturer','');
    if (search) { search.value=''; search.disabled=!selectedManufacturer; }
    setNativeField('model',''); setNativeField('model_number',''); setNativeField('color',''); setNativeField('storage_size','');
    const category=intake()?.newDevice?.category||'Other';
    await loadModels(id,category);
    renderModelResults('');
    renderVariantChoices(null);
  }

  function selectModel(id) {
    const model=models.find(item=>item.id===id);
    if (!model) return;
    selectedModel=model;
    const x=intake();
    if (x?.newDevice) {
      x.newDevice.catalog_model_id=model.id;
      delete x.newDevice.catalog_variant_id;
    }
    const manufacturer=model.device_catalog_manufacturers?.name||currentManufacturerName();
    if (manufacturer) setNativeField('manufacturer',manufacturer);
    setNativeField('model',model.name);
    if ((model.model_numbers||[]).length===1) setNativeField('model_number',model.model_numbers[0]);
    else setNativeField('model_number','');
    setNativeField('storage_size','');
    setNativeField('color','');
    const search=dialog()?.querySelector('[data-gc-model-search]');
    if (search) search.value=model.name;
    renderModelResults(model.name);
    renderVariantChoices(model);
    enrichModel(model).catch(error=>console.warn('Device image enrichment failed:',error));
  }

  async function enrichModel(model) {
    if (!model?.id || model.image_url || enrichmentAttempted.has(model.id)) return;
    enrichmentAttempted.add(model.id);
    const category=intake()?.newDevice?.category||model.category||'Other';
    const result=await client.functions.invoke('device-catalog-search',{body:{action:'enrich',model_id:model.id,category}});
    const saved=result.data?.model;
    if(result.error||!saved)return;
    const index=models.findIndex(item=>item.id===saved.id);
    if(index>=0)models[index]=saved;
    if(selectedModel?.id===saved.id){
      selectedModel=saved;
      const search=dialog()?.querySelector('[data-gc-model-search]');
      renderModelResults(search?.value||saved.name);
      renderVariantChoices(saved);
    }
  }

  function setDeviceOption(field,value) {
    setNativeField(field,value);
    renderVariantChoices(selectedModel);
  }

  async function searchGlobal() {
    const root=dialog();
    const status=root?.querySelector('[data-gc-global-status]');
    const query=String(root?.querySelector('[data-gc-model-search]')?.value||'').trim();
    const category=intake()?.newDevice?.category||'Other';
    const manufacturer=currentManufacturerName();
    const full=[manufacturer,query].filter(Boolean).join(' ').trim();
    if (full.length<2) {
      if(status)status.textContent='Enter a manufacturer or model to search.';
      return;
    }
    if(status)status.textContent='Searching global catalog…';
    const result=await client.functions.invoke('device-catalog-search',{body:{action:'search',query:full,category}});
    if(result.error){
      if(status)status.textContent='Global catalog is unavailable right now. Manual entry still works.';
      return;
    }
    const candidates=result.data?.candidates||[];
    const host=root?.querySelector('[data-gc-model-results]');
    if(!host)return;
    host.innerHTML=candidates.length?candidates.map(candidate=>{
      const image=candidate.image?.url
        ? `<img class="gc-model-thumb" src="${esc(candidate.image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="gc-model-thumb-fallback" aria-hidden="true">DEV</span>`;
      return `<button type="button" class="gc-model-card" data-gc-global-import="${esc(candidate.qid)}">${image}<span class="gc-model-copy"><strong>${esc(candidate.name)}</strong><small>${esc([candidate.manufacturer,candidate.release_year,candidate.description].filter(Boolean).join(' · '))}</small></span></button>`;
    }).join(''):`<div class="gc-catalog-empty">No reliable global match was returned. Switch to manual entry.</div>`;
    if(status)status.textContent=candidates.length?'Choose the matching device to add it to the GotCracked catalog.':'No global match found.';
  }

  async function importGlobal(qid) {
    const root=dialog();
    const status=root?.querySelector('[data-gc-global-status]');
    const category=intake()?.newDevice?.category||'Other';
    if(status)status.textContent='Adding device to GotCracked catalog…';
    const result=await client.functions.invoke('device-catalog-search',{body:{action:'import',qid,category}});
    if(result.error||!result.data?.model){
      if(status)status.textContent='Could not add that device. Manual entry still works.';
      return;
    }
    const model=result.data.model;
    await loadManufacturers();
    selectedManufacturer=(manufacturers||[]).find(item=>item.id===model.manufacturer_id) || {id:model.manufacturer_id,name:model.device_catalog_manufacturers?.name||'Unknown',categories:[category]};
    const select=root?.querySelector('[data-gc-manufacturer-select]');
    if(select){
      if(![...select.options].some(opt=>opt.value===selectedManufacturer.id)){
        select.insertAdjacentHTML('beforeend',`<option value="${esc(selectedManufacturer.id)}">${esc(selectedManufacturer.name)}</option>`);
      }
      select.value=selectedManufacturer.id;
    }
    await loadModels(selectedManufacturer.id,category);
    if(!models.some(item=>item.id===model.id))models.unshift(model);
    selectModel(model.id);
    if(status)status.textContent='Added to the GotCracked device catalog.';
  }

  function setManual(enabled) {
    const root=dialog();
    root?.querySelector('.v1-form-grid')?.classList.toggle('gc-catalog-manual',enabled);
    const button=root?.querySelector('[data-gc-manual-toggle]');
    if(button)button.textContent=enabled?'Use device catalog':'Device not listed? Manual entry';
    root?.querySelector('.gc-catalog-shell')?.classList.toggle('gc-catalog-manual',enabled);
  }

  function quickCondition(root) {
    const select=root.querySelector('[data-intake-device="device_condition"]');
    const labelEl=select?.closest('label');
    if(!select||!labelEl||labelEl.dataset.gcConditionUpgraded)return;
    labelEl.dataset.gcConditionUpgraded='true';
    labelEl.classList.add('gc-catalog-managed-field');
    const wrap=document.createElement('div');
    wrap.className='gc-variant-block';
    wrap.innerHTML=`<strong>Condition</strong><div class="gc-choice-chips">${['Bad','Fair','Good','Like New'].map(value=>`<button type="button" class="gc-choice-chip ${select.value===value?'selected':''}" data-gc-condition="${value}">${value}</button>`).join('')}</div>`;
    const form=labelEl.parentElement;
    form?.insertBefore(wrap,labelEl);
  }

  async function decorateDeviceStep() {
    const x=intake(),root=dialog();
    if(!x||x.step!==2||!root?.open)return;
    const form=root.querySelector('.v1-form-grid');
    const typeGrid=root.querySelector('.v1-device-types');
    if(!form||!typeGrid)return;

    await loadManufacturers();
    const key=`${x.newDevice?.category||'Other'}:${x.device?.id||'new'}:${x.newDevice?.manufacturer||''}`;
    if(!root.querySelector('.gc-catalog-shell')){
      const shell=document.createElement('section');
      shell.className='gc-catalog-shell';
      shell.innerHTML=`
        <div class="gc-catalog-head"><div><h4>Device catalog</h4><p>Choose the exact device first. Storage, color, and model number populate as available.</p></div><button class="secondary-button" type="button" data-gc-manual-toggle>Device not listed? Manual entry</button></div>
        <div class="gc-catalog-grid">
          <label>Manufacturer<select data-gc-manufacturer-select>${manufacturerOptions(x.newDevice?.category||'Other',x.newDevice?.manufacturer||'')}</select></label>
          <label>Model search<input type="search" data-gc-model-search placeholder="Search model" autocomplete="off" disabled></label>
        </div>
        <p class="gc-catalog-photo-credit">Catalog records are local to GotCracked. Global search uses Wikidata; reusable photos are pulled from Wikimedia Commons with license metadata.</p>
        <div class="gc-model-results" data-gc-model-results><div class="gc-catalog-empty">Choose a manufacturer to see models.</div></div>
        <div class="gc-variant-block" data-gc-variant-host></div>
        <div class="gc-catalog-head"><span data-gc-global-status class="gc-catalog-photo-credit"></span><button class="secondary-button" type="button" data-gc-global-search>Search global catalog</button></div>`;
      typeGrid.insertAdjacentElement('afterend',shell);
    }

    ['manufacturer','model','model_number','color','storage_size'].forEach(name=>root.querySelector(`[data-intake-device="${name}"]`)?.closest('label')?.classList.add('gc-catalog-managed-field'));
    quickCondition(root);

    const select=root.querySelector('[data-gc-manufacturer-select]');
    if(select){
      select.innerHTML=manufacturerOptions(x.newDevice?.category||'Other',x.newDevice?.manufacturer||'');
      if(selectedManufacturer?.id)select.value=selectedManufacturer.id;
      else{
        const current=(manufacturers||[]).find(item=>item.name===x.newDevice?.manufacturer);
        if(current){selectedManufacturer=current;select.value=current.id;}
      }
    }

    if(key!==lastDeviceStepKey){
      lastDeviceStepKey=key;
      selectedModel=null;
      if(selectedManufacturer?.id){
        await loadModels(selectedManufacturer.id,x.newDevice?.category||'Other');
        selectedModel=models.find(item=>item.name===x.newDevice?.model)||null;
        const search=root.querySelector('[data-gc-model-search]');
        if(search){search.disabled=false;search.value=x.newDevice?.model||'';}
        renderModelResults(x.newDevice?.model||'');
        renderVariantChoices(selectedModel);
      } else {
        models=[];
        renderModelResults('');
      }
    }
  }

  function checklistChoiceSet(select) {
    const [bucket,key]=select.dataset.intakeCheck.split(':');
    if(bucket==='functional')return [
      ['Pass','pass'],
      ['Issue','fail'],
      ['N/A','not_applicable']
    ];
    if(['liquid_signs','previous_repair'].includes(key))return [
      [key==='liquid_signs'?'Clear':'None seen','pass'],
      ['Observed','observed'],
      ['N/A','not_applicable']
    ];
    if(key==='missing_panels_screws')return [
      ['Complete','pass'],
      ['Missing','damaged'],
      ['N/A','not_applicable']
    ];
    return [
      ['Good','pass'],
      ['Issue','damaged'],
      ['N/A','not_applicable']
    ];
  }

  function syncChecklistRow(row,select) {
    const value=select.value||'not_tested';
    row.classList.toggle('gc-assessed',value!=='not_tested');
    row.querySelectorAll('[data-gc-check-state]').forEach(button=>{
      button.classList.toggle('selected',button.dataset.gcCheckState===value);
    });
  }

  function updateInspectionProgress() {
    const root=dialog();
    if(!root)return;
    const selects=[...root.querySelectorAll('[data-intake-check]')];
    if(!selects.length)return;
    const assessed=selects.filter(select=>select.value&&select.value!=='not_tested').length;
    let progress=root.querySelector('.gc-inspection-progress');
    if(!progress){
      progress=document.createElement('div');
      progress.className='gc-inspection-progress';
      progress.innerHTML='<header><span>Inspection coverage</span><strong></strong></header><div class="gc-inspection-track"><i></i></div>';
      const checklist=root.querySelector('.v1-checklist');
      checklist?.insertAdjacentElement('beforebegin',progress);
    }
    const strong=progress.querySelector('strong');
    const bar=progress.querySelector('i');
    if(strong)strong.textContent=`${assessed}/${selects.length} assessed · ${selects.length-assessed} not checked`;
    if(bar)bar.style.width=`${Math.round(assessed/selects.length*100)}%`;

    const legacy=root.querySelector('.v1-check-progress');
    if(legacy)legacy.style.display='none';
  }

  function decorateInspection() {
    const x=intake(),root=dialog();
    if(!x||x.step!==3||!root?.open)return;
    root.querySelectorAll('.v1-check-group').forEach(group=>{
      group.querySelectorAll('.v1-check-row').forEach(row=>{
        const select=row.querySelector('[data-intake-check]');
        if(!select||row.classList.contains('gc-check-upgraded'))return;
        row.classList.add('gc-check-upgraded');
        const controls=document.createElement('div');
        controls.className='gc-check-controls';
        controls.innerHTML=checklistChoiceSet(select).map(([text,value])=>`<button type="button" class="gc-check-control" data-gc-check-state="${value}" data-state="${value}">${text}</button>`).join('');
        row.appendChild(controls);
        syncChecklistRow(row,select);
      });
      if(!group.querySelector('.gc-check-group-tools')){
        const tools=document.createElement('div');
        tools.className='gc-check-group-tools';
        tools.innerHTML='<button type="button" class="secondary-button" data-gc-check-all-good>All normal</button><button type="button" class="text-button" data-gc-check-clear>Clear</button>';
        group.querySelector('h4')?.insertAdjacentElement('afterend',tools);
      }
    });
    updateInspectionProgress();
  }

  function decoratePaymentDialog() {
    const pay=document.getElementById('gc-prepay-dialog');
    if(!pay?.open||pay.dataset.gcIntakeV2)return;
    pay.dataset.gcIntakeV2='true';
    const amountLabel=pay.querySelector('.gc-payment-amount label');
    if(amountLabel?.firstChild)amountLabel.firstChild.textContent='Pre-payment / deposit amount';
    const subtitle=pay.querySelector('.gc-payment-head p');
    if(subtitle)subtitle.textContent='Enter the amount actually being collected now. The work order is created only after that payment is verified.';
  }

  function patchDeviceCatalogPersistence() {
    if (client.__gcDeviceCatalogPersistencePatched || typeof client.from !== 'function') return;
    const nativeFrom=client.from.bind(client);
    client.from=function catalogAwareFrom(table){
      const builder=nativeFrom(table);
      if(table!=='devices'||!builder)return builder;
      const additions=()=>{
        const d=intake()?.newDevice||{};
        const extra={};
        if(d.catalog_model_id)extra.catalog_model_id=d.catalog_model_id;
        if(d.catalog_variant_id)extra.catalog_variant_id=d.catalog_variant_id;
        return extra;
      };
      const merge=value=>Array.isArray(value)?value.map(row=>({...row,...additions()})):{...(value||{}),...additions()};
      if(typeof builder.insert==='function'){
        const nativeInsert=builder.insert.bind(builder);
        builder.insert=(values,options)=>nativeInsert(merge(values),options);
      }
      if(typeof builder.update==='function'){
        const nativeUpdate=builder.update.bind(builder);
        builder.update=(values,options)=>nativeUpdate(merge(values),options);
      }
      return builder;
    };
    client.__gcDeviceCatalogPersistencePatched=true;
  }

  function normalizeCreateActivation(event) {
    const target=event.target instanceof Element?event.target:null;
    const button=target?.closest('[data-v1-intake-create]');
    if(!button||localStorage.getItem('gc-training-store')==='1')return;
    if(event.type==='pointerdown'){
      event.preventDefault();
      event.stopImmediatePropagation();
      button.dataset.gcNormalizedCreateAt=String(performance.now());
      queueMicrotask(()=>button.click());
      return;
    }
    if(event.type==='click'&&event.isTrusted){
      const at=Number(button.dataset.gcNormalizedCreateAt||0);
      if(at&&performance.now()-at<900){
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
  }

  function scheduleDecorate(){
    if(decorateFrame)return;
    decorateFrame=requestAnimationFrame(()=>{
      decorateFrame=0;
      decorateDeviceStep().catch(error=>console.warn('Device catalog decoration failed:',error));
      decorateInspection();
      decoratePaymentDialog();
    });
  }

  patchDeviceCatalogPersistence();

  window.addEventListener('pointerdown',normalizeCreateActivation,true);
  window.addEventListener('click',normalizeCreateActivation,true);

  document.addEventListener('change',event=>{
    const target=event.target;
    if(target?.matches?.('[data-gc-manufacturer-select]')){
      selectManufacturer(target.value).catch(error=>console.warn(error));
      return;
    }
  });

  document.addEventListener('input',event=>{
    const target=event.target;
    if(target?.matches?.('[data-gc-model-search]')){
      clearTimeout(modelSearchTimer);
      modelSearchTimer=setTimeout(()=>renderModelResults(target.value),80);
    }
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    const modelButton=target.closest('[data-gc-catalog-model]');
    if(modelButton){event.preventDefault();selectModel(modelButton.dataset.gcCatalogModel);return;}
    const option=target.closest('[data-gc-device-value]');
    if(option){event.preventDefault();setDeviceOption(option.dataset.gcDeviceValue,option.dataset.gcDeviceOption);return;}
    const condition=target.closest('[data-gc-condition]');
    if(condition){
      event.preventDefault();
      const select=dialog()?.querySelector('[data-intake-device="device_condition"]');
      if(select){select.value=condition.dataset.gcCondition;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
      target.parentElement?.querySelectorAll('[data-gc-condition]').forEach(button=>button.classList.toggle('selected',button===target));
      return;
    }
    if(target.closest('[data-gc-manual-toggle]')){event.preventDefault();const form=dialog()?.querySelector('.v1-form-grid');setManual(!form?.classList.contains('gc-catalog-manual'));return;}
    if(target.closest('[data-gc-global-search]')){event.preventDefault();searchGlobal().catch(error=>console.warn(error));return;}
    const globalImport=target.closest('[data-gc-global-import]');
    if(globalImport){event.preventDefault();importGlobal(globalImport.dataset.gcGlobalImport).catch(error=>console.warn(error));return;}
    const check=target.closest('[data-gc-check-state]');
    if(check){
      event.preventDefault();
      const row=check.closest('.v1-check-row');
      const select=row?.querySelector('[data-intake-check]');
      if(select){select.value=check.dataset.gcCheckState;select.dispatchEvent(new Event('change',{bubbles:true}));syncChecklistRow(row,select);updateInspectionProgress();}
      return;
    }
    const allGood=target.closest('[data-gc-check-all-good]');
    if(allGood){
      event.preventDefault();
      allGood.closest('.v1-check-group')?.querySelectorAll('[data-intake-check]').forEach(select=>{
        if(select.value==='not_tested'||!select.value){select.value='pass';select.dispatchEvent(new Event('change',{bubbles:true}));syncChecklistRow(select.closest('.v1-check-row'),select);}
      });
      updateInspectionProgress();return;
    }
    const clear=target.closest('[data-gc-check-clear]');
    if(clear){
      event.preventDefault();
      clear.closest('.v1-check-group')?.querySelectorAll('[data-intake-check]').forEach(select=>{select.value='not_tested';select.dispatchEvent(new Event('change',{bubbles:true}));syncChecklistRow(select.closest('.v1-check-row'),select);});
      updateInspectionProgress();
    }
  });

  const observer=new MutationObserver(scheduleDecorate);
  const start=()=>{
    injectStyle();
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class']});
    scheduleDecorate();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  document.addEventListener('gc-portal-runtime-ready',scheduleDecorate);
  window.addEventListener('pageshow',scheduleDecorate);

  window.GotCrackedIntakeExperienceV2={
    version:VERSION,
    refresh:scheduleDecorate,
    get selectedModel(){return selectedModel;}
  };
})();