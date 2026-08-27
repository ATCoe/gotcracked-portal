(() => {
  'use strict';
  const client = window.supabaseClient;
  if (!client) return;
  let status = null;
  let metrics = null;
  let busy = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const number = value => new Intl.NumberFormat('en-US').format(Number(value || 0));
  const pct = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
  const training = () => localStorage.getItem('gc-training-store') === '1';

  async function invoke(action) {
    const result = await client.functions.invoke('google-integrations',{body:{action}});
    if (result.error) throw new Error(result.error.message || `Google ${action} failed.`);
    return result.data || {};
  }

  function googleAuthorizationUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function style() {
    if (document.getElementById('gc-google-live-style')) return;
    const node=document.createElement('style'); node.id='gc-google-live-style'; node.textContent=`
      .gc-google-live{margin-top:18px}.gc-google-live-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.gc-google-live-grid article{border:1px solid var(--line,#d9e2ec);border-radius:12px;padding:13px}.gc-google-live-grid small{display:block;margin-bottom:5px}.gc-google-live-grid strong{font-size:1.15rem}.gc-google-live-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center}.gc-google-live code{user-select:all;overflow-wrap:anywhere}.gc-google-live .gc-google-note{margin:12px 0;padding:12px;border-radius:10px;background:var(--surface-2,rgba(90,130,170,.08))}
    `; document.head.appendChild(node);
  }

  function metricCards() {
    if (!metrics?.connected) return '';
    const search=metrics.searchConsole||{}, ga=metrics.analytics||{};
    return `<div class="gc-google-live-grid">
      <article><small>Search clicks · 28d</small><strong>${search.error?'—':number(search.clicks)}</strong></article>
      <article><small>Search impressions · 28d</small><strong>${search.error?'—':number(search.impressions)}</strong></article>
      <article><small>Search CTR</small><strong>${search.error?'—':pct(search.ctr)}</strong></article>
      <article><small>Avg. search position</small><strong>${search.error?'—':Number(search.position||0).toFixed(1)}</strong></article>
      <article><small>GA4 sessions · 28d</small><strong>${ga.error?'—':number(ga.sessions)}</strong></article>
      <article><small>GA4 active users · 28d</small><strong>${ga.error?'—':number(ga.activeUsers)}</strong></article>
      <article><small>GA4 page views · 28d</small><strong>${ga.error?'—':number(ga.pageViews)}</strong></article>
      <article><small>Business accounts</small><strong>${metrics.businessProfile?.error?'—':number(metrics.businessProfile?.accounts?.length)}</strong></article>
    </div>`;
  }

  function render() {
    const parent=document.querySelector('#gc-business-presence-settings .card:last-of-type');
    if (!parent || document.getElementById('gc-google-live-connection')) return;
    style();
    const setup=status?.setupRequired;
    const connected=status?.connected;
    parent.insertAdjacentHTML('beforeend',`<section id="gc-google-live-connection" class="gc-google-live">
      <div class="card-title"><div><p class="eyebrow">Live Google connection</p><h3>${connected?'Connected':'Connect Google'}</h3><p>${connected?`Authorized as ${esc(status.email||'Google account')}. Search Console, GA4, and Business Profile data stay server-side.`:'Authorize GotCracked once to read Search Console, GA4, and Business Profile data inside the Portal.'}</p></div></div>
      ${setup?`<div class="gc-google-note"><strong>One-time Google Cloud setup required.</strong><p>Create a Web application OAuth client, enable the Search Console API, Google Analytics Data API, and Business Profile APIs, then add this authorized redirect URI:</p><code>${esc(status.callbackUrl||'')}</code><p>Store the client ID and client secret as Supabase Edge Function secrets named <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code>.</p></div>`:''}
      ${metricCards()}
      <div class="gc-google-live-actions">
        ${connected?'<button class="secondary-button" type="button" data-google-refresh>Refresh Google metrics</button><button class="secondary-button" type="button" data-google-disconnect>Disconnect Google</button>':`<button class="primary-button" type="button" data-google-connect ${setup?'disabled':''}>Connect Google account</button>`}
        <span class="auth-message" data-google-message role="status">${busy?'Working…':''}</span>
      </div>
      ${metrics?.searchConsole?.error?`<p class="subtle">Search Console: ${esc(metrics.searchConsole.error)}</p>`:''}
      ${metrics?.analytics?.error?`<p class="subtle">GA4: ${esc(metrics.analytics.error)}</p>`:''}
      ${metrics?.businessProfile?.error?`<p class="subtle">Business Profile: ${esc(metrics.businessProfile.error)}</p>`:''}
    </section>`);
  }

  function rerender(){document.getElementById('gc-google-live-connection')?.remove();render();}
  async function load() {
    if (training()) { status={connected:false,setupRequired:false,callbackUrl:'Training Store'}; render(); return; }
    try { status=await invoke('status'); if(status.connected) metrics=await invoke('metrics'); }
    catch(error){status={connected:false,setupRequired:false}; console.warn('Google integration status unavailable:',error);}
    rerender();
  }

  async function start(){
    if(busy)return;
    busy=true;
    rerender();
    try{
      const data=await invoke('start');
      const authUrl=googleAuthorizationUrl(data.authUrl);
      if(!authUrl) throw new Error('Google returned an invalid authorization URL.');
      location.assign(authUrl);
    }catch(error){
      document.querySelector('[data-google-message]')?.replaceChildren(document.createTextNode(error.message));
      busy=false;
      rerender();
    }
  }
  async function refresh(){if(busy)return;busy=true;rerender();try{metrics=await invoke('metrics');status=await invoke('status');}catch(error){metrics={connected:true,analytics:{error:error.message}};}finally{busy=false;rerender();}}
  async function disconnect(){if(busy||!confirm('Disconnect the Portal from this Google account?'))return;busy=true;rerender();try{await invoke('disconnect');status=await invoke('status');metrics=null;}finally{busy=false;rerender();}}

  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-google-connect]'))start();
    if(event.target.closest?.('[data-google-refresh]'))refresh();
    if(event.target.closest?.('[data-google-disconnect]'))disconnect();
  });
  const observer=new MutationObserver(()=>render()); observer.observe(document.body,{childList:true,subtree:true});
  const outcome=new URL(location.href).searchParams.get('google');
  if(outcome){history.replaceState(null,'',`${location.pathname}${location.hash||'#settings'}`);setTimeout(()=>window.GotCrackedDiagnostics?.error?.(outcome==='connected'?'Google account connected successfully.':'Google authorization did not complete.',{context:outcome==='connected'?'Google connection':'Google connection issue',duration:8000}),700);}
  setTimeout(load,500);
})();
