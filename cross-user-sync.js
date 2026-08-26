(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedCrossUserSync) return;

  const POLL_MS = 2500;
  const RETRY_MS = 5000;
  let lastRevision = null;
  let locationId = null;
  let pollBusy = false;
  let refreshBusy = false;
  let refreshQueued = false;
  let deferredForEditing = false;
  let realtimeChannel = null;
  let realtimeStatus = 'idle';
  let retryTimer = null;

  const isTraining = () => localStorage.getItem('gc-training-store') === '1';
  const isEditing = () => {
    const active = document.activeElement;
    if (!(active instanceof Element)) return false;
    return Boolean(active.closest('input, textarea, select, [contenteditable="true"]'));
  };

  async function fetchRevision() {
    if (isTraining()) return null;
    const result = await client.rpc('get_portal_sync_revision');
    if (result.error || !result.data) {
      if (result.error) console.warn('Cross-user sync revision unavailable:', result.error.message);
      return null;
    }
    const revision = Number(result.data.revision || 0);
    locationId = result.data.location_id || locationId;
    return Number.isFinite(revision) ? revision : 0;
  }

  async function refreshAll(reason = 'revision', revision = lastRevision) {
    if (isTraining()) return;
    if (isEditing()) {
      deferredForEditing = true;
      refreshQueued = true;
      return;
    }
    if (refreshBusy) {
      refreshQueued = true;
      return;
    }

    refreshBusy = true;
    deferredForEditing = false;
    try {
      const ops = window.GotCrackedOperationsV1;
      const workOrderId = ops?.state?.currentWorkOrder?.id || null;
      const workOrderVisible = document.getElementById('work-order')?.classList.contains('active-view');

      const jobs = [];
      if (typeof ops?.reload === 'function') jobs.push(Promise.resolve(ops.reload()));
      if (typeof window.GotCrackedStaffProfiles?.load === 'function') jobs.push(Promise.resolve(window.GotCrackedStaffProfiles.load()));
      window.GotCrackedDirectory?.requestRefresh?.();

      document.dispatchEvent(new CustomEvent('gc-cross-user-sync', {
        detail: { reason, revision, locationId }
      }));

      if (jobs.length) await Promise.allSettled(jobs);
      if (workOrderVisible && workOrderId && typeof ops?.openWorkOrder === 'function') {
        ops.openWorkOrder(workOrderId);
      }
    } finally {
      refreshBusy = false;
      if (refreshQueued && !isEditing()) {
        refreshQueued = false;
        queueMicrotask(() => refreshAll('queued', lastRevision));
      }
    }
  }

  function acceptRevision(revision, reason) {
    if (!Number.isFinite(revision)) return;
    if (lastRevision === null) {
      lastRevision = revision;
      return;
    }
    if (revision === lastRevision) return;
    lastRevision = revision;
    refreshAll(reason, revision);
  }

  async function pollNow() {
    if (pollBusy || isTraining() || document.visibilityState === 'hidden') return;
    pollBusy = true;
    try {
      const revision = await fetchRevision();
      if (revision !== null) acceptRevision(revision, 'revision-poll');
      if (locationId && !realtimeChannel) connectRealtime();
    } finally {
      pollBusy = false;
    }
  }

  async function connectRealtime() {
    if (realtimeChannel || !locationId || isTraining()) return;
    try {
      const { data:{ session } } = await client.auth.getSession();
      if (!session?.access_token) return;
      await client.realtime.setAuth(session.access_token);

      realtimeChannel = client
        .channel(`gc-cross-user-sync-${locationId}`)
        .on('postgres_changes', {
          event:'*', schema:'public', table:'portal_sync_state',
          filter:`location_id=eq.${locationId}`
        }, payload => {
          const revision = Number(payload.new?.revision ?? payload.old?.revision);
          acceptRevision(revision, 'realtime');
        })
        .subscribe(status => {
          realtimeStatus = status;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            const old = realtimeChannel;
            realtimeChannel = null;
            if (old) client.removeChannel(old).catch(() => {});
            clearTimeout(retryTimer);
            retryTimer = setTimeout(connectRealtime, RETRY_MS);
          }
        });
    } catch (error) {
      realtimeStatus = 'error';
      realtimeChannel = null;
      console.warn('Cross-user Realtime connection failed; revision polling remains active.', error);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectRealtime, RETRY_MS);
    }
  }

  function resumeDeferredRefresh() {
    if (!deferredForEditing && !refreshQueued) return;
    if (isEditing()) return;
    deferredForEditing = false;
    refreshQueued = false;
    refreshAll('editing-finished', lastRevision);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      lastRevision = null;
      locationId = null;
      if (realtimeChannel) client.removeChannel(realtimeChannel).catch(() => {});
      realtimeChannel = null;
      realtimeStatus = 'signed-out';
      return;
    }
    if (session && ['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'].includes(event)) {
      client.realtime.setAuth(session.access_token).catch(() => {});
      setTimeout(pollNow, 50);
    }
  });

  document.addEventListener('focusout', () => setTimeout(resumeDeferredRefresh, 100));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pollNow();
      if (!realtimeChannel) connectRealtime();
    }
  });
  window.addEventListener('online', () => {
    pollNow();
    if (!realtimeChannel) connectRealtime();
  });

  const interval = setInterval(pollNow, POLL_MS);
  setTimeout(pollNow, 100);

  window.GotCrackedCrossUserSync = {
    version:'20260826-sync2',
    pollNow,
    refreshNow:() => refreshAll('manual', lastRevision),
    get status(){ return { lastRevision, locationId, realtimeStatus, pollBusy, refreshBusy }; },
    stop(){ clearInterval(interval); clearTimeout(retryTimer); if (realtimeChannel) client.removeChannel(realtimeChannel).catch(() => {}); }
  };
})();
