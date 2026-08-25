(() => {
  'use strict';

  const NAV_CLASS = 'gc-mobile-nav';
  const PRIMARY = ['dashboard', 'repairs', 'ready-pickup', 'leads', 'appointments', 'customers'];
  const MORE = ['shipping', 'inventory', 'repair-reference', 'purchasing'];
  const MANAGEMENT = ['reports', 'staff', 'settings'];
  let lastSignature = '';

  function desktopNav() {
    return document.querySelector(`.sidebar > nav:not(.${NAV_CLASS})`);
  }

  function sourceLink(view) {
    return desktopNav()?.querySelector(`.nav-link[data-view="${CSS.escape(view)}"]`)
      || document.querySelector(`.sidebar-bottom > .nav-link[data-view="${CSS.escape(view)}"]`);
  }

  function isAvailable(link) {
    if (!link) return false;
    return !link.classList.contains('v1-hidden') && !link.hidden;
  }

  function labelFor(link) {
    const clone = link.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.querySelectorAll('b').forEach(node => node.remove());
    clone.classList.remove('active');
    clone.dataset.mobileNavClone = 'true';
    return clone;
  }

  function signature() {
    return [...PRIMARY, ...MORE, ...MANAGEMENT].map(view => {
      const link = sourceLink(view);
      if (!link) return `${view}:missing`;
      return `${view}:${isAvailable(link) ? '1' : '0'}:${link.className}:${link.textContent.trim()}`;
    }).join('|');
  }

  function makeGroup(label, key, views, current) {
    const links = views.map(view => sourceLink(view)).filter(isAvailable).map(labelFor);
    if (!links.length) return null;

    const details = document.createElement('details');
    details.className = 'gc-mobile-nav-group';
    details.dataset.mobileGroup = key;
    details.open = links.some(link => link.dataset.view === current);

    const summary = document.createElement('summary');
    summary.textContent = label;

    const body = document.createElement('div');
    body.className = 'gc-mobile-nav-group-links';
    links.forEach(link => body.appendChild(link));
    details.append(summary, body);

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      details.parentElement?.querySelectorAll('.gc-mobile-nav-group[open]').forEach(other => {
        if (other !== details) other.open = false;
      });
    });
    return details;
  }

  function syncActive() {
    const nav = document.querySelector(`.sidebar > .${NAV_CLASS}`);
    if (!nav) return;
    const current = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    nav.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === current);
    });
    nav.querySelectorAll('.gc-mobile-nav-group').forEach(group => {
      if (group.querySelector(`.nav-link[data-view="${CSS.escape(current)}"]`)) group.open = true;
    });
  }

  function build() {
    const sidebar = document.querySelector('.sidebar');
    const source = desktopNav();
    if (!sidebar || !source) return;

    const nextSignature = signature();
    if (nextSignature === lastSignature && sidebar.querySelector(`:scope > .${NAV_CLASS}`)) {
      syncActive();
      return;
    }
    lastSignature = nextSignature;

    sidebar.querySelector(`:scope > .${NAV_CLASS}`)?.remove();
    const nav = document.createElement('nav');
    nav.className = NAV_CLASS;
    nav.setAttribute('aria-label', 'Mobile navigation');

    PRIMARY.map(view => sourceLink(view)).filter(isAvailable).map(labelFor).forEach(link => nav.appendChild(link));

    const current = window.location.hash.slice(1).split('/')[0] || 'dashboard';
    const more = makeGroup('More', 'more', MORE, current);
    const management = makeGroup('Management', 'management', MANAGEMENT, current);
    if (more) nav.appendChild(more);
    if (management) nav.appendChild(management);

    source.insertAdjacentElement('afterend', nav);
    sidebar.classList.add('gc-mobile-nav-ready');
    syncActive();
  }

  function init() {
    build();

    const source = desktopNav();
    const bottom = document.querySelector('.sidebar-bottom');
    const observer = new MutationObserver(() => requestAnimationFrame(build));
    if (source) observer.observe(source, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (bottom) observer.observe(bottom, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });

    window.addEventListener('hashchange', () => requestAnimationFrame(syncActive));
    document.addEventListener('gc-view-changed', () => requestAnimationFrame(syncActive));
    setTimeout(build, 1700);
    setTimeout(build, 2800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
