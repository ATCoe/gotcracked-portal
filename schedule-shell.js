(() => {
  'use strict';
  if (window.GotCrackedScheduleShell) return;

  function ensureSchedulePage() {
    const main = document.querySelector('.app-shell main');
    if (!main) return null;

    let section = document.getElementById('schedule');
    if (!section) {
      section = document.createElement('section');
      section.id = 'schedule';
      section.className = 'view';
      section.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Workforce planning</p><h1>Schedule</h1><p class="subtle">Plan the Blacksburg work week from Sunday through Saturday.</p></div></div><div id="schedule-board"><div class="empty-card"><span>◷</span><h2>Loading weekly schedule…</h2></div></div>`;
      const staff = document.getElementById('staff');
      if (staff) main.insertBefore(section, staff);
      else main.appendChild(section);
    }

    document.getElementById('labor-scheduler')?.remove();

    const staffHeading = document.querySelector('#staff .page-heading h1');
    if (staffHeading && /scheduling/i.test(staffHeading.textContent || '')) staffHeading.textContent = 'Staff access';
    const staffSubtle = document.querySelector('#staff .page-heading .subtle');
    if (staffSubtle && /plan labor/i.test(staffSubtle.textContent || '')) staffSubtle.textContent = 'Onboard employees, control access, and manage staff permissions.';

    const desktopNav = Array.from(document.querySelectorAll('.sidebar > nav')).find(nav => !nav.classList.contains('gc-mobile-nav'));
    if (desktopNav && !desktopNav.querySelector('[data-view="schedule"]')) {
      const link = document.createElement('a');
      link.className = 'nav-link';
      link.href = '#schedule';
      link.dataset.view = 'schedule';
      link.innerHTML = '<span>▦</span>Schedule';
      const appointments = desktopNav.querySelector('[data-view="appointments"]');
      if (appointments) appointments.insertAdjacentElement('afterend', link);
      else desktopNav.appendChild(link);
    }

    return section;
  }

  function syncHash() {
    if (location.hash.slice(1).split('/')[0] !== 'schedule') return;
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === 'schedule'));
    document.querySelectorAll('.nav-link[data-view]').forEach(link => link.classList.toggle('active', link.dataset.view === 'schedule'));
    document.dispatchEvent(new CustomEvent('gc-view-changed', { detail:{ view:'schedule' } }));
  }

  ensureSchedulePage();
  queueMicrotask(syncHash);
  window.addEventListener('hashchange', () => { ensureSchedulePage(); syncHash(); });

  window.GotCrackedScheduleShell = { ensure:ensureSchedulePage };
})();