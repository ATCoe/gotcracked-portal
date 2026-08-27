(() => {
  'use strict';

  const VERSION = '20260827-kb1';
  const KB_VIEW = 'repair-reference';
  const NAV_GROUPS = [
    { label: 'Workspace', views: ['dashboard'] },
    { label: 'Service Desk', views: ['repairs', 'ready-pickup', 'appointments', 'customers', 'leads'] },
    { label: 'Store Operations', views: ['shipping', 'inventory', 'purchasing'] },
    { label: 'Team', views: ['schedule'] },
    { label: 'Knowledge', views: [KB_VIEW] },
    { label: 'Management', views: ['reports', 'staff'] }
  ];

  const SOURCE_LIBRARY = [
    {
      key: 'gotcracked',
      name: 'GotCracked',
      type: 'Internal',
      status: 'Live',
      description: 'GotCracked diagnostic paths, bench procedures, cautions, and technician reference data.',
      url: '',
      action: 'Browse internal guides'
    },
    {
      key: 'ifixit',
      name: 'iFixit',
      type: 'Third-party',
      status: 'License required',
      description: 'Industry repair guides and device teardowns. Commercial guide ingestion stays disabled until a commercial content/API license is in place.',
      url: 'https://www.ifixit.com/Device',
      action: 'Open iFixit'
    },
    {
      key: 'apple',
      name: 'Apple Self Service Repair',
      type: 'Manufacturer',
      status: 'Official',
      description: 'Apple repair manuals, parts and tool requirements for supported iPhone, iPad, Mac, display, and Beats repairs.',
      url: 'https://support.apple.com/self-service-repair',
      action: 'Open Apple manuals'
    },
    {
      key: 'samsung',
      name: 'Samsung Self-Repair',
      type: 'Manufacturer',
      status: 'Official',
      description: 'Samsung model-specific self-repair documentation, genuine parts, and supported repair resources.',
      url: 'https://www.samsung.com/us/support/self-repair/',
      action: 'Open Samsung repair'
    },
    {
      key: 'google',
      name: 'Google Pixel Repair',
      type: 'Manufacturer',
      status: 'Official',
      description: 'Pixel repair manuals, genuine-parts guidance, and Pixel Repair Diagnostics resources.',
      url: 'https://support.google.com/pixelphone/answer/14257407?hl=en',
      action: 'Open Pixel repair'
    }
  ];

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
  const text = (...values) => values.flat(Infinity).filter(Boolean).join(' ').toLowerCase();
  const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const currentView = () => location.hash.slice(1).split('/')[0] || 'dashboard';
  const guideState = { query: '', category: 'all', sourceMode: 'guides' };
  let navObserver = null;
  let referenceObserver = null;
  let navTimer = 0;
  let rendering = false;

  function ensureStyles() {
    if (document.querySelector('link[data-gc-knowledge-base]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `knowledge-base.css?v=${VERSION}`;
    link.dataset.gcKnowledgeBase = VERSION;
    document.head.appendChild(link);
  }

  function knowledgeNavMarkup(link) {
    const active = link.classList.contains('active');
    link.className = `nav-link gc-kb-nav${active ? ' active' : ''}${link.classList.contains('v1-hidden') ? ' v1-hidden' : ''}`;
    link.href = '#repair-reference';
    link.dataset.view = KB_VIEW;
    link.setAttribute('aria-label', 'Knowledge Base');
    link.innerHTML = '<span class="gc-kb-nav-icon" aria-hidden="true">◇</span><span class="gc-kb-nav-copy"><strong>Knowledge Base</strong><small>Repair intelligence</small></span><em class="gc-kb-pro">PRO</em>';
  }

  function organizeSidebar() {
    const nav = document.querySelector('.sidebar nav');
    if (!nav) return;

    const allLinks = [...nav.querySelectorAll('a.nav-link[data-view]')];
    if (!allLinks.length) return;
    const byView = new Map(allLinks.map(link => [link.dataset.view, link]));
    const kbLink = byView.get(KB_VIEW);
    if (kbLink) knowledgeNavMarkup(kbLink);

    nav.querySelectorAll('.gc-nav-section-label').forEach(label => label.remove());
    const claimed = new Set();

    for (const group of NAV_GROUPS) {
      const links = group.views.map(view => byView.get(view)).filter(Boolean);
      if (!links.length) continue;
      const label = document.createElement('div');
      label.className = `gc-nav-section-label${group.label === 'Knowledge' ? ' gc-nav-section-label-kb' : ''}`;
      label.textContent = group.label;
      nav.appendChild(label);
      links.forEach(link => {
        claimed.add(link);
        nav.appendChild(link);
      });
    }

    const leftovers = allLinks.filter(link => !claimed.has(link));
    if (leftovers.length) {
      const label = document.createElement('div');
      label.className = 'gc-nav-section-label';
      label.textContent = 'More';
      nav.appendChild(label);
      leftovers.forEach(link => nav.appendChild(link));
    }

    nav.dataset.gcOrganized = VERSION;
  }

  function scheduleSidebar() {
    if (navTimer) return;
    navTimer = requestAnimationFrame(() => {
      navTimer = 0;
      organizeSidebar();
    });
  }

  function watchSidebar() {
    const nav = document.querySelector('.sidebar nav');
    if (!nav || navObserver) return;
    navObserver = new MutationObserver(records => {
      const addedNavLink = records.some(record => [...record.addedNodes].some(node =>
        node instanceof Element && (node.matches('a.nav-link[data-view]') || node.querySelector?.('a.nav-link[data-view]'))
      ));
      if (addedNavLink) scheduleSidebar();
    });
    navObserver.observe(nav, { childList: true, subtree: true });
  }

  function guides() {
    return window.GotCrackedOperationsV1?.state?.guides || [];
  }

  function guideSource(guide) {
    return guide.source_name || guide.source || 'GotCracked';
  }

  function categories() {
    const values = [...new Set(guides().map(guide => guide.device_category).filter(Boolean))];
    return values.sort((a, b) => String(a).localeCompare(String(b)));
  }

  function filteredGuides() {
    const query = guideState.query.trim().toLowerCase();
    return guides().filter(guide => {
      if (guideState.category !== 'all' && String(guide.device_category || '').toLowerCase() !== guideState.category) return false;
      if (!query) return true;
      return text(
        guide.title, guide.device_category, guide.manufacturer, guide.model_family,
        guide.symptom, guide.summary, guide.tags, guide.likely_causes,
        guide.diagnostic_steps, guide.tools_notes, guide.parts_notes,
        guide.cautions, guideSource(guide)
      ).includes(query);
    });
  }

  function sourceBadge(source) {
    const safe = String(source.status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<span class="gc-kb-source-status ${safe}">${esc(source.status)}</span>`;
  }

  function sourceCards() {
    return SOURCE_LIBRARY.map(source => `
      <article class="gc-kb-source-card" data-source="${esc(source.key)}">
        <div class="gc-kb-source-head">
          <div class="gc-kb-source-logo" aria-hidden="true">${source.key === 'gotcracked' ? 'GC' : source.name.slice(0, 1)}</div>
          <div><small>${esc(source.type)}</small><h3>${esc(source.name)}</h3></div>
          ${sourceBadge(source)}
        </div>
        <p>${esc(source.description)}</p>
        ${source.url
          ? `<a class="gc-kb-source-action" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.action)} <span aria-hidden="true">↗</span></a>`
          : `<button class="gc-kb-source-action" type="button" data-kb-internal>${esc(source.action)} <span aria-hidden="true">→</span></button>`}
      </article>`).join('');
  }

  function guideCard(guide) {
    const tags = Array.isArray(guide.tags) ? guide.tags : [];
    const causes = Array.isArray(guide.likely_causes) ? guide.likely_causes : [];
    const steps = Array.isArray(guide.diagnostic_steps) ? guide.diagnostic_steps : [];
    const source = guideSource(guide);
    const sourceUrl = guide.source_url || guide.reference_url || '';
    const tools = guide.tools_notes || guide.tools || '';
    const parts = guide.parts_notes || guide.parts || '';
    const difficulty = guide.difficulty || guide.skill_level || '';
    const estimate = guide.estimated_time || guide.time_estimate || '';
    const verified = guide.verified_at || guide.updated_at || '';
    const meta = [difficulty && `Skill: ${difficulty}`, estimate && `Time: ${estimate}`].filter(Boolean);

    return `<details class="gc-kb-guide" data-guide-id="${esc(guide.id || '')}">
      <summary>
        <div class="gc-kb-guide-main">
          <div class="gc-kb-guide-type">${esc(guide.device_category || 'Repair')} · ${esc(source)}</div>
          <h3>${esc(guide.title || 'Untitled repair path')}</h3>
          <p>${esc(guide.symptom || guide.summary || 'Technician repair reference')}</p>
          <div class="gc-kb-guide-tags">${tags.slice(0, 6).map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
        </div>
        <div class="gc-kb-guide-summary-meta">
          ${meta.map(item => `<span>${esc(item)}</span>`).join('')}
          <b aria-hidden="true">⌄</b>
        </div>
      </summary>
      <div class="gc-kb-guide-detail">
        ${guide.summary ? `<section><h4>Overview</h4><p>${esc(guide.summary)}</p></section>` : ''}
        ${causes.length ? `<section><h4>Likely causes</h4><ul>${causes.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}
        ${steps.length ? `<section class="gc-kb-walkthrough"><h4>Diagnostic / repair path</h4><ol>${steps.map((item, index) => `<li><span>${index + 1}</span><p>${esc(item)}</p></li>`).join('')}</ol></section>` : ''}
        ${tools ? `<section><h4>Tools & bench notes</h4><p>${esc(tools)}</p></section>` : ''}
        ${parts ? `<section><h4>Parts notes</h4><p>${esc(parts)}</p></section>` : ''}
        ${guide.cautions ? `<section class="gc-kb-caution"><h4>Safety / cautions</h4><p>${esc(guide.cautions)}</p></section>` : ''}
        <footer>
          <span>Source: <strong>${esc(source)}</strong>${verified ? ` · Updated ${esc(new Date(verified).toLocaleDateString())}` : ''}</span>
          ${sourceUrl ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}
        </footer>
      </div>
    </details>`;
  }

  function renderGuideResults() {
    const host = document.getElementById('gc-kb-results');
    const count = document.getElementById('gc-kb-result-count');
    if (!host) return;
    const rows = filteredGuides();
    if (count) count.textContent = `${rows.length} repair path${rows.length === 1 ? '' : 's'}`;
    host.innerHTML = rows.map(guideCard).join('') || `
      <div class="gc-kb-empty">
        <span aria-hidden="true">⌕</span>
        <h3>No matching repair path</h3>
        <p>Try a model, symptom, component, or broader device category. You can also open an authoritative source from the Source Library.</p>
      </div>`;
  }

  function statsMarkup() {
    const all = guides();
    const sourceCount = new Set(all.map(guideSource)).size;
    return `
      <div><strong>${all.length}</strong><span>Internal repair paths</span></div>
      <div><strong>${categories().length || 0}</strong><span>Device categories</span></div>
      <div><strong>${Math.max(sourceCount, 1) + 4}</strong><span>Knowledge sources</span></div>`;
  }

  function renderKnowledgeBase() {
    const host = document.getElementById(KB_VIEW);
    if (!host || rendering) return;
    rendering = true;
    const categoryButtons = ['all', ...categories().map(value => String(value).toLowerCase())];
    const categoryLabel = key => key === 'all' ? 'All Devices' : titleCase(key);

    host.innerHTML = `
      <div class="gc-kb-shell">
        <section class="gc-kb-hero">
          <div class="gc-kb-hero-copy">
            <div class="gc-kb-kicker"><span>PRO</span> Repair Intelligence</div>
            <h1>Knowledge Base</h1>
            <p>One technician workspace for diagnostics, repair walkthroughs, safety notes, parts context, and trusted repair sources.</p>
          </div>
          <div class="gc-kb-hero-stats">${statsMarkup()}</div>
        </section>

        <section class="gc-kb-search-panel">
          <div class="gc-kb-search">
            <span aria-hidden="true">⌕</span>
            <input id="gc-kb-search-input" value="${esc(guideState.query)}" placeholder="Search device, model, symptom, component, or repair…" autocomplete="off" />
            <kbd>/</kbd>
          </div>
          <div class="gc-kb-mode-tabs" role="tablist" aria-label="Knowledge Base sections">
            <button type="button" class="${guideState.sourceMode === 'guides' ? 'active' : ''}" data-kb-mode="guides">Repair Library</button>
            <button type="button" class="${guideState.sourceMode === 'sources' ? 'active' : ''}" data-kb-mode="sources">Source Library</button>
          </div>
        </section>

        <section class="gc-kb-library ${guideState.sourceMode === 'guides' ? '' : 'gc-kb-hidden'}" data-kb-panel="guides">
          <div class="gc-kb-category-row" aria-label="Device categories">
            ${categoryButtons.map(key => `<button type="button" data-kb-category="${esc(key)}" class="${guideState.category === key ? 'active' : ''}">${esc(categoryLabel(key))}</button>`).join('')}
          </div>
          <div class="gc-kb-section-head">
            <div><p class="eyebrow">Technician library</p><h2>Repair Paths</h2></div>
            <span id="gc-kb-result-count"></span>
          </div>
          <div id="gc-kb-results" class="gc-kb-results"></div>
        </section>

        <section class="gc-kb-source-library ${guideState.sourceMode === 'sources' ? '' : 'gc-kb-hidden'}" data-kb-panel="sources">
          <div class="gc-kb-section-head">
            <div><p class="eyebrow">Authoritative references</p><h2>Source Library</h2></div>
            <span>External sources open in a new tab</span>
          </div>
          <div class="gc-kb-source-grid">${sourceCards()}</div>
          <article class="gc-kb-licensing-note">
            <div aria-hidden="true">§</div>
            <div><strong>Source licensing is enforced by design.</strong><p>GotCracked-owned procedures can live directly in the Portal. Third-party content is linked or integrated only when its license permits commercial use. iFixit content remains external until commercial licensing is approved.</p></div>
          </article>
        </section>
      </div>`;

    rendering = false;
    bindKnowledgeBase();
    renderGuideResults();
  }

  function setMode(mode) {
    guideState.sourceMode = mode === 'sources' ? 'sources' : 'guides';
    document.querySelectorAll('[data-kb-mode]').forEach(button => button.classList.toggle('active', button.dataset.kbMode === guideState.sourceMode));
    document.querySelectorAll('[data-kb-panel]').forEach(panel => panel.classList.toggle('gc-kb-hidden', panel.dataset.kbPanel !== guideState.sourceMode));
  }

  function bindKnowledgeBase() {
    const search = document.getElementById('gc-kb-search-input');
    search?.addEventListener('input', event => {
      guideState.query = event.target.value;
      renderGuideResults();
    });
    document.querySelectorAll('[data-kb-category]').forEach(button => button.addEventListener('click', () => {
      guideState.category = button.dataset.kbCategory;
      document.querySelectorAll('[data-kb-category]').forEach(item => item.classList.toggle('active', item === button));
      renderGuideResults();
    }));
    document.querySelectorAll('[data-kb-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.kbMode)));
    document.querySelector('[data-kb-internal]')?.addEventListener('click', () => setMode('guides'));
  }

  function watchReferenceHost() {
    const host = document.getElementById(KB_VIEW);
    if (!host || referenceObserver) return;
    referenceObserver = new MutationObserver(() => {
      if (rendering || currentView() !== KB_VIEW) return;
      if (!host.querySelector('.gc-kb-shell')) requestAnimationFrame(renderKnowledgeBase);
    });
    referenceObserver.observe(host, { childList: true });
  }

  function upgradeWorkOrderCopy() {
    const host = document.getElementById('work-order');
    if (!host) return;
    host.querySelectorAll('.card-title h2').forEach(heading => {
      if (heading.textContent.trim() === 'Suggested repair paths') heading.textContent = 'Knowledge Base Matches';
    });
    host.querySelectorAll('.card-title p').forEach(paragraph => {
      if (paragraph.textContent.includes('internal reference database')) {
        paragraph.textContent = 'Deterministic matches from intake findings and the GotCracked Knowledge Base. Technician confirmation is required.';
      }
    });
  }

  function upgradePermissionCopy() {
    const host = document.getElementById('staff');
    if (!host) return;
    host.querySelectorAll('.v1-permission-toggle strong').forEach(node => {
      if (node.textContent.trim() === 'View repair reference') node.textContent = 'View Knowledge Base';
      if (node.textContent.trim() === 'Manage repair reference') node.textContent = 'Manage Knowledge Base';
    });
  }

  function handleView(view) {
    scheduleSidebar();
    if (view === KB_VIEW) {
      renderKnowledgeBase();
      watchReferenceHost();
    }
    if (view === 'work-order') setTimeout(upgradeWorkOrderCopy, 0);
    if (view === 'staff') setTimeout(upgradePermissionCopy, 0);
  }

  document.addEventListener('keydown', event => {
    if (event.key !== '/' || currentView() !== KB_VIEW) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    document.getElementById('gc-kb-search-input')?.focus();
  });

  document.addEventListener('gc-view-changed', event => {
    const view = typeof event.detail === 'string' ? event.detail : currentView();
    handleView(view);
  });
  document.addEventListener('gc-portal-runtime-ready', () => handleView(currentView()));
  window.addEventListener('hashchange', () => handleView(currentView()));
  window.addEventListener('pageshow', () => handleView(currentView()));

  ensureStyles();
  organizeSidebar();
  watchSidebar();
  setTimeout(() => handleView(currentView()), 0);
  setTimeout(() => handleView(currentView()), 1200);

  window.GotCrackedKnowledgeBase = {
    render: renderKnowledgeBase,
    organizeSidebar,
    get guides() { return guides(); },
    get sources() { return SOURCE_LIBRARY.map(source => ({ ...source })); }
  };
})();
