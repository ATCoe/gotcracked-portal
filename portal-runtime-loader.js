(() => {
  'use strict';

  const VERSION = '20260902-global-master-data2';
  const ACCOUNT_PAGE_VERSION = '20260826-account-page2';
  const SALES_OPS_VERSION = '20260827-reconciliation2';
  const APPOINTMENTS_VERSION = '20260827-production9';
  const CUSTOMERS_VERSION = '20260902-global-master-data1';
  const PROFILE_READY_TIMEOUT_MS = 15000;

  const criticalScripts = [
    'theme-controller.js','training-shared-sync.js','runtime-stability.js','mobile-runtime-regression-fixes.js','portal-refresh-stability.js','operations-v1-core.js',
    'operator-request-context.js','workstation-mode.js','payment-center.js','portal-current-ui-fixes.js','mobile-dialog-compat.js','action-launchers.js','account-sync.js','time-clock.js','portal-deep-links.js','operations-v1-arrival.js','portal-v1-polish.js','intake-profile-validation-fix.js','portal-mobile-audit.js','portal-v1-final.js','ui-title-case.js','directory-advanced.js','master-directory.js','cross-user-sync.js','sales-ops.js','marlon-reporting-bridge.js','dashboard-rail.js','reporting-bookkeeper.js','reporting-capacity-enhancements.js'
  ];

  const deferredScripts = [
    'workforce-premium.js','timesheets.js','avatar-presets.js','staff-profiles.js','account-page.js','premium-onboarding-v2.js','training-store-guard.js','pc-builds.js','checkout-receipts.js','schedule-board.js','schedule-print.js','analytics.js','shipping.js','inventory-audit.js'
  ];

  const viewDependencies = {
    repairs:['checkout-receipts.js','part-availability-workflow.js'],
    'work-order':['part-availability-workflow.js'],
    appointments:['appointments-board.js','appointments-owner-guard.js'],
    schedule: ['schedule-board.js','schedule-print.js'],
    customers: ['customers-board.js'],
    reports:['analytics.js','reconciliation-center.js','reporting-bookkeeper.js','reporting-capacity-enhancements.js'],
    shipping:['shipping.js','shipping-integrated.js','shipping-marlon-support.js'],
    inventory:['inventory-command-center.js','inventory-audit.js','parts-registry.js','shipping-marlon-support.js','rma-flow-labs.js'],
    staff:['avatar-presets.js','staff-profiles.js','account-page.js','premium-onboarding-v2.js','workforce-premium.js','timesheets.js'],
    settings:['business-settings.js','google-settings-integration.js','pricing-settings.js','procurement-settings.js','mobilesentrix-integration.js','shipping-integrated.js','shipping-marlon-support.js','reporting-capacity-enhancements.js','workstation-admin.js']
  };

  let started=false,deferredStarted=false,deferredScheduled=false,profileReady=null,accountSyncReady=null,accountSyncWaited=false,trainingSyncReady=null,trainingResyncWired=false;
  const loading=new Map(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),isTraining=()=>localStorage.getItem('gc-training-store')==='1';
  const profileIndependentScripts=new Set(['theme-controller.js','training-shared-sync.js','runtime-stability.js','mobile-runtime-regression-fixes.js','portal-refresh-stability.js','operations-v1-core.js']);

  function srcFor(file){const versions={'account-page.js':ACCOUNT_PAGE_VERSION,'sales-ops.js':SALES_OPS_VERSION,'appointments-board.js':APPOINTMENTS_VERSION,'appointments-owner-guard.js':APPOINTMENTS_VERSION,'customers-board.js':CUSTOMERS_VERSION};return `${file}?v=${versions[file]||VERSION}`;}
  function preload(files){for(const file of files){if(document.querySelector(`link[data-gc-runtime-preload="${file}"]`))continue;const link=document.createElement('link');link.rel='preload';link.as='script';link.href=srcFor(file);link.dataset.gcRuntimePreload=file;document.head.appendChild(link);}}
  function loadScript(file){if(document.querySelector(`script[data-gc-runtime="${file}"]`))return Promise.resolve();if(loading.has(file))return loading.get(file);const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=srcFor(file);script.async=false;script.dataset.gcRuntime=file;script.addEventListener('load',resolve,{once:true});script.addEventListener('error',()=>reject(new Error(`Failed to load ${file}`)),{once:true});document.body.appendChild(script);}).finally(()=>loading.delete(file));loading.set(file,promise);return promise;}
  function protectedRuntimeAllowed(){const login=document.getElementById('login-screen');return !login||login.classList.contains('hidden');}
  async function waitForOperationsProfile(){if(profileReady?.id&&profileReady?.location_id)return profileReady;const startedAt=Date.now();while(Date.now()-startedAt<PROFILE_READY_TIMEOUT_MS){const profile=window.GotCrackedOperationsV1?.state?.profile||null;if(profile?.id&&profile?.location_id&&profile.active!==false){profileReady=profile;window.GotCrackedRuntimeProfile=profile;document.documentElement.dataset.gcProfileReady='true';return profile;}await delay(100);}throw new Error('Staff profile did not finish loading. Refresh the Portal and try again.');}
  function captureTrainingSyncReady(){if(trainingSyncReady)return trainingSyncReady;const ready=window.GotCrackedTrainingSync?.ready;if(!ready)return null;trainingSyncReady=Promise.resolve(ready).catch(error=>{console.warn('Shared Training Store sync did not finish during startup; local sandbox data remains available.',error);return null;});return trainingSyncReady;}
  function wireTrainingResyncAfterOperations(){if(trainingResyncWired)return;const ready=captureTrainingSyncReady();if(!ready)return;trainingSyncReady=ready;trainingResyncWired=true;ready.then(()=>{if(!isTraining())return;const ops=window.GotCrackedOperationsV1;if(typeof ops?.reload!=='function')return;requestAnimationFrame(()=>Promise.resolve(ops.reload()).catch(error=>console.warn('Training Store post-sync refresh failed:',error)));});}
  function captureAccountSyncReady(){if(accountSyncReady)return accountSyncReady;const ready=window.GotCrackedAccountSync?.ready;if(!ready)return null;accountSyncReady=Promise.resolve(ready).catch(error=>{console.warn('Account preference sync did not finish during startup; local Portal preferences remain available.',error);return null;});return accountSyncReady;}
  async function waitForAccountSyncBeforeDirectory(){if(accountSyncWaited)return;accountSyncWaited=true;const ready=captureAccountSyncReady();if(ready)await ready;}
  async function loadSequence(files){for(const file of files){if(!profileIndependentScripts.has(file))await waitForOperationsProfile();if(file==='directory-advanced.js'||file==='master-directory.js')await waitForAccountSyncBeforeDirectory();await loadScript(file);if(file==='training-shared-sync.js')captureTrainingSyncReady();if(file==='operations-v1-core.js'){await waitForOperationsProfile();wireTrainingResyncAfterOperations();}if(file==='account-sync.js')captureAccountSyncReady();if(file==='account-page.js'&&window.GotCrackedAccountPage?.ready)await window.GotCrackedAccountPage.ready;}}
  function scheduleDeferredRuntime(){if(deferredScheduled||deferredStarted)return;deferredScheduled=true;const run=()=>{deferredScheduled=false;void startDeferredRuntime()};if('requestIdleCallback'in window)window.requestIdleCallback(run,{timeout:2500});else setTimeout(run,1200);}
  async function startCriticalRuntime(){if(started||!protectedRuntimeAllowed())return;started=true;document.documentElement.dataset.gcRuntimeState='starting';document.documentElement.dataset.gcPortalBoot='loading';preload(criticalScripts);try{await loadSequence(criticalScripts);const currentView=location.hash.slice(1).split('/')[0]||'dashboard';await ensureViewRuntime(currentView);document.documentElement.dataset.gcRuntimeState='ready';document.documentElement.dataset.gcPortalBoot='ready';document.dispatchEvent(new CustomEvent('gc-portal-runtime-ready',{detail:{profile:profileReady}}));scheduleDeferredRuntime();}catch(error){console.error('Portal critical runtime load failed:',error);document.documentElement.dataset.gcRuntimeState='error';document.documentElement.dataset.gcPortalBoot='error';window.GotCrackedDiagnostics?.error?.(error,{context:'Portal staff profile initialization failed',duration:20000});started=false;}}
  async function startDeferredRuntime(){if(deferredStarted||!protectedRuntimeAllowed())return;deferredStarted=true;try{await waitForOperationsProfile();await loadSequence(deferredScripts);document.dispatchEvent(new CustomEvent('gc-portal-secondary-runtime-ready'));}catch(error){console.error('Portal deferred runtime load failed:',error);window.GotCrackedDiagnostics?.error?.(error,{context:'A secondary Portal module could not be loaded'});deferredStarted=false;}}
  async function ensureViewRuntime(view){if(!protectedRuntimeAllowed())return;const files=viewDependencies[view]||[];if(!files.length)return;try{await waitForOperationsProfile();await loadSequence(files);}catch(error){console.error(`Portal ${view} runtime load failed:`,error);window.GotCrackedDiagnostics?.error?.(error,{context:`Unable to open ${view}`});}}
  function scheduleCriticalStart(){requestAnimationFrame(()=>requestAnimationFrame(startCriticalRuntime));}
  function watchLoginState(){const login=document.getElementById('login-screen');if(!login)return;if(login.classList.contains('hidden')){scheduleCriticalStart();return;}const observer=new MutationObserver(()=>{if(!login.classList.contains('hidden'))return;observer.disconnect();scheduleCriticalStart();});observer.observe(login,{attributes:true,attributeFilter:['class']});}
  document.addEventListener('gc-view-changed',event=>{const view=typeof event.detail==='string'?event.detail:(location.hash.slice(1).split('/')[0]||'dashboard');if(view)ensureViewRuntime(view);});
  window.addEventListener('hashchange',()=>{const view=location.hash.slice(1).split('/')[0];if(view)ensureViewRuntime(view);});
  window.GotCrackedRuntime={ensureView:ensureViewRuntime,startDeferred:startDeferredRuntime,waitForProfile:waitForOperationsProfile,get profile(){return profileReady;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchLoginState,{once:true});else watchLoginState();
})();

