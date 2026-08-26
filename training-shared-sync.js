(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedTrainingSync) return;

  const TRACKED_KEYS = new Set([
    'gc-training-data-v1',
    'gc-training-sales-v1',
    'gc-training-pricing-v1',
    'gc-training-receipts-v1',
    'gc-training-charge-parts'
  ]);
  const POLL_MS = 2000;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  let applyingRemote = false;
  let saveTimer = null;
  let lastRevision = null;
  let pollBusy = false;
  let pushBusy = false;
  let pushQueued = false;

  const isTraining = () => localStorage.getItem('gc-training-store') === '1';

  function localSnapshot() {
    const storage = {};
    for (const key of TRACKED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) storage[key] = value;
    }
    return { storage };
  }

  function applySnapshot(payload) {
    const storage = payload?.storage;
    if (!storage || typeof storage !== 'object') return;
    applyingRemote = true;
    try {
      for (const key of TRACKED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(storage,key)) {
          originalSetItem.call(localStorage,key,String(storage[key]));
        } else {
          originalRemoveItem.call(localStorage,key);
        }
      }
    } finally {
      applyingRemote = false;
    }
  }

  async function refreshTrainingUI() {
    const ops = window.GotCrackedOperationsV1;
    const workOrderId = ops?.state?.currentWorkOrder?.id || null;
    const workOrderVisible = document.getElementById('work-order')?.classList.contains('active-view');
    try { await ops?.reload?.(); } catch {}
    window.GotCrackedDirectory?.requestRefresh?.();
    const currentView = location.hash.slice(1).split('/')[0] || 'dashboard';
    window.GotCrackedTrainingGuard?.renderView?.(currentView);
    if (workOrderVisible && workOrderId) ops?.openWorkOrder?.(workOrderId);
    document.dispatchEvent(new CustomEvent('gc-training-shared-updated',{detail:{revision:lastRevision}}));
  }

  async function pull({ initial = false } = {}) {
    if (!isTraining() || pollBusy) return;
    pollBusy = true;
    try {
      const result = await client.rpc('get_training_store_state');
      if (result.error || !result.data) {
        if (result.error) console.warn('Shared Training Store read failed:',result.error.message);
        return;
      }
      const revision = Number(result.data.revision || 0);
      if (initial || lastRevision === null) {
        lastRevision = revision;
        if (revision > 0 && result.data.data && Object.keys(result.data.data).length) {
          applySnapshot(result.data.data);
        }
        return;
      }
      if (revision !== lastRevision) {
        lastRevision = revision;
        applySnapshot(result.data.data || {});
        await refreshTrainingUI();
      }
    } finally {
      pollBusy = false;
    }
  }

  async function push() {
    if (!isTraining() || applyingRemote) return;
    if (pushBusy) { pushQueued = true; return; }
    pushBusy = true;
    try {
      const result = await client.rpc('save_training_store_state',{ payload:localSnapshot() });
      if (result.error) {
        console.warn('Shared Training Store write failed:',result.error.message);
        return;
      }
      lastRevision = Number(result.data?.revision ?? lastRevision ?? 0);
    } finally {
      pushBusy = false;
      if (pushQueued) {
        pushQueued = false;
        setTimeout(push,50);
      }
    }
  }

  function schedulePush() {
    if (!isTraining() || applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push,180);
  }

  Storage.prototype.setItem = function(key,value) {
    originalSetItem.call(this,key,value);
    if (this === localStorage && TRACKED_KEYS.has(String(key)) && !applyingRemote) schedulePush();
  };
  Storage.prototype.removeItem = function(key) {
    originalRemoveItem.call(this,key);
    if (this === localStorage && TRACKED_KEYS.has(String(key)) && !applyingRemote) schedulePush();
  };

  const ready = (async () => {
    if (!isTraining()) return;
    await pull({initial:true});
    // A brand-new shared sandbox has no server payload yet. The normal Training
    // Store seed runs next; the patched setItem above will publish that seed.
  })();

  setInterval(() => {
    if (document.visibilityState === 'visible') pull();
  },POLL_MS);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') pull(); });
  window.addEventListener('online',()=>pull());

  window.GotCrackedTrainingSync = {
    version:'20260825-training-sync1',
    ready,
    pull,
    push,
    get revision(){ return lastRevision; }
  };
})();
