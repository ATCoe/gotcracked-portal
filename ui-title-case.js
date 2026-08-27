(() => {
  'use strict';

  if (window.GotCrackedTitleCase) return;

  const VERSION = '20260827-titlecase2';
  const minorWords = new Set([
    'a','an','and','as','at','but','by','for','from','in','into','nor','of','on','or','per','the','to','via','vs','with'
  ]);
  const acronyms = new Map([
    ['ai','AI'],['api','API'],['csv','CSV'],['id','ID'],['imei','IMEI'],['ip','IP'],['pdf','PDF'],
    ['pos','POS'],['qr','QR'],['rma','RMA'],['sku','SKU'],['sms','SMS'],['ui','UI'],['url','URL'],
    ['usb','USB'],['wifi','Wi-Fi'],['zip','ZIP']
  ]);
  const exactPhrases = new Map([
    ['need to order','Need to Order'],
    ['awaiting parts','Awaiting Parts'],
    ['time clock','Time Clock'],
    ['off clock','Off Clock'],
    ['on break','On Break'],
    ['clock in','Clock In'],
    ['clock out','Clock Out'],
    ['start break','Start Break'],
    ['end break','End Break'],
    ['on time','On Time'],
    ['in progress','In Progress'],
    ['ready for pickup','Ready for Pickup'],
    ['waiting on customer','Waiting on Customer'],
    ['work order','Work Order'],
    ['new work order','New Work Order']
  ]);

  const candidateSelector = [
    'h1','h2','h3','h4','h5','h6','legend','summary','th','label','option',
    'button','[role="button"]','[role="tab"]','[role="menuitem"]',
    'nav a','.sidebar .nav-item','.nav-label','.tab-label',
    '.badge','.chip','.pill','.tag','.status','.status-badge','.status-chip','.status-pill','.status-label','[data-status-label]',
    '.gc-timeclock-state','.gc-dashboard-clock-copy > small',
    '.card-title','.panel-title','.section-title','.modal-title','.dialog-title'
  ].join(',');

  const excludedSelector = [
    '[data-preserve-case]','.gc-no-title-case','[contenteditable="true"]',
    'code','pre','kbd','samp'
  ].join(',');

  function isMixedCaseBrand(word) {
    return /[a-z][A-Z]|[A-Z][a-z]+[A-Z]/.test(word);
  }

  function normalizePart(part, index, total, forceMajor = false) {
    if (!part) return part;
    const match = part.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    if (!match) return part;
    const [, prefix, core, suffix] = match;
    if (!core) return part;

    const lower = core.toLowerCase();
    if (acronyms.has(lower)) return `${prefix}${acronyms.get(lower)}${suffix}`;
    if (/^[A-Z0-9]{2,6}$/.test(core) || isMixedCaseBrand(core)) return part;
    if (/^\d/.test(core)) return part;

    if (core.includes('/')) {
      const pieces = core.split('/').map(piece => normalizePart(piece, 0, 1, true));
      return `${prefix}${pieces.join('/')}${suffix}`;
    }
    if (core.includes('-')) {
      const pieces = core.split('-').map(piece => normalizePart(piece, 0, 1, true));
      return `${prefix}${pieces.join('-')}${suffix}`;
    }

    if (!forceMajor && index > 0 && index < total - 1 && minorWords.has(lower)) {
      return `${prefix}${lower}${suffix}`;
    }
    return `${prefix}${lower.charAt(0).toUpperCase()}${lower.slice(1)}${suffix}`;
  }

  function toTitleCase(value) {
    const raw = String(value ?? '');
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    const exact = exactPhrases.get(trimmed.toLowerCase());
    if (exact) return raw.replace(trimmed, exact);

    if (trimmed.length > 72) return raw;
    if (/[.!?]$/.test(trimmed)) return raw;
    if (/[@]|https?:\/\/|www\./i.test(trimmed)) return raw;
    if (/^[$+\-]?\d[\d\s:/.%-]*$/.test(trimmed)) return raw;

    const words = trimmed.split(/\s+/);
    if (words.length > 10) return raw;
    if (words.every(word => /^[A-Z0-9&/+.-]+$/.test(word))) return raw;

    const converted = words.map((word, index) => normalizePart(word, index, words.length)).join(' ');
    return converted === trimmed ? raw : raw.replace(trimmed, converted);
  }

  function shouldProcess(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest(excludedSelector)) return false;
    if (!element.matches(candidateSelector)) return false;
    return true;
  }

  function normalizeElement(element) {
    if (!shouldProcess(element)) return;
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const next = toTitleCase(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  function normalizeTree(root = document) {
    if (root instanceof Element) normalizeElement(root);
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll?.(candidateSelector).forEach(normalizeElement);
  }

  let queued = false;
  const pendingRoots = new Set();
  function schedule(root) {
    if (root) pendingRoots.add(root);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      if (!roots.length) normalizeTree(document);
      else roots.forEach(normalizeTree);
    });
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
        schedule(record.target.parentElement);
        continue;
      }
      record.addedNodes.forEach(node => {
        if (node instanceof Element) schedule(node);
        else if (node.parentElement) schedule(node.parentElement);
      });
    }
  });

  function start() {
    normalizeTree(document);
    observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();

  document.addEventListener('gc-view-changed', () => schedule(document.body));
  document.addEventListener('gc-portal-runtime-ready', () => schedule(document.body));

  window.GotCrackedTitleCase = {
    version: VERSION,
    format: toTitleCase,
    refresh: () => schedule(document.body)
  };
})();
