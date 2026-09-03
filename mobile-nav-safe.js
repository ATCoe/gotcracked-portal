(() => {
  'use strict';

  const MOBILE_MAX = 750;
  const NAV_CLASS = 'gc-mobile-nav';
  const BACKDROP_CLASS = 'gc-mobile-nav-backdrop';
  const CLOSE_CLASS = 'gc-mobile-nav-close';
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
  let lastPointerToggleAt = 0;
  let returnFocus = null;

  const navItems = {
    primary: [
      ['dashboard', '▦', 'Dashboard'],
      ['repairs', '⌁', 'Repairs'],
      ['ready-pickup', '✓', 'Ready for Pickup'],
      ['leads', '⌁', 'Leads'],
      ['appointments', '◷', 'Appointments'],
      ['schedule', '▦', 'Schedule'],
      ['customers', '♙', 'Customers']
    ],
    more: [
      ['shipping', '▰', 'Mail-in & Shipping'],
      ['inventory', '▤', 'Inventory'],
      ['repair-reference', '⌕', 'Repair Reference'],
      ['purchasing', '▣', 'Purchasing']
    ],
    management: [
      ['reports', '◫', 'Reports'],
      ['staff', '♟', 'Staff Access'],
      ['settings', '⚙', 'Settings']
    ]
  };

  const sidebar = () => document.querySelector('.sidebar');
  const buttons = () => Array.from(document.querySelectorAll('.mobile-menu'));
  const currentView = () => window.location.hash.slice(1).split('/')[0] || 'dashboard';


  function linkMarkup([view, icon, label]) {
    return `<a class="nav-link" href="#${view}" data-view="${view}" data-mobile-nav-item="true"><span>${icon}</span>${label}</a>`;
  }

  function groupMarkup(label, key, items) {
    return `<details class="gc-mobile-nav-group" data-mobile-group="${key}">
      <summary>${label}</summary>
      <div class="gc-mobile-nav-group-links">${items.map(linkMarkup).join('')}</div>
    </details>`;
  }

  function syncButtons(open) {
    const panel = sidebar();
    for (const toggle of buttons()) {
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(Boolean(open)));
      toggle.setAttribute('aria-controls', panel?.id || 'portal-sidebar');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }

  function forcePanelVisualState(panel, open) {
    if (!panel) return;
    if (open) {
      panel.style.setProperty('transform', 'translateX(0)', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
      panel.style.setProperty('pointer-events', 'auto', 'important');
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('filter', 'none', 'important');
      panel.style.setProperty('-webkit-filter', 'none', 'important');
      panel.style.setProperty('mix-blend-mode', 'normal', 'important');
    } else {
      panel.style.removeProperty('transform');
      panel.style.removeProperty('visibility');
      panel.style.removeProperty('pointer-events');
      panel.style.removeProperty('opacity');
      panel.style.removeProperty('filter');
      panel.style.removeProperty('-webkit-filter');
      panel.style.removeProperty('mix-blend-mode');
    }
  }

  function removeSidebarTimeClock(panel = sidebar()) {
    if (!panel) return;
    panel.querySelectorAll('#sidebar-time-clock,.gc-timeclock-mini,[data-sidebar-time-clock]').forEach(node => node.remove());
  }


  function teardownDesktopArtifacts(panel = sidebar()) {
    document.documentElement.dataset.gcMobileNavOpen = 'false';
    document.body?.classList.remove('mobile-nav-open');
    document.querySelectorAll(`.${BACKDROP_CLASS}`).forEach(node => node.remove());
    if (!panel) return;
    panel.querySelectorAll(`.${NAV_CLASS}, .${CLOSE_CLASS}`).forEach(node => node.remove());
    panel.classList.remove('gc-mobile-nav-ready', 'open');
    panel.removeAttribute('data-mobile-open');
    panel.removeAttribute('aria-hidden');
    forcePanelVisualState(panel, false);
    syncButtons(false);
  }

  function ensureBackdrop() {
    let backdrop = document.querySelector(`.${BACKDROP_CLASS}`);
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = BACKDROP_CLASS;
      backdrop.setAttribute('aria-hidden', 'true');
    }

    /* Keep the backdrop in the same app-shell stacking context as the sidebar.
       As body siblings, a parent stacking context can cause the backdrop to tint
       the drawer itself even when the sidebar has the larger child z-index. */
    const host = document.querySelector('.app-shell') || document.body;
    if (backdrop.parentElement !== host) host.appendChild(backdrop);
    return backdrop;
  }

  function ensureCloseButton(panel) {
    if (!panel) return null;
    let close = panel.querySelector(`.${CLOSE_CLASS}`);
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.className = CLOSE_CLASS;
      close.setAttribute('aria-label', 'Close menu');
      close.textContent = '×';
      panel.prepend(close);
    }
    return close;
  }

  function buildOnce() {
    const panel = sidebar();
    if (!panel) return null;
    if (!panel.id) panel.id = 'portal-sidebar';

    removeSidebarTimeClock(panel);
    if (!mobileQuery.matches) {
      teardownDesktopArtifacts(panel);
      return null;
    }
    ensureBackdrop();
    ensureCloseButton(panel);

    let nav = panel.querySelector(`.${NAV_CLASS}`);
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = NAV_CLASS;
      nav.setAttribute('aria-label', 'Mobile navigation');
      nav.innerHTML = `${navItems.primary.map(linkMarkup).join('')}${groupMarkup('More', 'more', navItems.more)}${groupMarkup('Management', 'management', navItems.management)}`;

      const desktopNav = Array.from(panel.children).find(child => child.tagName === 'NAV' && !child.classList.contains(NAV_CLASS));
      const sidebarBottom = Array.from(panel.children).find(child => child.classList?.contains('sidebar-bottom'));
      if (desktopNav) desktopNav.insertAdjacentElement('afterend', nav);
      else if (sidebarBottom) sidebarBottom.insertAdjacentElement('beforebegin', nav);
      else panel.appendChild(nav);
    }

    panel.classList.add('gc-mobile-nav-ready');
    syncActive();
    return nav;
  }

  function setOpen(open, options = {}) {
    const panel = sidebar();
    if (!panel) return;

    removeSidebarTimeClock(panel);
    if (!mobileQuery.matches) {
      teardownDesktopArtifacts(panel);
      return;
    }
    const shouldOpen = Boolean(open);
    const backdrop = ensureBackdrop();
    ensureCloseButton(panel);

    document.documentElement.dataset.gcMobileNavOpen = shouldOpen ? 'true' : 'false';
    document.body?.classList.toggle('mobile-nav-open', shouldOpen);
    panel.classList.toggle('open', shouldOpen);
    panel.dataset.mobileOpen = shouldOpen ? 'true' : 'false';
    panel.setAttribute('aria-hidden', shouldOpen ? 'false' : String(mobileQuery.matches));
    backdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    forcePanelVisualState(panel, shouldOpen);
    syncButtons(shouldOpen);

    if (shouldOpen) {
      if (options.trigger instanceof HTMLElement) returnFocus = options.trigger;
      else if (!returnFocus?.isConnected) returnFocus = document.querySelector('.mobile-menu');
      requestAnimationFrame(() => {
        if (document.documentElement.dataset.gcMobileNavOpen !== 'true') return;
        const current = sidebar();
        if (!current) return;
        removeSidebarTimeClock(current);
        current.classList.add('open');
        current.dataset.mobileOpen = 'true';
        forcePanelVisualState(current, true);
        syncButtons(true);
        current.querySelector(`.${CLOSE_CLASS}`)?.focus({preventScroll:true});
      });
    } else if (options.restoreFocus) {
      const destination=returnFocus?.isConnected?returnFocus:document.querySelector('.mobile-menu');
      requestAnimationFrame(() => destination?.focus?.({preventScroll:true}));
      returnFocus = null;
    }
  }

  function syncActive() {
    const panel = sidebar();
    const nav = panel?.querySelector(`.${NAV_CLASS}`);
    if (!nav) return;

    const active = currentView();
    nav.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === active);
    });
    nav.querySelectorAll('.gc-mobile-nav-group').forEach(group => {
      const containsActive = Array.from(group.querySelectorAll('.nav-link[data-view]')).some(link => link.dataset.view === active);
      if (containsActive) group.open = true;
    });
  }

  function visibleModalOpen() {
    return Array.from(document.querySelectorAll('dialog[open]')).some(dialog => {
      const style = getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01 && rect.width > 8 && rect.height > 8;
    });
  }

  function toggleAtPoint(event) {
    if (!mobileQuery.matches || (typeof event.button === 'number' && event.button !== 0)) return false;
    const direct = event.target instanceof Element ? event.target.closest('.mobile-menu') : null;
    let toggle = direct;

    if (!toggle && !visibleModalOpen() && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        const candidate = element instanceof Element ? element.closest('.mobile-menu') : null;
        if (candidate) { toggle = candidate; break; }
      }
    }

    if (!toggle) return false;
    const panel = sidebar();
    if (!panel) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    lastPointerToggleAt = performance.now();
    setOpen(panel.dataset.mobileOpen !== 'true', {trigger:toggle, restoreFocus:true});
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.gcMobileNavBound === 'true') return;
    document.documentElement.dataset.gcMobileNavBound = 'true';

    /* Own the hamburger on pointerdown so late Android/Samsung DOM updates cannot
       cancel the tap before the menu opens. */
    window.addEventListener('pointerdown', event => {
      toggleAtPoint(event);
    }, true);

    /* Backdrop and in-drawer close button are first-class close controls. */
    document.addEventListener('pointerdown', event => {
      if (!mobileQuery.matches) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest(`.${CLOSE_CLASS}`) || target.closest(`.${BACKDROP_CLASS}`)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false, {restoreFocus:true});
        return;
      }

      const panel = sidebar();
      if (!panel || panel.dataset.mobileOpen !== 'true') return;
      if (panel.contains(target) || target.closest('.mobile-menu')) return;
      setOpen(false, {restoreFocus:false});
    }, true);

    /* Keyboard activation and browsers without Pointer Events keep a click
       fallback. Suppress the compatibility click after a handled pointer tap. */
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const toggle = target?.closest('.mobile-menu');
      if (!toggle || !mobileQuery.matches) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (performance.now() - lastPointerToggleAt < 900) return;

      const panel = sidebar();
      if (!panel) return;
      setOpen(panel.dataset.mobileOpen !== 'true', {trigger:toggle, restoreFocus:true});
    }, true);

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`.${NAV_CLASS} .nav-link[data-view]`)) return;
      setOpen(false, {restoreFocus:false});
    });

    /* Keep the drawer app-like on phones: a long press should not open the
       browser's Copy/Download-link context menu over Portal navigation. */
    document.addEventListener('contextmenu', event => {
      if (!mobileQuery.matches) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`.${NAV_CLASS}, .mobile-menu, .${CLOSE_CLASS}`)) event.preventDefault();
    });

    window.addEventListener('hashchange', () => {
      setOpen(false, {restoreFocus:false});
      syncActive();
    });
    window.addEventListener('popstate', () => setOpen(false, {restoreFocus:false}));

    document.addEventListener('gc-view-changed', syncActive);

    document.addEventListener('gc-portal-runtime-ready', () => {
      buildOnce();
      removeSidebarTimeClock();
      syncActive();
      syncButtons(document.documentElement.dataset.gcMobileNavOpen === 'true');
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setOpen(false, {restoreFocus:true});
    });

    mobileQuery.addEventListener?.('change', event => {
      if (!event.matches) setOpen(false, {restoreFocus:false});
      else {
        buildOnce();
        syncButtons(false);
      }
    });

    window.addEventListener('orientationchange', () => setOpen(false, {restoreFocus:false}));
    window.addEventListener('pageshow', () => {
      buildOnce();
      removeSidebarTimeClock();
      setOpen(false, {restoreFocus:false});
    });
  }

  function init() {
    document.querySelectorAll('.sidebar-backdrop').forEach(node => node.remove());
    buildOnce();
    bind();
    setOpen(false, {restoreFocus:false});
  }

  window.GotCrackedMobileNav = {
    version:'20260827-mobile-nav6',
    build:buildOnce,
    setOpen,
    syncActive
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();

