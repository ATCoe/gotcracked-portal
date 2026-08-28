(()=>{
  'use strict';
  if(window.GotCrackedMobileSentrix)return;
  const client=window.supabaseClient;if(!client)return;
  const ACCOUNT_URL='https://www.mobilesentrix.com/customer/account/';
  const state={status:null,account:null,canManage:false,busy:false};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const when=v=>v?new Date(v).toLocaleString():'Never';
  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;

  function style(){
    if(document.getElementById('gc-ms-style'))return;
    const s=document.createElement('style');s.id='gc-ms-style';s.textContent=`
      .gc-ms-card{margin-top:18px}.gc-ms-status{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:14px 0}.gc-ms-stat{border:1px solid var(--line,#dce5ec);border-radius:12px;padding:11px}.gc-ms-stat small,.gc-ms-stat strong{display:block}.gc-ms-stat small{opacity:.66;margin-bottom:3px}.gc-ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-ms-grid label{display:grid;gap:5px}.gc-ms-grid input,.gc-ms-grid select{width:100%}.gc-ms-auth{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gc-ms-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:12px}.gc-ms-account,.gc-ms-csv{border-top:1px solid var(--line,#dce5ec);margin-top:18px;padding-top:15px}.gc-ms-note{font-size:12px;opacity:.7}.gc-ms-statusline{min-height:20px;margin:10px 0 0}.gc-ms-danger{color:#b54444}.gc-ms-good{color:#16835f}@media(max-width:900px){.gc-ms-status{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.gc-ms-grid,.gc-ms-auth{grid-template-columns:1fr 1fr}}@media(max-width:520px){.gc-ms-status,.gc-ms-grid,.gc-ms-auth{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  async function invoke(action,body={}){
    const result=await client.functions.invoke('mobilesentrix-sync',{body:{action,...body}});
    if(result.error)throw new Error(result.data?.error||result.error.message||'MobileSentrix request failed.');
    if(result.data?.ok===false)throw new Error(result.data?.error||'MobileSentrix request failed.');
    return result.data;
  }

  async function permission(){
    const p=profile();if(!p)return false;
    const [a,b]=await Promise.all([client.rpc('has_permission',{permission_key:'inventory.manage'}),client.rpc('has_permission',{permission_key:'settings.manage'})]);
    state.canManage=p.role==='owner'||a.data===true||b.data===true;return state.canManage;
  }
  async function load(){
    if(!await permission())return;
    const p=profile();
    const [data,account]=await Promise.all([
      invoke('status'),
      client.from('supplier_account_links').select('account_label,account_email,account_number,portal_url,linked_at,updated_at').eq('location_id',p.location_id).eq('supplier_key','mobilesentrix').maybeSingle()
    ]);
    state.status=data.status;
    state.account=account.error?null:account.data;
    render();
  }

  function authFields(config){
    const scheme=config.auth_scheme||'bearer';
    if(scheme==='basic')return`<div class="gc-ms-auth"><label>API username<input name="username" autocomplete="username" placeholder="MobileSentrix API username"></label><label>API password<input name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep saved password"></label></div>`;
    return`<label>${scheme==='api_key'?'API key':'Access token'}<input name="token" type="password" autocomplete="off" placeholder="Leave blank to keep saved credential"></label>${scheme==='api_key'?`<label>API key header<input name="header_name" value="${esc(config.header_name||'X-API-Key')}"></label>`:''}`;
  }

  function accountMarkup(){
    const a=state.account||{};
    return `<div class="gc-ms-account"><h3>MobileSentrix account</h3><p class="subtle">Link the store account identity here so the Portal always shows which MobileSentrix account is being used. API credentials remain encrypted and separate.</p><form id="gc-ms-account-form" class="settings-list"><div class="gc-ms-grid"><label>Account / business name<input name="account_label" maxlength="160" value="${esc(a.account_label||'') }" placeholder="GotCracked"></label><label>Account email<input name="account_email" type="email" maxlength="320" value="${esc(a.account_email||'')}" placeholder="orders@gotcracked.co"></label><label>Customer / account number (optional)<input name="account_number" maxlength="160" value="${esc(a.account_number||'')}"></label></div><div class="gc-ms-actions"><a class="secondary-button" href="${ACCOUNT_URL}" target="_blank" rel="noopener">${a.account_email||a.account_number?'Open MobileSentrix account':'Create / sign in to MobileSentrix'}</a><button class="primary-button" type="submit">Save account link</button></div><p class="auth-message gc-ms-statusline" role="status"></p></form></div>`;
  }
  function render(){
    const host=document.getElementById('settings');if(!host||!state.canManage)return;
    style();document.getElementById('gc-mobilesentrix-settings')?.remove();
    const st=state.status||{},cfg=st.config||{},ready=Boolean(st.hasCredentials),acct=state.account||{};
    const accountName=acct.account_label||acct.account_email||acct.account_number||'Not linked';
    host.insertAdjacentHTML('beforeend',`<section id="gc-mobilesentrix-settings"><article class="card gc-ms-card">
      <div class="card-title"><div><p class="eyebrow">Supplier integration</p><h2>MobileSentrix inventory sync</h2><p>Keep the Parts Registry current with MobileSentrix SKUs, supplier availability and cost. GotCracked on-hand inventory remains separate until a registry part is stocked or received.</p></div></div>
      <div class="gc-ms-status"><div class="gc-ms-stat"><small>API connection</small><strong class="${ready?'gc-ms-good':''}">${ready?'Credential saved':'Setup needed'}</strong></div><div class="gc-ms-stat"><small>Account used</small><strong class="${state.account?'gc-ms-good':''}">${esc(accountName)}</strong></div><div class="gc-ms-stat"><small>Last status</small><strong>${esc(st.lastStatus||'not configured')}</strong></div><div class="gc-ms-stat"><small>Last successful sync</small><strong>${esc(when(st.lastSuccessAt))}</strong></div><div class="gc-ms-stat"><small>Last run</small><strong>${Number(st.itemsSeen||0).toLocaleString()} items</strong></div></div>
      ${st.lastError?`<p class="gc-ms-danger"><strong>Last error:</strong> ${esc(st.lastError)}</p>`:''}
      ${accountMarkup()}
      <div class="gc-ms-account"><h3>Catalog API</h3><p class="subtle">After MobileSentrix issues API access for the store account, save the credential below and test the connection.</p><form id="gc-ms-api-form" class="settings-list"><div class="gc-ms-grid"><label>API base URL<input name="api_base_url" type="url" required value="${esc(cfg.api_base_url||'https://www.mobilesentrix.com')}"></label><label>Catalog API path<input name="catalog_path" required value="${esc(cfg.catalog_path||'/rest/V1/products')}"><small>Adjust this only if MobileSentrix provides a different endpoint.</small></label><label>Authentication<select name="auth_scheme"><option value="bearer" ${(cfg.auth_scheme||'bearer')==='bearer'?'selected':''}>Bearer access token</option><option value="api_key" ${cfg.auth_scheme==='api_key'?'selected':''}>API key header</option><option value="basic" ${cfg.auth_scheme==='basic'?'selected':''}>Username + password</option></select></label><label>Page size<input name="page_size" type="number" min="10" max="250" value="${Number(cfg.page_size||100)}"></label></div><div data-ms-auth-fields>${authFields(cfg)}</div><p class="gc-ms-note">Credentials are encrypted server-side in Supabase Vault. Portal never reads a saved credential back.</p><div class="gc-ms-actions"><button class="primary-button" type="submit">Save & test API</button><button class="secondary-button" type="button" data-ms-sync ${ready?'':'disabled'}>Sync now</button><button class="secondary-button" type="button" data-ms-refresh>Refresh status</button></div><p class="auth-message gc-ms-statusline" role="status"></p></form></div>
      <div class="gc-ms-csv"><h3>CSV fallback</h3><p class="subtle">If account API access has not been issued yet, export the MobileSentrix supplier/device catalog as CSV and import it here. This populates the same registry and can be replaced by live API sync later.</p><form id="gc-ms-csv-form"><label>MobileSentrix CSV<input name="csv" type="file" accept=".csv,text/csv" required></label><div class="gc-ms-actions"><button class="secondary-button" type="submit">Import supplier CSV</button></div><p class="auth-message gc-ms-statusline" role="status"></p></form></div>
    </article></section>`);
  }
  async function saveAccount(form){
    const output=form.querySelector('.auth-message'),fd=new FormData(form),p=profile();
    const email=String(fd.get('account_email')||'').trim(),label=String(fd.get('account_label')||'').trim(),number=String(fd.get('account_number')||'').trim();
    if(!email&&!label&&!number){output.textContent='Enter at least the account email, business name, or account number.';return;}
    output.textContent='Saving MobileSentrix account link…';
    const row={location_id:p.location_id,supplier_key:'mobilesentrix',account_label:label||null,account_email:email||null,account_number:number||null,portal_url:ACCOUNT_URL,linked_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const result=await client.from('supplier_account_links').upsert(row,{onConflict:'location_id,supplier_key'}).select().single();
    if(result.error)throw result.error;
    state.account=result.data;render();
    const status=document.querySelector('#gc-ms-account-form .auth-message');if(status)status.textContent='MobileSentrix account link saved.';
  }

  async function configure(form){
    const output=form.querySelector('.auth-message'),fd=new FormData(form);output.textContent='Saving encrypted MobileSentrix configuration…';
    await invoke('configure',{api_base_url:fd.get('api_base_url'),catalog_path:fd.get('catalog_path'),auth_scheme:fd.get('auth_scheme'),header_name:fd.get('header_name'),page_size:Number(fd.get('page_size')||100),token:fd.get('token'),username:fd.get('username'),password:fd.get('password')});
    output.textContent='Configuration saved. Testing the supplier connection…';
    try{const test=await invoke('test');output.textContent=`Connected. API returned ${Number(test.itemsReturned||0).toLocaleString()} item(s)${test.totalCount!=null?` of ${Number(test.totalCount).toLocaleString()}`:''}.`;await load();}
    catch(error){output.textContent=`Saved, but the API test failed: ${error.message}`;await load();}
  }

  async function sync(button){
    if(state.busy)return;state.busy=true;button.disabled=true;const output=document.querySelector('#gc-ms-api-form .auth-message');
    try{let cycles=0,total=0,newParts=0,changed=0,more=true;while(more&&cycles<12){cycles++;if(output)output.textContent=`Syncing MobileSentrix catalog… batch ${cycles}`;const data=await invoke('sync',{max_pages:8});total+=Number(data.itemsSeen||0);newParts+=Number(data.newPartsFound||0);changed+=Number(data.changedListings||0);more=data.hasMore===true;}if(output)output.textContent=more?`Synced ${total.toLocaleString()} items. More catalog pages remain; run Sync now again to continue.`:`MobileSentrix sync complete: ${total.toLocaleString()} items, ${newParts.toLocaleString()} new registry parts, ${changed.toLocaleString()} changed listings.`;await load();await window.GotCrackedPartsRegistry?.load?.();}
    catch(error){if(output)output.textContent=error.message||'MobileSentrix sync failed.';await load();}
    finally{state.busy=false;button.disabled=false;}
  }
  async function importCsv(form){
    const output=form.querySelector('.auth-message'),file=form.elements.csv.files?.[0];if(!file)return;
    output.textContent='Reading supplier CSV…';const csv=await file.text();output.textContent='Importing MobileSentrix catalog…';
    const data=await invoke('import_csv',{csv});
    output.textContent=`Imported ${Number(data.itemsSeen||0).toLocaleString()} items; ${Number(data.newPartsFound||0).toLocaleString()} new registry parts.`;
    form.reset();await load();await window.GotCrackedPartsRegistry?.load?.();
  }

  document.addEventListener('change',event=>{
    if(event.target?.name!=='auth_scheme'||event.target.closest('#gc-ms-api-form')==null)return;
    const form=event.target.closest('form'),host=form.querySelector('[data-ms-auth-fields]');
    const config={...(state.status?.config||{}),auth_scheme:event.target.value};host.innerHTML=authFields(config);
  });

  document.addEventListener('submit',event=>{
    if(event.target?.id==='gc-ms-account-form'){event.preventDefault();void saveAccount(event.target).catch(error=>{event.target.querySelector('.auth-message').textContent=error.message||'Unable to save MobileSentrix account link.';});}
    else if(event.target?.id==='gc-ms-api-form'){event.preventDefault();void configure(event.target).catch(error=>{event.target.querySelector('.auth-message').textContent=error.message||'Unable to configure MobileSentrix.';});}
    else if(event.target?.id==='gc-ms-csv-form'){event.preventDefault();void importCsv(event.target).catch(error=>{event.target.querySelector('.auth-message').textContent=error.message||'Unable to import CSV.';});}
  });

  document.addEventListener('click',event=>{
    const t=event.target instanceof Element?event.target:null;if(!t)return;
    const syncButton=t.closest('[data-ms-sync]');if(syncButton)return void sync(syncButton);
    if(t.closest('[data-ms-refresh]'))return void load();
  });
  const maybeLoad=()=>{if(location.hash.startsWith('#settings'))setTimeout(()=>void load().catch(error=>console.warn('MobileSentrix settings failed to load',error)),120);};
  document.addEventListener('gc-view-changed',maybeLoad);
  window.addEventListener('hashchange',maybeLoad);
  window.addEventListener('gotcracked:staff-ready',maybeLoad);
  const observer=new MutationObserver(()=>{if(location.hash.startsWith('#settings')&&!document.getElementById('gc-mobilesentrix-settings')&&state.canManage)render();});
  observer.observe(document.body,{childList:true,subtree:true});
  maybeLoad();
  window.GotCrackedMobileSentrix={version:'1.1.0',state,load,sync};
})();