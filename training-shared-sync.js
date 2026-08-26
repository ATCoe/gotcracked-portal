(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedTrainingSync) return;

  const TRACKED_KEYS = [
    'gc-training-data-v1',
    'gc-training-sales-v1',
    'gc-training-pricing-v1',
    'gc-training-receipts-v1',
    'gc-training-charge-parts'
  ];
  const POLL_MS = 1200;

  let applyingRemote = false;
  let lastRevision = null;
  let lastLocalFingerprint = null;
  let pollBusy = false;
  let pushBusy = false;
  let pushQueued = false;
  let lastRemoteUpdate = null;
  let interval = null;

  const isTraining = () => localStorage.getItem('gc-training-store') === '1';

  function localSnapshot() {
    const storage = {};
    for (const key of TRACKED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) storage[key] = value;
    }
    return { storage };
  }

  function fingerprint(snapshot = localSnapshot()) {
    return JSON.stringify(snapshot.storage || {});
  }

  function hasLocalTrainingData() {
    return Boolean(localStorage.getItem('gc-training-data-v1'));
  }

  function applySnapshot(payload) {
    const storage = payload?.storage;
    if (!storage || typeof storage !== 'object') return false;

    applyingRemote = true;
    try {
      for (const key of TRACKED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(storage, key)) {
          localStorage.setItem(key, String(storage[key]));
        } else {
          localStorage.removeItem(key);
        }
      }
      lastLocalFingerprint = fingerprint();
    } finally {
      applyingRemote = false;
    }
    return true;
  }

  async function refreshTrainingUI() {
    const ops = window.GotCrackedOperationsV1;
    const workOrderId = ops?.state?.currentWorkOrder?.id || null;
    const workOrderVisible = document.getElementById('work-order')?.classList.contains('active-view');

    try { await ops?.reload?.(); }
    catch (error) { console.warn('Training Store reload failed:', error); }

    window.GotCrackedDirectory?.requestRefresh?.();
    const currentView = location.hash.slice(1).split('/')[0] || 'dashboard';
    window.GotCrackedTrainingGuard?.renderView?.(currentView);
    if (workOrderVisible && workOrderId) ops?.openWorkOrder?.(workOrderId);

    document.dispatchEvent(new CustomEvent('gc-training-shared-updated', {
      detail: { revision: lastRevision, updatedAt: lastRemoteUpdate }
    }));
  }

  async function push() {
    if (!isTraining() || applyingRemote) return false;
    if (pushBusy) {
      pushQueued = true;
      return false;
    }

    pushBusy = true;
    const snapshot = localSnapshot();
    const pushedFingerprint = fingerprint(snapshot);

    try {
      const result = await client.rpc('save_training_store_state', { payload: snapshot });
      if (result.error) {
        console.error('Shared Training Store write failed:', result.error.message);
        return false;
      }

      lastRevision = Number(result.data?.revision ?? lastRevision ?? 0);
      lastRemoteUpdate = result.data?.updated_at || new Date().toISOString();
      lastLocalFingerprint = pushedFingerprint;
      document.dispatchEvent(new CustomEvent('gc-training-shared-pushed', {
        detail: { revision: lastRevision, updatedAt: lastRemoteUpdate }
      }));
      return true;
    } finally {
      pushBusy = false;
      if (pushQueued) {
        pushQueued = false;
        setTimeout(push, 25);
      }
    }
  }

  async function pull({ initial = false } = {}) {
    if (!isTraining() || pollBusy || pushBusy) return false;
    pollBusy = true;

    try {
      const result = await client.rpc('get_training_store_state');
      if (result.error || !result.data) {
        if (result.error) console.error('Shared Training Store read failed:', result.error.message);
        return false;
      }

      const revision = Number(result.data.revision || 0);
      const remotePayload = result.data.data || {};
      const remoteHasStorage = Boolean(remotePayload?.storage && Object.keys(remotePayload.storage).length);
      lastRemoteUpdate = result.data.updated_at || lastRemoteUpdate;

      if (initial || lastRevision === null) {
        lastRevision = revision;
        if (revision > 0 && remoteHasStorage) {
          applySnapshot(remotePayload);
        } else {
          lastLocalFingerprint = fingerprint();
          if (hasLocalTrainingData()) {
            pollBusy = false;
            await push();
            return true;
          }
        }
        return true;
      }

      const currentFingerprint = fingerprint();
      const localDirty = lastLocalFingerprint !== null && currentFingerprint !== lastLocalFingerprint;

      // A local Training Store edit is authoritative for this tick. Push it first
      // instead of allowing a poll to overwrite unsaved browser state.
      if (localDirty) {
        pollBusy = false;
        await push();
        return true;
      }

      if (revision !== lastRevision) {
        lastRevision = revision;
        if (remoteHasStorage) applySnapshot(remotePayload);
        await refreshTrainingUI();
      }

      return true;
    } finally {
      pollBusy = false;
    }
  }

  async function tick() {
    if (!isTraining() || document.visibilityState === 'hidden' || applyingRemote) return;

    const currentFingerprint = fingerprint();
    if (lastLocalFingerprint !== null && currentFingerprint !== lastLocalFingerprint) {
      await push();
      return;
    }
    await pull();
  }

  function scheduleMutationCheck() {
    if (!isTraining()) return;
    setTimeout(tick, 80);
    setTimeout(tick, 300);
  }

  // These listeners are intentionally generic. Training workflows mutate local
  // state in several modules; fingerprinting after user actions guarantees those
  // changes are published even if a module forgets to call the sync API directly.
  document.addEventListener('click', scheduleMutationCheck, true);
  document.addEventListener('submit', scheduleMutationCheck, true);
  document.addEventListener('change', scheduleMutationCheck, true);

  const ready = (async () => {
    if (!isTraining()) return;
    await pull({ initial: true });
    lastLocalFingerprint = fingerprint();
  })();

  interval = setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('online', tick);

  window.GotCrackedTrainingSync = {
    version: '20260825-training-sync3',
    ready,
    pull,
    push,
    tick,
    markDirty: scheduleMutationCheck,
    get revision() { return lastRevision; },
    get status() {
      return {
        revision: lastRevision,
        pollBusy,
        pushBusy,
        lastRemoteUpdate,
        localDirty: lastLocalFingerprint !== null && fingerprint() !== lastLocalFingerprint
      };
    },
    stop() { if (interval) clearInterval(interval); }
  };
})();
