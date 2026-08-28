(()=>{
  'use strict';
  if(window.GotCrackedOperatorPin)return;
  const client=window.supabaseClient;
  if(!client)return;

  const VERSION='20260828-operator-pin1';
  const STORAGE_TOKEN='gc-workstation-operator-token';
  const STORAGE_OPERATOR='gc-workstation-operator';
  const STORAGE_EXPIRY='gc-workstation-operator-expiry';
  let roster=[];
  let selected=null;
  let selfStatus=null;
  let profileObserver=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const current=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const isWorkstation=()=>current()?.account_type==='shared_workstation';
  const human=()=>current()?.account_type!=='shared_workstation';
  const staffState=()=>window.GotCrackedStaffProfiles?.state||null;

  function injectStyle(){
    if(document.getElementById('gc-operator-pin-style'))return;
    const s=document.createElement('style');
    s.id='gc-operator-pin-style';
    s.textContent=`
      .gc-operator-pill{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:5px 11px;border:1px solid rgba(42,142,247,.25);border-radius:999px;background:rgba(42,142,247,.08);color:inherit;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.gc-operator-pill::before{content:'';width:7px;height:7px;border-radius:50%;background:#8b9bad}.gc-operator-pill.is-ready::before{background:#2a8ef7}.gc-operator-pill small{font-weight:650;opacity:.68}
      .gc-operator-dialog{width:min(560px,calc(100vw - 28px));border:1px solid rgba(77,163,255,.2);border-radius:20px;padding:0;background:var(--surface,#fff);color:var(--text,#122033);box-shadow:0 28px 80px rgba(0,0,0,.32)}.gc-operator-dialog::backdrop{background:rgba(4,12,24,.68);backdrop-filter:blur(5px)}.gc-operator-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 22px 16px;border-bottom:1px solid rgba(128,151,176,.18)}.gc-operator-head h2{margin:2px 0 4px}.gc-operator-head p{margin:0}.gc-operator-body{padding:18px 22px 22px}.gc-operator-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gc-operator-person{display:flex;align-items:center;gap:10px;text-align:left;padding:12px;border:1px solid rgba(128,151,176,.2);border-radius:14px;background:rgba(128,151,176,.06);color:inherit;cursor:pointer}.gc-operator-person:hover{border-color:rgba(42,142,247,.45)}.gc-operator-avatar{width:40px;height:40px;display:grid;place-items:center;flex:0 0 40px;border-radius:50%;background:rgba(42,142,247,.12);font-weight:900;overflow:hidden}.gc-operator-avatar img{width:100%;height:100%;object-fit:cover}.gc-operator-person span{min-width:0;display:grid}.gc-operator-person strong,.gc-operator-person small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gc-operator-person em{font-size:10px;font-style:normal;opacity:.65}.gc-operator-pin-step{display:grid;gap:14px}.gc-operator-selected{display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;background:rgba(42,142,247,.08)}.gc-pin-input{font-size:24px!important;letter-spacing:.22em;text-align:center;font-variant-numeric:tabular-nums}.gc-pin-actions{display:flex;flex-wrap:wrap;gap:8px}.gc-pin-message{min-height:20px;margin:0;font-size:12px}.gc-pin-message.error{color:#d74747}.gc-pin-message.success{color:#208554}
      .gc-pin-account-card{margin-top:14px}.gc-pin-form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.gc-pin-form label{display:grid;gap:6px}.gc-pin-status{display:flex;align-items:center;gap:8px;margin:10px 0 14px}.gc-pin-status span{display:inline-flex;padding:4px 9px;border-radius:999px;background:rgba(128,151,176,.12);font-size:11px;font-weight:800}.gc-pin-status .ready{background:rgba(42,142,247,.12);color:#2278c8}.gc-pin-admin{margin-top:14px}.gc-pin-admin .gc-account-admin-note{margin-bottom:12px}
      html[data-theme="dark"] .gc-operator-dialog{background:#101c2a;color:#e9f2fb;border-color:rgba(90,176,255,.24)}html[data-theme="dark"] .gc-operator-person{background:rgba(255,255,255,.035);border-color:rgba(132,178,218,.16)}html[data-theme="dark"] .gc-operator-selected{background:rgba(77,163,255,.1)}
      @media(max-width:650px){.gc-operator-grid{grid-template-columns:1fr}.gc-pin-form{grid-template-columns:1fr}.gc-operator-pill small{display:none}.gc-operator-dialog{width:calc(100vw - 18px)}}
    `;
    document.head.appendChild(s);
  }

  function initials(name){return String(name||'Staff').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'GC'}
  function avatar(p){return p?.avatar_url?`<span class="gc-operator-avatar"><img src="${esc(p.avatar_url)}" alt=""></span>`:`<span class="gc-operator-avatar">${esc(initials(p?.display_name))}</span>`}
  function operatorFromStorage(){
    try{
      const expiry=new Date(sessionStorage.getItem(STORAGE_EXPIRY)||0).getTime();
      const op=JSON.parse(sessionStorage.getItem(STORAGE_OPERATOR)||'null');
      const token=sessionStorage.getItem(STORAGE_TOKEN)||'';
      if(!op||!token||!expiry||expiry<=Date.now()){clearLocalOperator();return null}
      return {operator:op,token,expires_at:new Date(expiry).toISOString()};
    }catch{clearLocalOperator();return null}
  }
  function clearLocalOperator(){sessionStorage.removeItem(STORAGE_TOKEN);sessionStorage.removeItem(STORAGE_OPERATOR);sessionStorage.removeItem(STORAGE_EXPIRY)}
  function saveOperator(data){
    sessionStorage.setItem(STORAGE_TOKEN,data.session_token);
    sessionStorage.setItem(STORAGE_OPERATOR,JSON.stringify(data.operator));
    sessionStorage.setItem(STORAGE_EXPIRY,String(new Date(data.expires_at).getTime()));
  }

  async function rpc(name,args={}){
    const {data,error}=await client.rpc(name,args);
    if(error)throw error;
    return data;
  }

  function ensurePill(){
    if(!isWorkstation())return null;
    let pill=document.querySelector('.gc-operator-pill');
    if(!pill){
      pill=document.createElement('button');
      pill.type='button';
      pill.className='gc-operator-pill';
      pill.dataset.gcOperatorPicker='true';
      const badge=document.querySelector('.gc-workstation-badge');
      const locationNode=document.querySelector('.topbar .location');
      (badge||locationNode)?.insertAdjacentElement('afterend',pill);
    }
    renderPill();
    return pill;
  }
  function renderPill(){
    const pill=document.querySelector('.gc-operator-pill');
    if(!pill)return;
    const active=operatorFromStorage()?.operator;
    pill.classList.toggle('is-ready',Boolean(active));
    pill.innerHTML=active?`<span>${esc(active.display_name)}</span><small>Switch operator</small>`:'<span>Choose operator</span><small>PIN required</small>';
    pill.setAttribute('aria-label',active?`Current operator ${active.display_name}. Switch operator`:'Choose Front Desk operator');
    document.documentElement.dataset.gcOperatorReady=active?'true':'false';
  }

  function ensureDialog(){
    let d=document.getElementById('gc-operator-dialog');
    if(d)return d;
    d=document.createElement('dialog');
    d.id='gc-operator-dialog';
    d.className='gc-operator-dialog';
    d.innerHTML=`<div class="gc-operator-head"><div><p class="eyebrow">Front Desk Workstation</p><h2>Who is using this station?</h2><p class="subtle">Choose your name and enter your personal operator PIN.</p></div><button type="button" class="icon-button" data-operator-close aria-label="Close">×</button></div><div class="gc-operator-body"><p class="gc-pin-message" data-operator-message></p><div data-operator-content></div></div>`;
    document.body.appendChild(d);
    return d;
  }
  function message(text='',kind=''){
    const node=ensureDialog().querySelector('[data-operator-message]');
    if(!node)return;
    node.textContent=text;
    node.className=`gc-pin-message ${kind}`.trim();
  }

  async function loadRoster(){
    roster=await rpc('get_workstation_operator_roster');
    return roster;
  }
  function renderRoster(){
    selected=null;
    const host=ensureDialog().querySelector('[data-operator-content]');
    if(!host)return;
    host.innerHTML=`<div class="gc-operator-grid">${roster.map(p=>`<button type="button" class="gc-operator-person" data-operator-person="${esc(p.profile_id)}">${avatar(p)}<span><strong>${esc(p.display_name)}</strong><small>${esc(p.job_title||p.role||'Staff')}</small><em>${p.pin_configured?'PIN ready':p.reset_required?'PIN setup required':'PIN not configured'}</em></span></button>`).join('')||'<p class="subtle">No active human staff accounts are available.</p>'}</div>`;
  }
  function renderPinStep(p){
    selected=p;
    const host=ensureDialog().querySelector('[data-operator-content]');
    const ready=Boolean(p.pin_configured&&!p.reset_required);
    host.innerHTML=`<div class="gc-operator-pin-step"><div class="gc-operator-selected">${avatar(p)}<div><strong>${esc(p.display_name)}</strong><div class="subtle">${esc(p.job_title||p.role||'Staff')}</div></div></div>${ready?`<label>Operator PIN<input class="gc-pin-input" data-operator-pin type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{4,6}" placeholder="••••"></label><div class="gc-pin-actions"><button type="button" class="primary-button" data-operator-verify>Continue as ${esc(p.display_name.split(' ')[0])}</button><button type="button" class="secondary-button" data-operator-forgot>Forgot PIN?</button><button type="button" class="text-button" data-operator-back>Back</button></div>`:`<div class="gc-account-admin-note"><span aria-hidden="true">🔒</span><p><strong>PIN setup required.</strong> This employee needs to sign into Portal with Discord and create a workstation PIN in My Account.</p></div><div class="gc-pin-actions"><button type="button" class="secondary-button" data-operator-forgot>Send Marlon reset/setup DM</button><button type="button" class="text-button" data-operator-back>Back</button></div>`}</div>`;
    if(ready)setTimeout(()=>host.querySelector('[data-operator-pin]')?.focus(),30);
  }

  async function openPicker(){
    if(!isWorkstation())return;
    const d=ensureDialog();
    message('');
    try{await loadRoster();renderRoster();d.showModal()}
    catch(error){message(error?.message||'Unable to load staff operators.','error');d.showModal()}
  }
  async function verifySelected(){
    if(!selected)return;
    const input=ensureDialog().querySelector('[data-operator-pin]');
    const pin=String(input?.value||'').trim();
    if(!/^\d{4,6}$/.test(pin)){message('Enter your 4–6 digit PIN.','error');input?.focus();return}
    message('Verifying…');
    try{
      const data=await rpc('verify_workstation_operator_pin',{target_profile:selected.profile_id,pin});
      if(!data?.ok){
        const copy={incorrect_pin:`Incorrect PIN.${data.attempts_remaining!=null?` ${data.attempts_remaining} attempts remaining.`:''}`,locked:'Too many attempts. Try again after the temporary lock expires.',pin_setup_required:'This employee needs to set a new workstation PIN.',operator_unavailable:'This employee is not available for this workstation.',invalid_format:'Enter a 4–6 digit PIN.'};
        message(copy[data?.reason]||'PIN verification failed.','error');
        if(input){input.value='';input.focus()}
        return;
      }
      saveOperator(data);renderPill();message(`Verified as ${data.operator.display_name}.`,'success');
      setTimeout(()=>ensureDialog().close(),350);
      document.dispatchEvent(new CustomEvent('gc-workstation-operator-changed',{detail:data.operator}));
    }catch(error){message(error?.message||'Unable to verify PIN.','error')}
  }
  async function requestReset(profileId=selected?.profile_id){
    if(!profileId)return;
    message('Resetting PIN and contacting Marlon…');
    try{
      const data=await rpc('request_operator_pin_reset',{target_profile:profileId});
      message(data?.message||'PIN reset requested.','success');
      await loadRoster();
      const refreshed=roster.find(x=>x.profile_id===profileId);
      if(refreshed)selected=refreshed;
      setTimeout(()=>selected?renderPinStep(selected):renderRoster(),700);
    }catch(error){message(error?.message||'Unable to reset PIN.','error')}
  }
  async function restoreOperator(){
    if(!isWorkstation())return;
    ensurePill();
    const stored=operatorFromStorage();
    if(!stored){renderPill();return}
    try{
      const data=await rpc('validate_workstation_operator_session',{session_token:stored.token});
      if(!data?.ok){clearLocalOperator();renderPill();return}
      sessionStorage.setItem(STORAGE_OPERATOR,JSON.stringify(data.operator));
      sessionStorage.setItem(STORAGE_EXPIRY,String(new Date(data.expires_at).getTime()));
      renderPill();
    }catch{clearLocalOperator();renderPill()}
  }
  async function switchOperator(){
    const stored=operatorFromStorage();
    if(stored?.token){try{await rpc('end_workstation_operator_session',{session_token:stored.token})}catch{}}
    clearLocalOperator();renderPill();await openPicker();
  }

  async function loadSelfStatus(){
    if(!human())return null;
    try{selfStatus=await rpc('get_my_operator_pin_status');return selfStatus}catch{return null}
  }
  function selfCardMarkup(status){
    const configured=Boolean(status?.configured&&!status?.reset_required);
    return `<article class="gc-account-card gc-pin-account-card" data-gc-pin-self><div class="gc-account-card-head"><div><p class="eyebrow">Shared workstation identity</p><h2>Workstation PIN</h2><p>This PIN identifies you when you use the shared Front Desk Workstation. It is not your Portal password.</p></div></div><div class="gc-pin-status"><span class="${configured?'ready':''}">${configured?'PIN ready':status?.reset_required?'PIN setup required':'PIN not configured'}</span>${status?.set_at?`<small>Last changed ${esc(new Date(status.set_at).toLocaleDateString())}</small>`:''}</div>${status?.reset_required?'<div class="gc-account-admin-note"><span aria-hidden="true">!</span><p><strong>Create a new PIN before using the Front Desk Workstation.</strong> A reset invalidates the previous PIN immediately.</p></div>':''}<form class="gc-pin-form" data-gc-pin-form><label>${configured?'New PIN':'Create PIN'}<input name="pin" type="password" inputmode="numeric" autocomplete="off" minlength="4" maxlength="6" pattern="[0-9]{4,6}" required placeholder="4–6 digits"></label><label>Confirm PIN<input name="confirm" type="password" inputmode="numeric" autocomplete="off" minlength="4" maxlength="6" pattern="[0-9]{4,6}" required placeholder="Repeat PIN"></label><button type="submit" class="primary-button">${configured?'Change PIN':'Save PIN'}</button></form><p class="gc-pin-message" data-gc-pin-self-message></p></article>`;
  }
  async function injectSelfCard(){
    if(!human())return;
    const host=document.querySelector('#gc-profile-view .gc-account-settings');
    if(!host||host.querySelector('[data-gc-pin-self]'))return;
    const status=selfStatus||await loadSelfStatus();
    if(!status?.eligible)return;
    host.insertAdjacentHTML('beforeend',selfCardMarkup(status));
  }
  async function saveSelfPin(form){
    const out=form.closest('[data-gc-pin-self]')?.querySelector('[data-gc-pin-self-message]');
    const pin=String(form.elements.pin?.value||'');
    const confirm=String(form.elements.confirm?.value||'');
    const set=(text,kind='')=>{if(out){out.textContent=text;out.className=`gc-pin-message ${kind}`.trim()}};
    if(!/^\d{4,6}$/.test(pin)){set('Use 4–6 digits.','error');return}
    if(pin!==confirm){set('The PINs do not match.','error');return}
    const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    set('Saving…');
    try{
      await rpc('set_my_operator_pin',{pin});
      selfStatus=await loadSelfStatus();
      const card=form.closest('[data-gc-pin-self]');
      if(card)card.outerHTML=selfCardMarkup(selfStatus);
    }catch(error){set(error?.message||'Unable to save PIN.','error')}
    finally{if(button)button.disabled=false}
  }

  let managementRoster=null;
  async function injectManagementReset(){
    const state=staffState();
    const me=current();
    const host=document.getElementById('gc-profile-view');
    if(!host||!state?.canManage||!state.selected||state.selected===me?.id)return;
    host.querySelector('[data-gc-pin-admin]')?.remove();
    try{
      managementRoster ||= await rpc('get_workstation_operator_roster');
      const target=managementRoster.find(p=>p.profile_id===state.selected);
      if(!target)return;
      const section=document.createElement('article');
      section.className='gc-profile-bio gc-pin-admin';
      section.dataset.gcPinAdmin='true';
      section.innerHTML=`<h2>Workstation PIN</h2><p>${target.pin_configured?'PIN is configured.':'PIN setup is required.'} Managers never see the employee PIN.</p><div class="gc-pin-actions"><button type="button" class="secondary-button" data-gc-reset-pin="${esc(target.profile_id)}">Reset PIN & DM employee</button></div><p class="gc-pin-message" data-gc-pin-admin-message></p>`;
      host.appendChild(section);
    }catch{}
  }
  async function managementReset(button){
    const id=button.dataset.gcResetPin;if(!id)return;
    const state=staffState();
    const target=state?.profiles?.find?.(p=>p.id===id);
    if(!confirm(`Reset the Front Desk workstation PIN for ${target?.display_name||'this employee'}? The current PIN will stop working immediately and Marlon will DM them on Discord.`))return;
    const out=button.closest('[data-gc-pin-admin]')?.querySelector('[data-gc-pin-admin-message]');
    button.disabled=true;if(out)out.textContent='Resetting…';
    try{
      const data=await rpc('request_operator_pin_reset',{target_profile:id});
      managementRoster=null;
      if(out){out.textContent=data?.message||'PIN reset.';out.className='gc-pin-message success'}
    }catch(error){if(out){out.textContent=error?.message||'Unable to reset PIN.';out.className='gc-pin-message error'}}
    finally{button.disabled=false}
  }

  function watchProfile(){
    const host=document.getElementById('gc-profile-view');
    if(!host||profileObserver)return;
    let queued=false;
    profileObserver=new MutationObserver(()=>{
      if(queued)return;queued=true;
      setTimeout(()=>{queued=false;void injectSelfCard();void injectManagementReset()},50);
    });
    profileObserver.observe(host,{childList:true,subtree:true});
  }

  function needsOperatorFor(target){
    if(!isWorkstation()||operatorFromStorage())return false;
    if(target.closest?.('#gc-operator-dialog,.gc-operator-pill,.sidebar,.topbar,[data-view]'))return false;
    return Boolean(target.closest?.('form,[data-open-ticket],[data-live-action],.primary-button,.danger-button'));
  }

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form?.matches?.('[data-gc-pin-form]')){event.preventDefault();void saveSelfPin(form);return}
    if(needsOperatorFor(form)){event.preventDefault();event.stopImmediatePropagation();void openPicker()}
  },true);
  document.addEventListener('click',event=>{
    const t=event.target instanceof Element?event.target:null;if(!t)return;
    if(t.closest('[data-gc-operator-picker]')){void openPicker();return}
    if(t.closest('[data-operator-close]')){ensureDialog().close();return}
    const person=t.closest('[data-operator-person]');if(person){const p=roster.find(x=>x.profile_id===person.dataset.operatorPerson);if(p){message('');renderPinStep(p)}return}
    if(t.closest('[data-operator-back]')){message('');renderRoster();return}
    if(t.closest('[data-operator-verify]')){void verifySelected();return}
    if(t.closest('[data-operator-forgot]')){void requestReset();return}
    const reset=t.closest('[data-gc-reset-pin]');if(reset){void managementReset(reset);return}
    if(needsOperatorFor(t)){event.preventDefault();event.stopImmediatePropagation();void openPicker()}
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target?.matches?.('[data-operator-pin]')){event.preventDefault();void verifySelected()}
  });
  document.addEventListener('gc-view-changed',()=>setTimeout(()=>{watchProfile();void injectSelfCard();void injectManagementReset()},100));
  document.addEventListener('gc-staff-profile-updated',()=>{selfStatus=null;managementRoster=null;setTimeout(()=>{void injectSelfCard();void injectManagementReset()},100)});
  document.addEventListener('gc-portal-runtime-ready',()=>{ensurePill();void restoreOperator();watchProfile();setTimeout(()=>{void injectSelfCard();void injectManagementReset()},120)});

  injectStyle();
  ensurePill();
  void restoreOperator();
  watchProfile();
  setTimeout(()=>{void injectSelfCard();void injectManagementReset()},250);
  window.GotCrackedOperatorPin={version:VERSION,openPicker,switchOperator,requestReset,get operator(){return operatorFromStorage()?.operator||null},get token(){return operatorFromStorage()?.token||null},require:()=>operatorFromStorage()?true:(void openPicker(),false)};
})();
