(() => {
  'use strict';
  if (window.GotCrackedDirectoryAdvanced) return;

  const client = window.supabaseClient;
  const SCOPES = ['dashboard','leads'];
  const sessionKey = scope => `gc-directory-${scope}`;
  const persistentKey = scope => `gc-directory-persistent-${scope}`;
  const savedKey = scope => `gc-directory-saved-filters-${scope}`;
  const updateMap = new Map();
  let updateLoaded = false;
  let decorateTimer = null;
  let decorating = false;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);

  function loadStyle(){
    if (document.querySelector('link[data-gc-directory-advanced]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='directory-advanced.css?v=20260827-dir4';
    link.dataset.gcDirectoryAdvanced='true';
    document.head.appendChild(link);
  }

  function bootstrapPersistence(){
    for (const scope of SCOPES) {
      try {
        if (!sessionStorage.getItem(sessionKey(scope))) {
          const raw=localStorage.getItem(persistentKey(scope));
          if (raw) sessionStorage.setItem(sessionKey(scope),raw);
        }
      } catch {}
    }
  }

  function readState(scope){
    try { return JSON.parse(sessionStorage.getItem(sessionKey(scope)) || '{}') || {}; }
    catch { return {}; }
  }

  function writeState(scope,next,{reload=false}={}){
    try {
      const raw=JSON.stringify(next || {});
      sessionStorage.setItem(sessionKey(scope),raw);
      localStorage.setItem(persistentKey(scope),raw);
      if (reload) location.reload();
    } catch {}
  }

  function syncPersistent(scope){
    try {
      const raw=sessionStorage.getItem(sessionKey(scope));
      if (raw) localStorage.setItem(persistentKey(scope),raw);
    } catch {}
  }

  function savedFilters(scope){
    try {
      const value=JSON.parse(localStorage.getItem(savedKey(scope)) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function storeSaved(scope,items){
    try { localStorage.setItem(savedKey(scope),JSON.stringify(items)); } catch {}
  }

  function scopeHost(scope){
    return scope==='dashboard' ? document.querySelector('#gc-master-directory') : document.querySelector('#leads #portal-leads');
  }

  function scopeFromNode(node){
    if (!(node instanceof Element)) return null;
    if (node.closest('#gc-master-directory')) return 'dashboard';
    if (node.closest('#leads #portal-leads')) return 'leads';
    return null;
  }

  async function loadLastUpdates(){
    if (!client || updateLoaded) return;
    try {
      const {data,error}=await client.rpc('get_directory_last_updates');
      if (error) throw error;
      updateMap.clear();
      (Array.isArray(data) ? data : []).forEach(item=>{
        if (item?.type && item?.id) updateMap.set(`${item.type}:${item.id}`,item.last_updated || null);
      });
      updateLoaded=true;
      scheduleDecorate();
    } catch (error) {
      console.warn('Directory last-update index unavailable:',error?.message || error);
    }
  }

  function formatUpdated(value){
    if (!value) return '—';
    const date=new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
  }

  function dayStart(value){
    if (!value) return null;
    const date=new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function dayEnd(value){
    if (!value) return null;
    const date=new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function updatedMsForRow(row){
    const raw=updateMap.get(row.dataset.gcRecord);
    const time=new Date(raw || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function windowStart(value){
    const now=Date.now();
    if(value==='24h') return now-86400000;
    if(value==='7d') return now-(7*86400000);
    if(value==='30d') return now-(30*86400000);
    if(value==='today') { const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }
    return null;
  }

  function bucketFor(time){
    if (!time) return ['unknown','No update timestamp'];
    const now=new Date();
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
    const oneDay=86400000;
    if (time>=today) return ['today','Updated today'];
    if (time>=today-oneDay) return ['yesterday','Updated yesterday'];
    if (time>=today-(7*oneDay)) return ['week','Updated in last 7 days'];
    if (time>=today-(30*oneDay)) return ['month','Updated 8–30 days ago'];
    return ['older','Updated more than 30 days ago'];
  }

  function unwrapGroups(results){
    results.querySelectorAll(':scope > .gc-dir-update-group').forEach(group=>{
      const frag=document.createDocumentFragment();
      group.querySelectorAll(':scope > .gc-dir-row').forEach(row=>frag.appendChild(row));
      group.replaceWith(frag);
    });
  }

  function applyAdvanced(scope){
    const host=scopeHost(scope);
    const results=host?.querySelector('[data-gc-results]');
    if (!host || !results) return;
    const state=readState(scope);
    const relativeFrom=windowStart(state.updatedWindow||'');
    const from=relativeFrom ?? dayStart(state.updatedFrom);
    const to=state.updatedWindow && state.updatedWindow!=='custom' ? null : dayEnd(state.updatedTo);

    unwrapGroups(results);
    const columns=results.querySelector(':scope > .gc-dir-columns');
    let rows=[...results.querySelectorAll(':scope > .gc-dir-row')];
    for (const row of rows) {
      const raw=updateMap.get(row.dataset.gcRecord);
      const time=updatedMsForRow(row);
      const small=row.querySelector('.gc-dir-time small');
      if (small && raw) small.textContent=`Updated ${formatUpdated(raw)}`;
      const hidden=(from!=null && time<from) || (to!=null && time>to);
      row.dataset.gcAdvancedHidden=hidden?'true':'false';
    }

    if (state.sort==='updated_desc' || state.sort==='updated_asc') {
      const direction=state.sort==='updated_asc' ? 1 : -1;
      rows.sort((a,b)=>(updatedMsForRow(a)-updatedMsForRow(b))*direction);
      rows.forEach(row=>results.appendChild(row));
    }

    rows=[...results.querySelectorAll(':scope > .gc-dir-row')];
    const visible=rows.filter(row=>row.dataset.gcAdvancedHidden!=='true');
    const summary=host.querySelector('[data-gc-summary]');
    if ((state.updatedWindow || state.updatedFrom || state.updatedTo) && summary) {
      const work=visible.filter(row=>row.dataset.gcRecord?.startsWith('work_order:')).length;
      const leads=visible.filter(row=>row.dataset.gcRecord?.startsWith('lead:')).length;
      summary.innerHTML=`<strong>${visible.length}</strong> records shown after last-updated filter${scope==='dashboard'?` · ${work} work order${work===1?'':'s'} · ${leads} lead${leads===1?'':'s'}`:''}`;
    }

    if (state.groupBy!=='updated') return;
    const order=['today','yesterday','week','month','older','unknown'];
    const groups=new Map(order.map(key=>[key,[]]));
    const labels=new Map();
    for (const row of visible) {
      const [key,label]=bucketFor(updatedMsForRow(row));
      groups.get(key)?.push(row);
      labels.set(key,label);
    }
    for (const key of order) {
      const members=groups.get(key) || [];
      if (!members.length) continue;
      const group=document.createElement('section');
      group.className='gc-dir-update-group';
      group.dataset.gcUpdateGroup=key;
      group.innerHTML=`<div class="gc-dir-update-group-head"><strong>${esc(labels.get(key) || key)}</strong><span>${members.length} record${members.length===1?'':'s'}</span></div>`;
      members.forEach(row=>group.appendChild(row));
      results.appendChild(group);
    }
    const hidden=rows.filter(row=>row.dataset.gcAdvancedHidden==='true');
    if(hidden.length){
      const group=document.createElement('section');
      group.className='gc-dir-update-group gc-dir-update-hidden';
      hidden.forEach(row=>group.appendChild(row));
      results.appendChild(group);
    }
    if(columns) results.insertAdjacentElement('afterbegin',columns);
  }

  function savedSelectMarkup(scope){
    const items=savedFilters(scope);
    return `<select data-gc-saved-filter aria-label="Saved filters"><option value="">Saved filters…</option>${items.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select>`;
  }

  function injectControls(scope){
    const host=scopeHost(scope);
    if (!host) return;
    const state=readState(scope);
    let utility=host.querySelector('.gc-dir-utility-row');
    if (!utility) {
      utility=document.createElement('div');
      utility.className='gc-dir-utility-row';
      const anchor=host.querySelector('.gc-dir-presets') || host.querySelector('.gc-dir-search-row');
      if (anchor) anchor.insertAdjacentElement('afterend',utility); else host.querySelector('.gc-dir-head')?.insertAdjacentElement('afterend',utility);
    }
    if (utility && !utility.querySelector('.gc-dir-saved-controls')) {
      const controls=document.createElement('div');
      controls.className='gc-dir-saved-controls';
      controls.innerHTML=`${savedSelectMarkup(scope)}<button type="button" class="secondary-button" data-gc-save-filter>Save filter</button><button type="button" class="text-button" data-gc-delete-filter disabled>Delete</button>`;
      utility.appendChild(controls);
    }
    const panel=host.querySelector('.gc-dir-filter-panel');
    if (panel && !panel.querySelector('.gc-dir-advanced-row')) {
      const row=document.createElement('div');
      row.className='gc-dir-advanced-row';
      row.innerHTML=`<label>Last updated<select data-gc-advanced="updatedWindow"><option value="" ${!state.updatedWindow?'selected':''}>Any time</option><option value="today" ${state.updatedWindow==='today'?'selected':''}>Today</option><option value="24h" ${state.updatedWindow==='24h'?'selected':''}>Last 24 hours</option><option value="7d" ${state.updatedWindow==='7d'?'selected':''}>Last 7 days</option><option value="30d" ${state.updatedWindow==='30d'?'selected':''}>Last 30 days</option><option value="custom" ${state.updatedWindow==='custom'?'selected':''}>Custom range</option></select></label><label>Updated after<input type="date" data-gc-advanced="updatedFrom" value="${esc(state.updatedFrom || '')}"></label><label>Updated before<input type="date" data-gc-advanced="updatedTo" value="${esc(state.updatedTo || '')}"></label><label>Group results by<select data-gc-advanced="groupBy"><option value="none" ${state.groupBy!=='updated'?'selected':''}>No grouping</option><option value="updated" ${state.groupBy==='updated'?'selected':''}>Last updated</option></select></label>`;
      const clear=panel.querySelector('[data-gc-action="clear"]');
      if (clear) clear.insertAdjacentElement('beforebegin',row); else panel.appendChild(row);
    }
  }

  function refreshSavedControl(scope){
    const host=scopeHost(scope);
    const old=host?.querySelector('[data-gc-saved-filter]');
    if (!old) return;
    const value=old.value;
    old.outerHTML=savedSelectMarkup(scope);
    const next=host.querySelector('[data-gc-saved-filter]');
    if (next && savedFilters(scope).some(item=>item.id===value)) next.value=value;
    const del=host.querySelector('[data-gc-delete-filter]');
    if (del) del.disabled=!next?.value;
  }

  function decorate(){
    if (decorating) return;
    decorating=true;
    try {
      for (const scope of SCOPES) {
        injectControls(scope);
        applyAdvanced(scope);
      }
    } finally { decorating=false; }
  }

  function scheduleDecorate(){
    clearTimeout(decorateTimer);
    decorateTimer=setTimeout(decorate,35);
  }

  function saveCurrentFilter(scope){
    const state=readState(scope);
    const suggested=scope==='dashboard'?'My work-order filter':'My lead filter';
    const name=prompt('Name this saved filter:',suggested)?.trim();
    if (!name) return;
    const items=savedFilters(scope);
    const existing=items.find(item=>item.name.toLowerCase()===name.toLowerCase());
    const entry={id:existing?.id || (crypto.randomUUID?.() || String(Date.now())),name,state,updatedAt:new Date().toISOString()};
    const next=existing ? items.map(item=>item.id===existing.id?entry:item) : [...items,entry];
    storeSaved(scope,next);
    refreshSavedControl(scope);
  }

  function applySavedFilter(scope,id){
    const item=savedFilters(scope).find(row=>row.id===id);
    if (!item) return;
    writeState(scope,item.state || {},{reload:true});
  }

  function deleteSavedFilter(scope,id){
    if (!id) return;
    const item=savedFilters(scope).find(row=>row.id===id);
    if (!item) return;
    if (!confirm(`Delete saved filter “${item.name}”?`)) return;
    storeSaved(scope,savedFilters(scope).filter(row=>row.id!==id));
    refreshSavedControl(scope);
  }

  loadStyle();
  bootstrapPersistence();

  document.addEventListener('input',event=>{
    const scope=scopeFromNode(event.target);
    if (scope) setTimeout(()=>{syncPersistent(scope);scheduleDecorate();},0);
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    const scope=scopeFromNode(target);
    if (!scope) return;
    if (target.matches('[data-gc-advanced]')) {
      const state=readState(scope);
      state[target.dataset.gcAdvanced]=target.value;
      if(['updatedFrom','updatedTo'].includes(target.dataset.gcAdvanced)&&target.value) state.updatedWindow='custom';
      state.preset='custom';
      writeState(scope,state);
      injectControls(scope);
      applyAdvanced(scope);
      return;
    }
    if (target.matches('[data-gc-saved-filter]')) {
      const del=scopeHost(scope)?.querySelector('[data-gc-delete-filter]');
      if (del) del.disabled=!target.value;
      if (target.value) applySavedFilter(scope,target.value);
      return;
    }
    setTimeout(()=>{syncPersistent(scope);scheduleDecorate();},0);
  });
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element ? event.target : null;
    const scope=scopeFromNode(target);
    if (!scope) return;
    if (target.closest('[data-gc-save-filter]')) { event.preventDefault(); saveCurrentFilter(scope); return; }
    if (target.closest('[data-gc-delete-filter]')) {
      event.preventDefault();
      deleteSavedFilter(scope,scopeHost(scope)?.querySelector('[data-gc-saved-filter]')?.value || '');
      return;
    }
    setTimeout(()=>{syncPersistent(scope);scheduleDecorate();},0);
  });

  document.addEventListener('gc-directory-rendered',event=>{
    const scope=event.detail?.scope;
    if (SCOPES.includes(scope)) scheduleDecorate();
  });

  document.addEventListener('gc-cross-user-sync',()=>{updateLoaded=false;loadLastUpdates();});
  document.addEventListener('gc-portal-runtime-ready',()=>{updateLoaded=false;loadLastUpdates();scheduleDecorate();});
  setInterval(()=>{if(document.visibilityState==='visible'){updateLoaded=false;loadLastUpdates();}},30000);
  setTimeout(()=>{loadLastUpdates();scheduleDecorate();},1200);

  window.GotCrackedDirectoryAdvanced={refresh(){updateLoaded=false;return loadLastUpdates();},render:scheduleDecorate};
})();
