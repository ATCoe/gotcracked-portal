(() => {
  'use strict';

  const VERSION = '20260826-release34';
  const MOBILE_TRACE_VERSION = '20260826-touch3';
  const ACCOUNT_PAGE_VERSION = '20260826-account-page2';
  const PROFILE_READY_TIMEOUT_MS = 15000;

  const criticalScripts = [
    'theme-controller.js',
    'training-shared-sync.js',
    'operations-v1-core.js',
    'mobile-interaction-debug.js',
    'mobile-dialog-compat.js',
    'action-launchers.js',
    'account-sync.js',
    'time-clock.js',
    'timesheets.js',
    'portal-live.js',
    'avatar-presets.js',
    'staff-profiles.js',
    'account-page.js',
    'training-store-guard.js',
    'operations-v1-arrival.js',
    'portal-v1-polish.js',
    'portal-mobile-audit.js',
    'portal-v1-final.js',
    'intake-modal-release.js',
    'directory-advanced.js',
    'master-directory.js',
    'cross-user-sync.js',
    'sales-ops-bootstrap.js',
    'sales-ops.js',
    'checkout-receipts.js'
  ];

  const deferredScripts = [
    'leads.js',
    'schedule-board.js',
    'schedule-print.js',
    'analytics.js',
    'shipping.js',
    'inventory-audit.js'
  ];

  const viewDependencies = {
    leads: ['leads.js'],
    schedule: ['schedule-board.js','schedule-print.js'],
    reports: ['analytics.js'],
    shipping: ['shipping.js'],
    inventory: ['inventory-audit.js'],
    settings: ['pricing-settings.js']
  };

  let started = false;
  let deferredStarted = false;
  let profileReady = null;
  let accountSyncReady = null;
  let accountSyncWaited = false;
  let trainingSyncReady = null;
  let trainingResyncWired = false;
  const loading = new Map();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isTraining = () => localStorage.getItem('gc-training-store') === '1';

  function srcFor(file) {
    const versions = {
      'mobile-interaction-debug.js': MOBILE_TRACE_VERSION,
      'account-page.js': ACCOUNT_PAGE_VERSION
    };
    return `${file}?v=${versions[file] || VERSION}`;
  }

  function preload(files) {
    for (const file of files) {
      if (document.querySelector(`link[data-gc-runtime-preload="${file}"]`)) continue;
      const link=document.createElement('link');
      link.rel='preload';
      link.as='script';
      link.href=srcFor(file);
      link.dataset.gcRuntimePreload=file;
      document.head.appendChild(link);
    }
  }

  function loadScript(file) {
    if (document.querySelector(`script[data-gc-runtime="${file}"]`)) return Promise.resolve();
    if (loading.has(file)) return loading.get(file);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=srcFor(file);
      script.async=false;
      script.dataset.gcRuntime=file;
      script.addEventListener('load',resolve,{once:true});
      script.addEventListener('error',()=>reject(new Error(`Failed to load ${file}`)),{once:true});
      document.body.appendChild(script);
    }).finally(()=>loading.delete(file));
    loading.set(file,promise);
    return promise;
  }

  async function waitForOperationsProfile() {
    if (profileReady?.id&&profileReady?.location_id) return profileReady;
    const startedAt=Date.now();
    while(Date.now()-startedAt<PROFILE_READY_TIMEOUT_MS){
      const profile=window.GotCrackedOperationsV1?.state?.profile||null;
      if(profile?.id&&profile?.location_id&&profile.active!==false){
        profileReady=profile;
        window.GotCrackedRuntimeProfile=profile;
        document.documentElement.dataset.gcProfileReady='true';
        return profile;
      }
      await delay(100);
    }
    throw new Error('Staff profile did not finish loading. Refresh the Portal and try again.');
  }

  function captureTrainingSyncReady(){
    if(trainingSyncReady) return trainingSyncReady;
    const ready=window.GotCrackedTrainingSync?.ready;
    if(!ready) return null;
    trainingSyncReady=Promise.resolve(ready).catch(error=>{
      console.warn('Shared Training Store sync did not finish during startup; local sandbox data remains available.',error);
      return null;
    });
    return trainingSyncReady;
  }

  function wireTrainingResyncAfterOperations(){
    if(trainingResyncWired) return;
    const ready=captureTrainingSyncReady();
    if(!ready) return;
    trainingResyncWired=true;
    ready.then(()=>{
      if(!isTraining()) return;
      const ops=window.GotCrackedOperationsV1;
      if(typeof ops?.reload!=='function') return;
      requestAnimationFrame(()=>Promise.resolve(ops.reload()).catch(error=>console.warn('Training Store post-sync refresh failed:',error)));
    });
  }

  function captureAccountSyncReady(){
    if(accountSyncReady) return accountSyncReady;
    const ready=window.GotCrackedAccountSync?.ready;
    if(!ready) return null;
    accountSyncReady=Promise.resolve(ready).catch(error=>{
      console.warn('Account preference sync did not finish during startup; local Portal preferences remain available.',error);
      return null;
    });
    return accountSyncReady;
  }

  async function waitForAccountSyncBeforeDirectory(){
    if(accountSyncWaited) return;
    accountSyncWaited=true;
    const ready=captureAccountSyncReady();
    if(ready) await ready;
  }

  async function loadSequence(files) {
    for(const file of files){
      if(file!=='theme-controller.js'&&file!=='training-shared-sync.js'&&file!=='operations-v1-core.js') await waitForOperationsProfile();

      if(file==='directory-advanced.js'||file==='master-directory.js') await waitForAccountSyncBeforeDirectory();

      await loadScript(file);
      if(file==='training-shared-sync.js') captureTrainingSyncReady();
      if(file==='operations-v1-core.js') {
        await waitForOperationsProfile();
        wireTrainingResyncAfterOperations();
      }
      if(file==='account-sync.js') captureAccountSyncReady();
      if(file==='account-page.js'&&window.GotCrackedAccountPage?.ready) await window.GotCrackedAccountPage.ready;
    }
  }

  async function ensureStoreModeRuntime(){
    if(isTraining()) return;
    try { await loadScript('portal-live.js'); }
    catch(error){ console.error('Portal live-data runtime load failed:',error); }
  }

  async function startCriticalRuntime(){
    if(started)return;
    started=true;
    document.documentElement.dataset.gcRuntimeState='starting';
    document.documentElement.dataset.gcPortalBoot='loading';
    const files=isTraining() ? criticalScripts.filter(file=>file!=='portal-live.js') : criticalScripts.filter(file=>file!=='mobile-interaction-debug.js');
    preload(files);
    try{
      await loadSequence(files);
      const currentView=location.hash.slice(1).split('/')[0]||'dashboard';
      await ensureViewRuntime(currentView);
      document.documentElement.dataset.gcRuntimeState='ready';
      document.documentElement.dataset.gcPortalBoot='ready';
      document.dispatchEvent(new CustomEvent('gc-portal-runtime-ready',{detail:{profile:profileReady}}));
      // Secondary views are view-scoped. Do not bulk-load them after dashboard boot.
    }catch(error){
      console.error('Portal critical runtime load failed:',error);
      document.documentElement.dataset.gcRuntimeState='error';
      document.documentElement.dataset.gcPortalBoot='error';
      window.GotCrackedDiagnostics?.error?.(error,{context:'Portal staff profile initialization failed',duration:20000});
      started=false;
    }
  }

  async function startDeferredRuntime(){
    if(deferredStarted)return;
    deferredStarted=true;
    try{
      await waitForOperationsProfile();
      await loadSequence(deferredScripts);
      document.dispatchEvent(new CustomEvent('gc-portal-secondary-runtime-ready'));
    }catch(error){
      console.error('Portal deferred runtime load failed:',error);
      deferredStarted=false;
    }
  }

  async function ensureViewRuntime(view){
    const files=viewDependencies[view]||[];
    if(!files.length)return;
    try{
      await waitForOperationsProfile();
      await loadSequence(files);
    }catch(error){
      console.error(`Portal ${view} runtime load failed:`,error);
      window.GotCrackedDiagnostics?.error?.(error,{context:`Unable to open ${view}`});
    }
  }

  function scheduleCriticalStart(){
    const run=()=>startCriticalRuntime();
    requestAnimationFrame(()=>requestAnimationFrame(run));
  }

  function watchLoginState(){
    const login=document.getElementById('login-screen');
    if(!login)return;
    if(login.classList.contains('hidden')){scheduleCriticalStart();return;}
    const observer=new MutationObserver(()=>{
      if(!login.classList.contains('hidden'))return;
      observer.disconnect();
      scheduleCriticalStart();
    });
    observer.observe(login,{attributes:true,attributeFilter:['class']});
  }

  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target.closest('[data-view]'):null;
    const view=target?.dataset.view;
    if(view)ensureViewRuntime(view);
  },true);

  document.addEventListener('gc-view-changed',event=>{
    const view=typeof event.detail==='string'?event.detail:(location.hash.slice(1).split('/')[0]||'dashboard');
    if(view)ensureViewRuntime(view);
    if(!isTraining()) ensureStoreModeRuntime();
  });

  window.addEventListener('hashchange',()=>{
    const view=location.hash.slice(1).split('/')[0];
    if(view)ensureViewRuntime(view);
  });

  window.GotCrackedRuntime={
    ensureView:ensureViewRuntime,
    startDeferred:startDeferredRuntime,
    waitForProfile:waitForOperationsProfile,
    get profile(){return profileReady;}
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchLoginState,{once:true});
  else watchLoginState();
})();