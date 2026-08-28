(()=>{
  'use strict';
  if(window.GotCrackedWorkstationMode)return;

  const WORKSTATION='shared_workstation';
  const OPERATOR_PIN_VERSION='20260828-operator-pin1';
  const ALLOWED_VIEWS=new Set([
    'dashboard','repairs','work-order','ready-pickup','leads',
    'appointments','customers','inventory','repair-reference'
  ]);
  let active=false;
  let sidebarObserver=null;

  const profile=()=>window.GotCrackedRuntimeProfile||window.GotCrackedOperationsV1?.state?.profile||null;
  const isWorkstation=p=>p?.account_type===WORKSTATION;

  function loadOperatorPinModule(){
    if(window.GotCrackedOperatorPin||document.querySelector('script[data-gc-operator-pin]'))return;
    const script=document.createElement('script');
    script.src=`operator-pin.js?v=${OPERATOR_PIN_VERSION}`;
    script.async=false;
    script.dataset.gcOperatorPin='true';
    script.addEventListener('error',()=>window.GotCrackedDiagnostics?.error?.('Operator PIN runtime failed to load.',{context:'Shared workstation identity'}),{once:true});
    document.body.appendChild(script);
  }

  function injectStyle(){
    if(document.getElementById('gc-workstation-mode-style'))return;
    const style=document.createElement('style');
    style.id='gc-workstation-mode-style';
    style.textContent=`
      html[data-account-type="shared_workstation"] .gc-workstation-hidden{display:none!important}
      html[data-account-type="shared_workstation"] #gc-dashboard-sales-slot,
      html[data-account-type="shared_workstation"] #gc-dashboard-day-controls,
      html[data-account-type="shared_workstation"] #dashboard-time-clock,
      html[data-account-type="shared_workstation"] #dashboard .gc-recognition,
      html[data-account-type="shared_workstation"] #dashboard .metrics article:nth-child(4){display:none!important}
      .gc-workstation-badge{display:inline-flex;align-items:center;gap:7px;min-height:30px;padding:5px 10px;border:1px solid rgba(54,153,255,.24);border-radius:999px;background:rgba(42,143,247,.09);color:#287dcc;font-size:11px;font-weight:850;white-space:nowrap}
      .gc-workstation-badge::before{content:'•';font-size:17px;line-height:0;color:#2a8ef7}
      html[data-theme="dark"] .gc-workstation-badge{background:rgba(77,163,255,.10);border-color:rgba(77,163,255,.25);color:#8dc6ff}
      html[data-account-type="shared_workstation"] .sidebar .profile{border-color:rgba(77,163,255,.18)}
      @media(max-width:750px){.gc-workstation-badge{max-width:150px;overflow:hidden;text-overflow:ellipsis}.gc-workstation-badge span{display:none}}
    `;
    document.head.appendChild(style);
  }

  function currentView(){return location.hash.slice(1).split('/')[0]||'dashboard'}

  function decorateIdentity(p){
    const name=document.getElementById('staff-name');
    const role=document.getElementById('staff-role');
    if(name)name.textContent=p?.display_name||'Front Desk Workstation';
    if(role)role.textContent='Shared shop login · Basic workflow only';
    let badge=document.querySelector('.gc-workstation-badge');
    if(!badge){
      badge=document.createElement('span');
      badge.className='gc-workstation-badge';
      badge.innerHTML='Shared workstation <span>· Basic workflow only</span>';
      const locationNode=document.querySelector('.topbar .location');
      locationNode?.insertAdjacentElement('afterend',badge);
    }
  }

  function restrictNavigation(){
    document.querySelectorAll('[data-view]').forEach(node=>{
      const view=node.dataset.view;
      if(!view)return;
      node.classList.toggle('gc-workstation-hidden',!ALLOWED_VIEWS.has(view));
    });
    document.querySelectorAll('[href^="#"]').forEach(node=>{
      const view=(node.getAttribute('href')||'').slice(1).split('/')[0];
      if(view&&!ALLOWED_VIEWS.has(view)&&node.closest('.sidebar,.gc-mobile-nav'))node.classList.add('gc-workstation-hidden');
    });
  }

  function restrictDashboard(){
    document.querySelectorAll('#gc-dashboard-sales-slot,#gc-dashboard-day-controls,#dashboard-time-clock,#dashboard .gc-recognition').forEach(node=>node.classList.add('gc-workstation-hidden'));
  }

  function guardRoute(){
    if(!active)return;
    const view=currentView();
    if(!ALLOWED_VIEWS.has(view))location.replace(`${location.pathname}${location.search}#dashboard`);
  }

  function watchDynamicNavigation(){
    if(sidebarObserver)return;
    const shell=document.querySelector('.sidebar');
    if(!shell)return;
    sidebarObserver=new MutationObserver(()=>restrictNavigation());
    sidebarObserver.observe(shell,{childList:true,subtree:true});
  }

  function apply(nextProfile=profile()){
    active=isWorkstation(nextProfile);
    document.documentElement.dataset.accountType=active?WORKSTATION:'staff';
    loadOperatorPinModule();
    if(!active)return false;
    injectStyle();
    decorateIdentity(nextProfile);
    restrictNavigation();
    restrictDashboard();
    watchDynamicNavigation();
    guardRoute();
    document.dispatchEvent(new CustomEvent('gc-workstation-mode',{detail:{active:true,profile:nextProfile}}));
    return true;
  }

  window.addEventListener('hashchange',guardRoute);
  window.addEventListener('gotcracked:staff-ready',event=>apply(event.detail));
  document.addEventListener('gc-portal-runtime-ready',event=>apply(event.detail?.profile));
  document.addEventListener('gc-view-changed',()=>{if(active){restrictNavigation();restrictDashboard();guardRoute();}});
  document.addEventListener('gc-staff-profile-updated',()=>setTimeout(()=>apply(),50));

  setTimeout(()=>apply(),0);
  window.GotCrackedWorkstationMode={version:'1.1.0',apply,get active(){return active},allowedViews:[...ALLOWED_VIEWS]};
})();
