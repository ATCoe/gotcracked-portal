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
  const POLL_MS = 1500;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  let applyingRemote = false;
  let saveTimer = null;
  let lastRevision = null;
  let pollBusy = false;
  let pushBusy = false;
  let pushQueued = false;
  let lastRemoteUpdate = null;

  const isTraining = () => localStorage.getItem('gc-training-store') === '1';

  function localSnapshot() {
    const storage = {};
    for (const key of TRACKED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) storage[key] = value;
    }
    return { storage };
  }

  function hasLocalTrainingData() {
    return TRACKED_KEYS.has('gc-training-data-v1') && Boolean(localStorage.getItem('gc-training-data-v1'));
  }

  function applySnapshot(payload) {
    const storage = payload?.storage;
    if (!storage || typeof storage !== 'object') return false;
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
    return true;
  }

  async function refreshTrainingUI() {
    const ops = window.GotCrackedOperationsV1;
    const workOrderId = ops?.state?.currentWorkOrder?.id || null;
    const workOrderVisible = document.getElementById('work-order')?.classList.contains('active-view');
    try { await ops?.reload?.(); } catch (error) { console.warn('Training Store reload failed:', error); }
    window.GotCrackedDirectory?.requestRefresh?.();
    const currentView = location.hash.slice(1).split('/')[0] || 'dashboard';
    window.GotCrackedTrainingGuard?.renderView?.(currentView);
    if (workOrderVisible && workOrderId) ops?.openWorkOrder?.(workOrderId);
    document.dispatchEvent(new CustomEvent('gc-training-shared-updated',{detail:{revision:lastRevision,updatedAt:lastRemoteUpdate}}));
  }

  async function push() {
    if (!isTraining() || applyingRemote) return false;
    if (pushBusy) { pushQueued = true; return false; }
    pushBusy = true;
    try {
      const result = await client.rpc('save_training_store_state',{ payload:localSnapshot() });
      if (result.error) {
        console.warn('Shared Training Store write failed:',result.error.message);
        return false;
      }
      lastRevision = Number(result.data?.revision ?? lastRevision ?? 0);
      lastRemoteUpdate = result.data?.updated_at || new Date().toISOString();
      return true;
    } finally {
      pushBusy = false;
      if (pushQueued) {
        pushQueued = false;
        setTimeout(push,40);
      }
    }
  }

  async function pull({ initial = false } = {}) {
    if (!isTraining() || pollBusy) return false;
    pollBusy = true;
    try {
      const result = await client.rpc('get_training_store_state');
      if (result.error || !result.data) {
        if (result.error) console.warn('Shared Training Store read failed:',result.error.message);
        return false;
      }

      const revision = Number(result.data.revision || 0);
      lastRemoteUpdate = result.data.updated_at || lastRemoteUpdate;
      const remotePayload = result.data.data || {};
      const hasRemoteStorage = Boolean(remotePayload?.storage && Object.keys(remotePayload.storage).length);

      if (initial || lastRevision === null) {
        lastRevision = revision;
        if (revision > 0 && hasRemoteStorage) {
          applySnapshot(remotePayload);
        } else if (revision === 0 && hasLocalTrainingData()) {
          // Existing browsers often already have a seeded Training Store. Publish
          // that state immediately instead of waiting for a later edit to happen.
          pollBusy = false;
          await push();
          return true;
        }
        return true;
      }

      if (revision !== lastRevision) {
        lastRevision = revision;
        if (hasRemoteStorage) applySnapshot(remotePayload);
        await refreshTrainingUI();
      }
      return true;
    } finally {
      pollBusy = false;
    }
  }

  function schedulePush() {
    if (!isTraining() || applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push,90);
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
    // Pull again after Operations has had time to seed a brand-new sandbox.
    setTimeout(() => {
      if (lastRevision === 0 && hasLocalTrainingData()) push();
    },700);
  })();

  setInterval(() => {
    if (document.visibilityState === 'visible') pull();
  },POLL_MS);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') pull(); });
  window.addEventListener('online',()=>pull());

  window.GotCrackedTrainingSync = {
    version:'20260825-training-sync2',
    ready,
    pull,
    push,
    get revision(){ return lastRevision; },
    get status(){ return { revision:lastRevision,pollBusy,pushBusy,lastRemoteUpdate }; }
  };
})();
