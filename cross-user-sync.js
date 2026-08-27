(() => {
  'use strict';

  const client = window.supabaseClient;
  if (!client || window.GotCrackedCrossUserSync) return;

  const POLL_MS = 10000;
  const RETRY_MS = 5000;
  let lastRevision = null;
  let locationId = null;
  let pollBusy = false;
  let refreshBusy = false;
  let refreshQueued = false;
  let deferredForInteraction = false;
  let realtimeChannel = null;
  let realtimeStatus = 'idle';
  let retryTimer = null;

  const isTraining = () => localStorage.getItem('gc-training-store') === '1';
  let lastTrainingMode = isTraining();
  const localInteractionLocked = () => {
    if (document.visibilityState === 'hidden') return true;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('input,textarea,select,[contenteditable="true"]')) return true;
    if (document.querySelector('dialog[open]')) return true;
    if (document.getElementById('v1-lead-drawer')?.classList.contains('open')) return true;
    return false;
  };
  const interactionLocked = () => window.GotCrackedRuntimeStability?.isInteractionLocked?.() ?? localInteractionLocked();

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
    if (interactionLocked()) {
      deferredForInteraction = true;
      refreshQueued = true;
      return;
    }
    if (refreshBusy) {
      refreshQueued = true;
      return;
    }

    refreshBusy = true;
    deferredForInteraction = false;
    const snapshot = window.GotCrackedRefreshStability?.capture?.(`cross-user-${reason}`) || null;
    try {
      // operations-v1-core owns the core work-order/customer/lead realtime state.
      // Cross-user sync is now only the revision broadcaster for specialized
      // modules. Calling ops.reload() here used to create a second full renderer
      // and was responsible for active-view/scroll resets during server sync.
      const jobs = [];
      if (typeof window.GotCrackedStaffProfiles?.load === 'function') jobs.push(Promise.resolve(window.GotCrackedStaffProfiles.load()));
      if (jobs.length) await Promise.allSettled(jobs);

      window.GotCrackedDirectory?.requestRefresh?.(`cross-user-${reason}`);

      document.dispatchEvent(new CustomEvent('gc-cross-user-sync', {
        detail: { reason, revision, locationId }
      }));

      window.GotCrackedRuntimeStability?.syncOverlays?.();
      window.GotCrackedRefreshStability?.restore?.(snapshot);
    } finally {
      refreshBusy = false;
      if (refreshQueued && !interactionLocked()) {
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

  async function disconnectRealtime(status = 'idle') {
    clearTimeout(retryTimer);
    retryTimer = null;
    const channel = realtimeChannel;
    realtimeChannel = null;
    realtimeStatus = status;
    if (channel) {
      try { await client.removeChannel(channel); }
      catch {}
    }
  }

  async function handleStoreModeChange() {
    const training = isTraining();
    if (training === lastTrainingMode) return false;

    lastTrainingMode = training;
    lastRevision = null;
    locationId = null;
    deferredForInteraction = false;
    refreshQueued = false;

    if (training) {
      await disconnectRealtime('training');
      return true;
    }

    realtimeStatus = 'reconnecting';
    const revision = await fetchRevision();
    if (revision !== null) lastRevision = revision;
    if (locationId) connectRealtime();

    // operations-v1-core owns Blacksburg Main's operational websocket. If the
    // Portal originally booted in Training Store it intentionally skipped that
    // subscription, so resume the same recovery path it uses after reconnecting.
    setTimeout(() => window.dispatchEvent(new Event('online')), 0);

    document.dispatchEvent(new CustomEvent('gc-production-sync-resumed', {
      detail: { revision: lastRevision, locationId }
    }));
    return true;
  }

  async function pollNow() {
    if (pollBusy || document.visibilityState === 'hidden') return;
    pollBusy = true;
    try {
      const modeChanged = await handleStoreModeChange();
      if (modeChanged || isTraining()) return;
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
    if (!deferredForInteraction && !refreshQueued) return;
    if (interactionLocked()) return;
    deferredForInteraction = false;
    refreshQueued = false;
    refreshAll('interaction-finished', lastRevision);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      lastRevision = null;
      locationId = null;
      clearTimeout(retryTimer);
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

  document.addEventListener('gc-store-mode-changed', () => setTimeout(handleStoreModeChange, 0));
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-v1-store-switch]')) setTimeout(handleStoreModeChange, 140);
  }, true);
  document.addEventListener('focusout', () => setTimeout(resumeDeferredRefresh, 120));
  document.addEventListener('close', () => setTimeout(resumeDeferredRefresh, 50), true);
  document.addEventListener('gc-view-changed', () => setTimeout(resumeDeferredRefresh, 50));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pollNow();
      resumeDeferredRefresh();
      if (!realtimeChannel) connectRealtime();
    }
  });
  window.addEventListener('online', () => {
    pollNow();
    resumeDeferredRefresh();
    if (!realtimeChannel) connectRealtime();
  });
  window.addEventListener('pageshow', () => {
    pollNow();
    resumeDeferredRefresh();
    if (!realtimeChannel) connectRealtime();
  });

  const interval = setInterval(pollNow, POLL_MS);
  setTimeout(pollNow, 100);

  window.GotCrackedCrossUserSync = {
    version:'20260827-sync5',
    pollNow,
    refreshNow:() => refreshAll('manual', lastRevision),
    resumeProduction:handleStoreModeChange,
    get status(){ return { lastRevision, locationId, realtimeStatus, pollBusy, refreshBusy, deferredForInteraction, training:isTraining() }; },
    stop(){ clearInterval(interval); clearTimeout(retryTimer); if (realtimeChannel) client.removeChannel(realtimeChannel).catch(() => {}); }
  };
})();