(() => {
  'use strict';

  if (window.GotCrackedRefreshStability) return;

  let lastUserScrollY = Math.max(0, window.scrollY || 0);
  let userIntentUntil = 0;
  let restoreFrame = 0;
  let lastView = document.querySelector('.view.active-view')?.id || location.hash.slice(1).split('/')[0] || 'dashboard';
  let explicitSnapshot = null;

  const now = () => performance.now();
  const currentView = () => document.querySelector('.view.active-view')?.id || location.hash.slice(1).split('/')[0] || 'dashboard';
  const maxScrollY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  function markUserIntent(duration = 1100) {
    userIntentUntil = now() + duration;
    requestAnimationFrame(() => {
      lastUserScrollY = Math.max(0, window.scrollY || 0);
    });
  }

  function capture(reason = 'refresh') {
    explicitSnapshot = {
      reason,
      view: currentView(),
      hash: location.hash,
      y: Math.max(0, window.scrollY || 0),
      at: now()
    };
    if (explicitSnapshot.y > 0) lastUserScrollY = explicitSnapshot.y;
    return explicitSnapshot;
  }

  function restore(snapshot = explicitSnapshot) {
    if (!snapshot) return;
    if (snapshot.view !== currentView()) return;
    const target = Math.min(Math.max(0, snapshot.y), maxScrollY());
    if (target <= 0) return;
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        if (snapshot.view !== currentView()) return;
        const clamped = Math.min(target, maxScrollY());
        if (Math.abs((window.scrollY || 0) - clamped) > 4) window.scrollTo(0, clamped);
      });
    });
  }

  function protectAgainstRepaintJump() {
    const view = currentView();
    if (view !== lastView) {
      lastView = view;
      lastUserScrollY = Math.max(0, window.scrollY || 0);
      explicitSnapshot = null;
      return;
    }

    // Full operational renders briefly shrink/replace the active DOM. Browsers can
    // clamp scrollY to zero during that repaint. Restore only when there has not
    // been recent user scrolling, so intentional navigation/scrolling is untouched.
    if (now() < userIntentUntil) return;
    const y = Math.max(0, window.scrollY || 0);
    if (lastUserScrollY > 48 && y + 28 < lastUserScrollY) {
      restore({ view, y:lastUserScrollY, at:now(), reason:'dom-repaint' });
    }
  }

  for (const eventName of ['wheel','touchstart','touchmove','pointerdown']) {
    window.addEventListener(eventName, () => markUserIntent(), { passive:true });
  }
  document.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) markUserIntent(1400);
  }, true);
  window.addEventListener('scroll', () => {
    if (now() < userIntentUntil) lastUserScrollY = Math.max(0, window.scrollY || 0);
  }, { passive:true });

  document.addEventListener('gc-view-changed', () => {
    lastView = currentView();
    lastUserScrollY = Math.max(0, window.scrollY || 0);
    explicitSnapshot = null;
  });

  const observe = () => {
    const main = document.querySelector('.app-shell main') || document.querySelector('main');
    if (!main) return;
    const observer = new MutationObserver(() => protectAgainstRepaintJump());
    observer.observe(main, { childList:true, subtree:true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once:true });
  else observe();

  window.GotCrackedRefreshStability = {
    version:'20260827-scroll1',
    capture,
    restore,
    get lastUserScrollY(){ return lastUserScrollY; }
  };
})();