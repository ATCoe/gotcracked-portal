(() => {
  'use strict';

  if (window.GotCrackedRuntimeStability) return;

  const VERSION = '20260827-stability1';
  const client = window.supabaseClient;
  const legacyRealtimeTopics = topic => topic === 'portal-live' || String(topic || '').startsWith('portal-v1-operations-');
  const callbackStates = new WeakMap();
  let syncFrame = 0;
  let observer = null;

  function visibleDialogOpen() {
    return [...document.querySelectorAll('dialog[open]')].some(dialog => {
      const style = getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01 && rect.width > 8 && rect.height > 8;
    });
  }

  function isInteractionLocked() {
    if (document.visibilityState === 'hidden') return true;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('input,textarea,select,[contenteditable="true"]')) return true;
    if (visibleDialogOpen()) return true;
    if (document.getElementById('v1-lead-drawer')?.classList.contains('open')) return true;
    if (matchMedia('(max-width: 1100px)').matches && document.body.classList.contains('v1-workflow-open')) return true;
    return false;
  }

  function runWhenSafe(callback, payload) {
    let state = callbackStates.get(callback);
    if (!state) {
      state = { timer:0, payload:null, running:false, queued:false };
      callbackStates.set(callback, state);
    }
    state.payload = payload;
    clearTimeout(state.timer);

    const attempt = () => {
      state.timer = 0;
      if (isInteractionLocked()) {
        state.timer = setTimeout(attempt, 500);
        return;
      }
      if (state.running) {
        state.queued = true;
        return;
      }
      state.running = true;
      const current = state.payload;
      Promise.resolve()
        .then(() => callback(current))
        .catch(error => console.error('Deferred Portal realtime refresh failed:', error))
        .finally(() => {
          state.running = false;
          if (state.queued) {
            state.queued = false;
            state.timer = setTimeout(attempt, 250);
          }
        });
    };

    state.timer = setTimeout(attempt, 300);
  }

  function patchLegacyRealtime() {
    if (!client || client.__gcStabilityChannelPatched || typeof client.channel !== 'function') return;
    const nativeChannel = client.channel.bind(client);
    client.channel = function stabilityChannel(topic, options) {
      const channel = nativeChannel(topic, options);
      if (!legacyRealtimeTopics(topic) || !channel || typeof channel.on !== 'function') return channel;

      const nativeOn = channel.on.bind(channel);
      channel.on = function stabilityOn(type, filter, callback) {
        if (type !== 'postgres_changes' || typeof callback !== 'function') {
          return nativeOn(type, filter, callback);
        }
        const guarded = payload => runWhenSafe(callback, payload);
        return nativeOn(type, filter, guarded);
      };
      return channel;
    };
    client.__gcStabilityChannelPatched = true;
  }

  function normalizeLeadLaunchers(root = document) {
    const nodes = [];
    if (root instanceof Element && root.matches('[data-v1-polish-new-lead]')) nodes.push(root);
    root.querySelectorAll?.('[data-v1-polish-new-lead]').forEach(node => nodes.push(node));
    for (const node of nodes) {
      node.removeAttribute('data-v1-polish-new-lead');
      node.setAttribute('data-live-action', 'lead');
      node.title = 'Create a structured lead';
    }
  }

  function syncLeadBackdrop() {
    const drawer = document.getElementById('v1-lead-drawer');
    const open = Boolean(drawer?.classList.contains('open'));
    document.querySelectorAll('#v1-drawer-backdrop,.v1-drawer-backdrop').forEach(backdrop => {
      if (backdrop.hidden === open) backdrop.hidden = !open;
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) {
        backdrop.removeAttribute('inert');
        backdrop.style.setProperty('pointer-events', 'auto', 'important');
      } else {
        backdrop.setAttribute('inert', '');
        backdrop.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  }

  function syncOverlayState() {
    syncFrame = 0;
    normalizeLeadLaunchers(document);
    document.querySelectorAll('.sidebar-backdrop').forEach(node => node.remove());
    syncLeadBackdrop();

    const overlayOpen = Boolean(
      document.getElementById('v1-lead-drawer')?.classList.contains('open') ||
      visibleDialogOpen()
    );
    if (document.body.classList.contains('v1-overlay-open') !== overlayOpen) {
      document.body.classList.toggle('v1-overlay-open', overlayOpen);
    }
  }

  function scheduleOverlaySync() {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(syncOverlayState);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(records => {
      let relevant = false;
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element) normalizeLeadLaunchers(node);
          }
          relevant = true;
        } else if (record.type === 'attributes') {
          relevant = true;
        }
      }
      if (relevant) scheduleOverlaySync();
    });
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class','open','hidden','data-v1-polish-new-lead']
    });
  }

  patchLegacyRealtime();

  const start = () => {
    startObserver();
    syncOverlayState();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();

  document.addEventListener('gc-view-changed', scheduleOverlaySync);
  document.addEventListener('gc-portal-runtime-ready', scheduleOverlaySync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleOverlaySync();
  });
  window.addEventListener('pageshow', scheduleOverlaySync);
  window.addEventListener('online', scheduleOverlaySync);

  window.GotCrackedRuntimeStability = {
    version: VERSION,
    isInteractionLocked,
    syncOverlays: scheduleOverlaySync
  };
})();
