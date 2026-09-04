(()=>{
  'use strict';
  if(window.GotCrackedMobileSentrix)return;
  const client=window.supabaseClient;
  if(!client)return;

  const ACCOUNT_URL='https://www.mobilesentrix.com/customer/account/';
  const API_CONSUMER_URL='https://www.mobilesentrix.com/api-consumer';
  const state={status:null,account:null,canManage:false,busy:false};

  const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
  const when=value=>value?new Date(value).toLocaleString():'Never';
  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const selected=(value,expected)=>value===expected?'selected':'';

  function style(){
    if(document.getElementById('gc-ms-style'))return;
    const sheet=document.createElement('style');
    sheet.id='gc-ms-style';
    sheet.textContent=`
      .gc-ms-card{margin-top:18px}
      .gc-ms-status{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;margin:14px 0}
      .gc-ms-stat{border:1px solid var(--line,#dce5ec);border-radius:12px;padding:11px;min-width:0}
      .gc-ms-stat small,.gc-ms-stat strong{display:block}
      .gc-ms-stat small{opacity:.66;margin-bottom:3px}
      .gc-ms-stat strong{overflow-wrap:anywhere}
      .gc-ms-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .gc-ms-grid label,.gc-ms-auth label{display:grid;gap:5px}
      .gc-ms-grid input,.gc-ms-grid select,.gc-ms-auth input{width:100%}
      .gc-ms-auth{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
      .gc-ms-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:12px}
      .gc-ms-section{border-top:1px solid var(--line,#dce5ec);margin-top:18px;padding-top:15px}
      .gc-ms-note{font-size:12px;opacity:.72}
      .gc-ms-callout{border:1px solid var(--line,#dce5ec);border-radius:12px;padding:12px;margin:12px 0;background:color-mix(in srgb,var(--surface,#fff) 92%,var(--accent,#2d7ff9) 8%)}
      .gc-ms-statusline{min-height:20px;margin:10px 0 0}
      .gc-ms-check{display:flex!important;grid-template-columns:auto 1fr!important;align-items:flex-start;gap:8px!important;margin-top:10px}
      .gc-ms-check input{width:auto!important;margin-top:3px}
      .gc-ms-danger{color:#b54444}
      .gc-ms-good{color:#16835f}
      .gc-ms-warn{color:#a96600}
      @media(max-width:1100px){.gc-ms-status{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:720px){.gc-ms-grid,.gc-ms-auth{grid-template-columns:1fr}}
      @media(max-width:520px){.gc-ms-status{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(sheet);
  }

  async function invoke(action,body={}){
    const result=await client.functions.invoke('mobilesentrix-sync',{body:{action,...body}});
    if(result.error)throw new Error(result.data?.error||result.error.message||'MobileSentrix request failed.');
    if(result.data?.ok===false)throw new Error(result.data?.error||'MobileSentrix request failed.');
    return result.data;
  }

  async function permission(){
    const current=profile();
    if(!current)return false;
    const [inventory,settings]=await Promise.all([
      client.rpc('has_permission',{permission_key:'inventory.manage'}),
      client.rpc('has_permission',{permission_key:'settings.manage'})
    ]);
    state.canManage=current.role==='owner'||inventory.data===true||settings.data===true;
    return state.canManage;
  }

  async function load(){
    if(!await permission())return;
    const current=profile();
    const [data,account]=await Promise.all([
      invoke('status'),
      client
        .from('supplier_account_links')
        .select('account_label,account_email,account_number,portal_url,linked_at,updated_at')
        .eq('location_id',current.location_id)
        .eq('supplier_key','mobilesentrix')
        .maybeSingle()
    ]);
    state.status=data.status;
    state.account=account.error?null:account.data;
    render();
  }

  function authFields(config){
    const scheme=config.auth_scheme||'oauth1';
    if(scheme==='oauth1'){
      return `<div class="gc-ms-auth">
        <label>Consumer key<input name="consumer_key" type="password" autocomplete="off" placeholder="Leave blank to keep the saved key"></label>
        <label>Consumer secret<input name="consumer_secret" type="password" autocomplete="new-password" placeholder="Leave blank to keep the saved secret"></label>
        <label>Access token <small>Optional unless MobileSentrix issues one</small><input name="access_token" type="password" autocomplete="off" placeholder="Leave blank to keep the saved token"></label>
        <label>Token secret <small>Optional unless MobileSentrix issues one</small><input name="token_secret" type="password" autocomplete="new-password" placeholder="Leave blank to keep the saved token secret"></label>
      </div>`;
    }
    if(scheme==='basic'){
      return `<div class="gc-ms-auth">
        <label>API username<input name="username" autocomplete="username" placeholder="MobileSentrix API username"></label>
        <label>API password<input name="password" type="password" autocomplete="new-password" placeholder="Leave blank to keep the saved password"></label>
      </div>`;
    }
    return `<div class="gc-ms-auth">
      <label>${scheme==='api_key'?'API key':'Bearer access token'}<input name="token" type="password" autocomplete="off" placeholder="Leave blank to keep the saved credential"></label>
      ${scheme==='api_key'?`<label>API key header<input name="header_name" value="${esc(config.header_name||'X-API-Key')}"></label>`:''}
    </div>`;
  }

  function requestState(config){
    const status=String(config.consumer_request_status||'').toLowerCase();
    if(status==='approved')return{label:'Approved',className:'gc-ms-good'};
    if(status==='submitted')return{label:'Submitted',className:'gc-ms-warn'};
    return{label:'Not submitted',className:''};
  }

  function accountMarkup(){
    const account=state.account||{};
    return `<div class="gc-ms-section">
      <h3>MobileSentrix account</h3>
      <p class="subtle">This identifies the supplier account used by GotCracked. API credentials remain encrypted and separate.</p>
      <form id="gc-ms-account-form" class="settings-list">
        <div class="gc-ms-grid">
          <label>Account / business name<input name="account_label" maxlength="160" value="${esc(account.account_label||'GotCracked MobileSentrix')}" placeholder="GotCracked"></label>
          <label>Account email<input name="account_email" type="email" maxlength="320" value="${esc(account.account_email||'hello@gotcracked.co')}" placeholder="hello@gotcracked.co"></label>
          <label>Customer / account number <small>Optional</small><input name="account_number" maxlength="160" value="${esc(account.account_number||'')}"></label>
        </div>
        <div class="gc-ms-actions">
          <a class="secondary-button" href="${ACCOUNT_URL}" target="_blank" rel="noopener">Open MobileSentrix account</a>
          <button class="primary-button" type="submit">Save account link</button>
        </div>
        <p class="auth-message gc-ms-statusline" role="status"></p>
      </form>
    </div>`;
  }

  function render(){
    const host=document.getElementById('settings');
    if(!host||!state.canManage)return;
    style();
    document.getElementById('gc-mobilesentrix-settings')?.remove();

    const status=state.status||{};
    const config=status.config||{};
    const counts=status.counts||{};
    const ready=Boolean(status.apiReady);
    const hasConsumer=Boolean(status.hasConsumerCredentials);
    const account=state.account||{};
    const accountName=account.account_label||account.account_email||account.account_number||'Not linked';
    const request=requestState(config);
    const resumable=Boolean(status.nextPage);
    const authScheme=config.auth_scheme||'oauth1';
    const paginationMode=config.pagination_mode||'magento1';

    host.insertAdjacentHTML('beforeend',`<section id="gc-mobilesentrix-settings">
      <article class="card gc-ms-card">
        <div class="card-title">
          <div>
            <p class="eyebrow">Supplier integration</p>
            <h2>MobileSentrix parts catalog</h2>
            <p>Sync MobileSentrix SKUs, account pricing, and supplier availability into the Parts Registry. Physical GotCracked stock changes only when a part is received or manually stocked.</p>
          </div>
        </div>

        <div class="gc-ms-status">
          <div class="gc-ms-stat"><small>Account</small><strong class="${state.account?'gc-ms-good':''}">${esc(accountName)}</strong></div>
          <div class="gc-ms-stat"><small>API request</small><strong class="${request.className}">${request.label}</strong></div>
          <div class="gc-ms-stat"><small>Credential</small><strong class="${ready?'gc-ms-good':'gc-ms-warn'}">${ready?'Authorized':hasConsumer?'Authorization needed':'Awaiting approval'}</strong></div>
          <div class="gc-ms-stat"><small>Supplier listings</small><strong>${Number(counts.activeSupplierListings||0).toLocaleString()}</strong></div>
          <div class="gc-ms-stat"><small>Registry parts</small><strong>${Number(counts.registryParts||0).toLocaleString()}</strong></div>
          <div class="gc-ms-stat"><small>Physical stock records</small><strong>${Number(counts.activeInventoryItems||0).toLocaleString()}</strong></div>
        </div>

        <div class="gc-ms-callout">
          <strong>${ready?'Official API is ready to test.':hasConsumer?'Consumer credentials are saved.':'Official API access is pending.'}</strong>
          <div>${ready
            ?'Use Save & test API, then run the full catalog sync.'
            :hasConsumer
              ?'Authorize the GotCracked consumer against the MobileSentrix account to obtain the access token.'
              :'The API consumer request has been submitted. A full supplier CSV can seed the registry while approval is pending.'}</div>
          <div class="gc-ms-actions">
            <a class="secondary-button" href="${API_CONSUMER_URL}" target="_blank" rel="noopener">Open API Consumers</a>
            <a class="secondary-button" href="${ACCOUNT_URL}" target="_blank" rel="noopener">Open supplier account</a>
          </div>
        </div>

        <p><strong>Last status:</strong> ${esc(status.lastStatus||'not configured')} · <strong>Last successful sync:</strong> ${esc(when(status.lastSuccessAt))} · <strong>Last run:</strong> ${Number(status.itemsSeen||0).toLocaleString()} items</p>
        ${resumable?`<p class="gc-ms-warn"><strong>Resumable sync:</strong> The next API page is ${esc(status.nextPage)}.</p>`:''}
        ${status.lastError?`<p class="gc-ms-danger"><strong>Last error:</strong> ${esc(status.lastError)}</p>`:''}

        ${accountMarkup()}

        <div class="gc-ms-section">
          <h3>Official catalog API</h3>
          <p class="subtle">MobileSentrix exposes a Magento-style catalog endpoint. OAuth 1.0a is the default; bearer, API key, and basic modes remain available if their team supplies a different credential package.</p>
          <form id="gc-ms-api-form" class="settings-list">
            <div class="gc-ms-grid">
              <label>API base URL<input name="api_base_url" type="url" required value="${esc(config.api_base_url||'https://www.mobilesentrix.com')}"></label>
              <label>Catalog API path<input name="catalog_path" required value="${esc(config.catalog_path||'/api/rest/products')}"><small>Default: /api/rest/products</small></label>
              <label>Authentication<select name="auth_scheme">
                <option value="oauth1" ${selected(authScheme,'oauth1')}>OAuth 1.0a consumer</option>
                <option value="bearer" ${selected(authScheme,'bearer')}>Bearer access token</option>
                <option value="api_key" ${selected(authScheme,'api_key')}>API key header</option>
                <option value="basic" ${selected(authScheme,'basic')}>Username + password</option>
              </select></label>
              <label>Pagination<select name="pagination_mode">
                <option value="magento1" ${selected(paginationMode,'magento1')}>Magento 1 / MobileSentrix</option>
                <option value="magento2" ${selected(paginationMode,'magento2')}>Magento 2 search criteria</option>
                <option value="custom" ${selected(paginationMode,'custom')}>Custom page + limit</option>
              </select></label>
              <label>Page size<input name="page_size" type="number" min="1" max="${paginationMode==='magento1'?100:250}" value="${Number(config.page_size||100)}"></label>
            </div>
            <div data-ms-auth-fields>${authFields(config)}</div>
            <p class="gc-ms-note">Credentials are encrypted server-side in Supabase Vault. The Portal never reads a saved credential back.</p>
            <div class="gc-ms-actions">
              <button class="primary-button" type="submit">${ready?'Save & test API':'Save API settings'}</button>
              ${authScheme==='oauth1'&&hasConsumer&&!ready?'<button class="secondary-button" type="button" data-ms-oauth-start>Authorize MobileSentrix account</button>':''}
              <button class="secondary-button" type="button" data-ms-sync ${ready?'':'disabled'}>${resumable?'Resume sync':'Sync full catalog'}</button>
              ${resumable?'<button class="secondary-button" type="button" data-ms-reset>Discard partial run</button>':''}
              <button class="secondary-button" type="button" data-ms-refresh>Refresh status</button>
            </div>
            <p class="auth-message gc-ms-statusline" role="status"></p>
          </form>
        </div>

        <div class="gc-ms-section">
          <h3>CSV catalog fallback</h3>
          <p class="subtle">Import an official MobileSentrix catalog export while API approval is pending. This seeds the same supplier registry and does not create fake on-hand quantities.</p>
          <form id="gc-ms-csv-form">
            <label>MobileSentrix CSV<input name="csv" type="file" accept=".csv,text/csv" required></label>
            <label class="gc-ms-check"><input name="authoritative" type="checkbox"><span>This file is the complete MobileSentrix catalog. Deactivate supplier listings missing from it.</span></label>
            <p class="gc-ms-note">Leave this unchecked for partial exports. One import supports up to 8 MB and 20,000 product rows.</p>
            <div class="gc-ms-actions"><button class="secondary-button" type="submit">Import supplier CSV</button></div>
            <p class="auth-message gc-ms-statusline" role="status"></p>
          </form>
        </div>
      </article>
    </section>`);
  }

  function setMessage(formId,message){
    const output=document.querySelector(`#${formId} .auth-message`);
    if(output)output.textContent=message;
  }

  async function saveAccount(form){
    const output=form.querySelector('.auth-message');
    const data=new FormData(form);
    const current=profile();
    const email=String(data.get('account_email')||'').trim();
    const label=String(data.get('account_label')||'').trim();
    const number=String(data.get('account_number')||'').trim();
    if(!email&&!label&&!number){
      output.textContent='Enter the account email, business name, or account number.';
      return;
    }

    output.textContent='Saving MobileSentrix account link…';
    const row={
      location_id:current.location_id,
      supplier_key:'mobilesentrix',
      account_label:label||null,
      account_email:email||null,
      account_number:number||null,
      portal_url:ACCOUNT_URL,
      linked_at:state.account?.linked_at||new Date().toISOString(),
      updated_at:new Date().toISOString()
    };
    const result=await client
      .from('supplier_account_links')
      .upsert(row,{onConflict:'location_id,supplier_key'})
      .select()
      .single();
    if(result.error)throw result.error;
    state.account=result.data;
    render();
    setMessage('gc-ms-account-form','MobileSentrix account link saved.');
  }

  async function configure(form){
    const output=form.querySelector('.auth-message');
    const data=new FormData(form);
    output.textContent='Saving encrypted MobileSentrix configuration…';

    const saved=await invoke('configure',{
      api_base_url:data.get('api_base_url'),
      catalog_path:data.get('catalog_path'),
      auth_scheme:data.get('auth_scheme'),
      pagination_mode:data.get('pagination_mode'),
      header_name:data.get('header_name'),
      page_size:Number(data.get('page_size')||100),
      token:data.get('token'),
      username:data.get('username'),
      password:data.get('password'),
      consumer_key:data.get('consumer_key'),
      consumer_secret:data.get('consumer_secret'),
      access_token:data.get('access_token'),
      token_secret:data.get('token_secret')
    });

    if(saved.oauthAuthorizationRequired){
      await load();
      setMessage('gc-ms-api-form','Consumer credentials saved. Authorize the MobileSentrix account to finish OAuth.');
      return;
    }
    if(!saved.apiReady){
      await load();
      setMessage('gc-ms-api-form','API defaults saved. Credential entry is waiting for MobileSentrix approval.');
      return;
    }

    output.textContent='Configuration saved. Testing the supplier connection…';
    try{
      const test=await invoke('test');
      await load();
      setMessage(
        'gc-ms-api-form',
        `Connected. API returned ${Number(test.itemsReturned||0).toLocaleString()} item(s)${test.totalCount!=null?` of ${Number(test.totalCount).toLocaleString()}`:''}.`
      );
    }catch(error){
      await load();
      setMessage('gc-ms-api-form',`Saved, but the API test failed: ${error.message}`);
    }
  }

  async function startOAuth(button){
    if(state.busy)return;
    state.busy=true;
    button.disabled=true;
    const popup=window.open('about:blank','gc-ms-oauth','popup,width=760,height=860');
    try{
      setMessage('gc-ms-api-form','Starting secure MobileSentrix authorization…');
      const data=await invoke('oauth_start');
      if(popup&&!popup.closed){
        popup.location.replace(data.authorizeUrl);
        popup.focus();
      }else{
        location.assign(data.authorizeUrl);
      }
      setMessage('gc-ms-api-form','MobileSentrix authorization opened. Approve GotCracked in that window.');
    }catch(error){
      try{popup?.close();}catch{}
      setMessage('gc-ms-api-form',error.message||'Unable to start MobileSentrix authorization.');
    }finally{
      state.busy=false;
      const current=document.querySelector('[data-ms-oauth-start]');
      if(current)current.disabled=false;
    }
  }

  function clearOAuthCallbackUrl(){
    history.replaceState({},document.title,`${location.origin}${location.pathname}`);
    location.hash='settings';
  }

  let completingOAuth=false;
  async function completeOAuthFromUrl(){
    if(completingOAuth)return;
    const params=new URLSearchParams(location.search);
    if(params.get('mobilesentrix_oauth')!=='callback')return;
    const oauthToken=params.get('oauth_token')||'';
    const oauthVerifier=params.get('oauth_verifier')||'';
    const oauthProblem=params.get('oauth_problem')||params.get('denied')||'';
    if(!profile()||!await permission())return;

    completingOAuth=true;
    try{
      if(oauthProblem){
        await invoke('oauth_cancel').catch(()=>{});
        throw new Error(`MobileSentrix authorization was not completed: ${oauthProblem}`);
      }
      if(!oauthToken||!oauthVerifier){
        throw new Error('MobileSentrix returned an incomplete OAuth callback.');
      }
      await invoke('oauth_complete',{
        oauth_token:oauthToken,
        oauth_verifier:oauthVerifier
      });
      clearOAuthCallbackUrl();
      localStorage.setItem('gc-ms-oauth-complete',String(Date.now()));
      window.opener?.postMessage({type:'gc-ms-oauth-complete'},location.origin);
      await load();
      setMessage('gc-ms-api-form','MobileSentrix account authorized. The catalog API is ready to test.');
      if(window.opener&&!window.opener.closed)setTimeout(()=>window.close(),1200);
    }catch(error){
      clearOAuthCallbackUrl();
      await load().catch(()=>{});
      setMessage('gc-ms-api-form',error.message||'Unable to finish MobileSentrix authorization.');
    }finally{
      completingOAuth=false;
    }
  }

  async function sync(button){
    if(state.busy)return;
    state.busy=true;
    button.disabled=true;
    try{
      let cycle=0;
      let more=true;
      let runId=null;
      let latest={};
      while(more&&cycle<40){
        cycle+=1;
        setMessage('gc-ms-api-form',`Syncing MobileSentrix catalog… pass ${cycle}`);
        latest=await invoke('sync',{max_pages:6,run_id:runId});
        runId=latest.runId||runId;
        more=latest.hasMore===true;
      }

      const total=Number(latest.totalItemsSeen??latest.itemsSeen??0);
      const newParts=Number(latest.totalNewPartsFound??latest.newPartsFound??0);
      const changed=Number(latest.totalChangedListings??latest.changedListings??0);
      const message=more
        ?`Synced ${total.toLocaleString()} items. The run is saved and can resume from the next page.`
        :`MobileSentrix sync complete: ${total.toLocaleString()} items, ${newParts.toLocaleString()} new registry parts, ${changed.toLocaleString()} changed listings.`;
      await load();
      setMessage('gc-ms-api-form',message);
      await window.GotCrackedPartsRegistry?.load?.();
    }catch(error){
      await load();
      setMessage('gc-ms-api-form',error.message||'MobileSentrix sync failed.');
    }finally{
      state.busy=false;
      const current=document.querySelector('[data-ms-sync]');
      if(current)current.disabled=!state.status?.apiReady;
    }
  }

  async function resetSync(){
    await invoke('reset_sync');
    await load();
    setMessage('gc-ms-api-form','Partial sync state cleared. The next run will start from page 1.');
  }

  async function importCsv(form){
    const output=form.querySelector('.auth-message');
    const file=form.elements.csv.files?.[0];
    if(!file)return;
    output.textContent='Reading supplier CSV…';
    const csv=await file.text();
    output.textContent='Importing MobileSentrix catalog…';
    const data=await invoke('import_csv',{
      csv,
      authoritative:Boolean(form.elements.authoritative.checked)
    });
    const message=`Imported ${Number(data.itemsSeen||0).toLocaleString()} supplier items; ${Number(data.newPartsFound||0).toLocaleString()} new registry parts; ${Number(data.changedListings||0).toLocaleString()} changed listings.`;
    form.reset();
    await load();
    setMessage('gc-ms-csv-form',message);
    await window.GotCrackedPartsRegistry?.load?.();
  }

  document.addEventListener('change',event=>{
    if(event.target?.name==='auth_scheme'&&event.target.closest('#gc-ms-api-form')){
      const form=event.target.closest('form');
      const host=form.querySelector('[data-ms-auth-fields]');
      host.innerHTML=authFields({...state.status?.config,auth_scheme:event.target.value});
    }
    if(event.target?.name==='pagination_mode'&&event.target.closest('#gc-ms-api-form')){
      const size=event.target.closest('form').elements.page_size;
      size.max=event.target.value==='magento1'?'100':'250';
      if(Number(size.value)>Number(size.max))size.value=size.max;
    }
  });

  document.addEventListener('submit',event=>{
    if(event.target?.id==='gc-ms-account-form'){
      event.preventDefault();
      void saveAccount(event.target).catch(error=>{
        event.target.querySelector('.auth-message').textContent=error.message||'Unable to save MobileSentrix account link.';
      });
    }else if(event.target?.id==='gc-ms-api-form'){
      event.preventDefault();
      void configure(event.target).catch(error=>{
        event.target.querySelector('.auth-message').textContent=error.message||'Unable to configure MobileSentrix.';
      });
    }else if(event.target?.id==='gc-ms-csv-form'){
      event.preventDefault();
      void importCsv(event.target).catch(error=>{
        event.target.querySelector('.auth-message').textContent=error.message||'Unable to import CSV.';
      });
    }
  });

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    const oauthButton=target.closest('[data-ms-oauth-start]');
    if(oauthButton)return void startOAuth(oauthButton);
    const syncButton=target.closest('[data-ms-sync]');
    if(syncButton)return void sync(syncButton);
    if(target.closest('[data-ms-reset]'))return void resetSync().catch(error=>setMessage('gc-ms-api-form',error.message));
    if(target.closest('[data-ms-refresh]'))return void load();
  });

  const maybeLoad=()=>{
    if(location.hash.startsWith('#settings')){
      setTimeout(()=>void load().catch(error=>console.warn('MobileSentrix settings failed to load',error)),120);
    }
  };
  const refreshAfterOAuth=()=>{
    if(location.hash.startsWith('#settings')){
      setTimeout(()=>void load().catch(error=>console.warn('MobileSentrix OAuth refresh failed',error)),120);
    }
  };
  document.addEventListener('gc-view-changed',maybeLoad);
  window.addEventListener('hashchange',maybeLoad);
  window.addEventListener('gotcracked:staff-ready',()=>{
    maybeLoad();
    void completeOAuthFromUrl();
  });
  window.addEventListener('message',event=>{
    if(event.origin===location.origin&&event.data?.type==='gc-ms-oauth-complete')refreshAfterOAuth();
  });
  window.addEventListener('storage',event=>{
    if(event.key==='gc-ms-oauth-complete'&&event.newValue)refreshAfterOAuth();
  });
  const observer=new MutationObserver(()=>{
    if(location.hash.startsWith('#settings')&&!document.getElementById('gc-mobilesentrix-settings')&&state.canManage)render();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  maybeLoad();
  void completeOAuthFromUrl();

  window.GotCrackedMobileSentrix={version:'1.3.1',state,load,sync,startOAuth};
})();
