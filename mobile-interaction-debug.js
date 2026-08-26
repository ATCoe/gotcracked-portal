(() => {
  'use strict';

  if (window.GotCrackedMobileInteractionDebug) return;

  const mobile = window.matchMedia('(max-width: 750px)');
  const isTraining = () => localStorage.getItem('gc-training-store') === '1';
  if (!mobile.matches || !isTraining()) return;

  const state = { last:'boot', error:'', wrapped:false, seq:0, eventTarget:'-', eventTop:'-', eventStack:'-' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

  function describe(node) {
    if (!(node instanceof Element)) return String(node?.nodeName || 'none');
    const id = node.id ? `#${node.id}` : '';
    const classes = [...node.classList].slice(0,3).map(c=>`.${c}`).join('');
    const flags = [
      node.hasAttribute('data-open-ticket') ? '[open-ticket]' : '',
      node.hasAttribute('data-v1-walkin') ? '[walkin]' : '',
      node.classList.contains('mobile-menu') ? '[menu]' : '',
      node.hasAttribute('data-v1-new-lead') ? '[new-lead]' : ''
    ].filter(Boolean).join('');
    return `${node.tagName.toLowerCase()}${id}${classes}${flags}`;
  }

  function dialogSummary() {
    const rows = [...document.querySelectorAll('dialog[open]')].map(dialog => {
      const css = getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      return `${dialog.id||'dialog'}:${Math.round(rect.width)}x${Math.round(rect.height)}/${css.display}/${css.visibility}`;
    });
    return rows.length ? rows.join(',') : 'none';
  }

  function inertOwner(node) {
    let current = node instanceof Element ? node : null;
    while (current) {
      if (current.inert || current.hasAttribute('inert')) return describe(current);
      current = current.parentElement;
    }
    return 'none';
  }

  function hitSummary(selector, label) {
    const el = document.querySelector(selector);
    if (!(el instanceof Element)) return `${label}=missing`;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return `${label}=zero-rect`;
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x,y);
    const stack = document.elementsFromPoint(x,y).slice(0,3).map(describe).join('>') || '-';
    const css = getComputedStyle(el);
    return `${label}:hit=${describe(top)} pe=${css.pointerEvents} inert=${inertOwner(el)} stack=${stack}`;
  }

  function rootSummary() {
    const nodes = [
      ['html',document.documentElement],
      ['body',document.body],
      ['shell',document.querySelector('.app-shell')],
      ['main',document.querySelector('main')]
    ];
    return nodes.map(([name,node])=>{
      if (!(node instanceof Element)) return `${name}:missing`;
      const css=getComputedStyle(node);
      return `${name}:${css.pointerEvents}${node.inert||node.hasAttribute('inert')?'/INERT':''}`;
    }).join(' ');
  }

  function specialTopLayerSummary() {
    let modal='none', popover='none';
    try { modal=describe(document.querySelector(':modal')); } catch {}
    try { popover=describe(document.querySelector(':popover-open')); } catch {}
    const fullscreen=describe(document.fullscreenElement);
    return `modal=${modal} pop=${popover} fs=${fullscreen}`;
  }

  function ensurePanel() {
    let panel = document.getElementById('gc-mobile-touch-debug');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'gc-mobile-touch-debug';
    panel.setAttribute('aria-hidden','true');
    panel.style.cssText = [
      'position:fixed','left:6px','right:6px','bottom:6px','z-index:2147483647',
      'pointer-events:none','padding:7px 8px','border-radius:8px',
      'background:rgba(0,0,0,.88)','color:#fff','font:9px/1.24 ui-monospace,SFMono-Regular,Consolas,monospace',
      'white-space:normal','overflow-wrap:anywhere','box-shadow:0 2px 12px rgba(0,0,0,.3)'
    ].join(';');
    document.body.appendChild(panel);
    return panel;
  }

  function paint(label, event=null) {
    const panel = ensurePanel();
    const ops = window.GotCrackedOperationsV1;
    const sidebar = document.querySelector('.sidebar');
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      state.eventTarget = describe(event.target);
      state.eventTop = describe(document.elementFromPoint(event.clientX,event.clientY));
      state.eventStack = document.elementsFromPoint(event.clientX,event.clientY).slice(0,4).map(describe).join(' > ') || '-';
    }
    const perm = ops?.state?.permissions instanceof Map ? ops.state.permissions.get('repairs.intake') : undefined;
    const lines = [
      `#${++state.seq} ${label} last=${state.last}`,
      `EVENT target=${state.eventTarget} top=${state.eventTop} stack=${state.eventStack}`,
      hitSummary('[data-v1-walkin]','WALK'),
      hitSummary('[data-open-ticket]','WORK'),
      hitSummary('.mobile-menu','MENU'),
      rootSummary(),
      specialTopLayerSummary(),
      `runtime=${document.documentElement.dataset.gcRuntimeState||'-'}/${document.documentElement.dataset.gcPortalBoot||'-'} ops=${typeof ops?.openIntake==='function'} launcher=${!!window.GotCrackedActionLaunchers} compat=${window.GotCrackedMobileDialogCompat?.version||'-'} perm=${String(perm)}`,
      `dialogs=${dialogSummary()} sidebar=${sidebar?.classList.contains('open')?'open':'closed'} body=${document.body.className||'-'}`,
      state.error ? `ERROR=${state.error}` : 'ERROR=none'
    ];
    panel.innerHTML = lines.map(esc).join('<br>');
  }

  function record(type,event) {
    state.last = `${type}:${describe(event.target)}`;
    paint(type,event);
  }

  window.addEventListener('pointerdown', event => record('PD',event), true);
  window.addEventListener('pointerup', event => record('PU',event), true);
  window.addEventListener('click', event => record('CLICK',event), true);
  window.addEventListener('touchstart', event => {
    const touch=event.touches?.[0];
    state.last=`TS:${describe(event.target)}`;
    if (touch) {
      state.eventTarget=describe(event.target);
      state.eventTop=describe(document.elementFromPoint(touch.clientX,touch.clientY));
      state.eventStack=document.elementsFromPoint(touch.clientX,touch.clientY).slice(0,4).map(describe).join(' > ')||'-';
    }
    paint('TOUCHSTART');
  }, true);

  window.addEventListener('error', event => {
    state.error = `${event.message || 'window error'} @ ${event.filename?.split('/').pop()||'?'}:${event.lineno||0}`;
    paint('ERROR');
  });
  window.addEventListener('unhandledrejection', event => {
    state.error = `promise: ${event.reason?.message || String(event.reason || 'unknown')}`;
    paint('REJECTION');
  });

  function wrapOperations() {
    if (state.wrapped) return true;
    const ops = window.GotCrackedOperationsV1;
    if (!ops || typeof ops.openIntake !== 'function') return false;
    const original = ops.openIntake;
    ops.openIntake = function(...args) {
      state.last = 'CALL openIntake';
      paint('CALL openIntake');
      try {
        const result = original.apply(this,args);
        requestAnimationFrame(() => {
          state.last = `RETURN openIntake dialog=${document.getElementById('v1-intake-dialog')?.open ? 'open' : 'closed'}`;
          paint('RETURN openIntake');
        });
        return result;
      } catch (error) {
        state.error = `openIntake: ${error?.message || error}`;
        paint('THROW openIntake');
        throw error;
      }
    };
    state.wrapped = true;
    state.last='wrapped openIntake';
    paint('wrapped openIntake');
    return true;
  }

  let attempts = 0;
  const wrapTimer = setInterval(() => {
    attempts += 1;
    if (wrapOperations() || attempts > 120) clearInterval(wrapTimer);
  },100);

  const nativeShow = window.HTMLDialogElement?.prototype?.show;
  if (typeof nativeShow === 'function' && !nativeShow.__gcDebugWrapped) {
    const wrappedShow = function(...args) {
      state.last = `DIALOG show ${this.id||'dialog'}`;
      paint(state.last);
      try { return nativeShow.apply(this,args); }
      catch(error) { state.error=`dialog.show: ${error?.message||error}`; paint('THROW dialog.show'); throw error; }
    };
    wrappedShow.__gcDebugWrapped = true;
    window.HTMLDialogElement.prototype.show = wrappedShow;
  }

  const dialogObserver = new MutationObserver(records => {
    if (!records.some(r => r.target instanceof HTMLDialogElement)) return;
    state.last = `dialog mutation ${dialogSummary()}`;
    paint('DIALOG mutation');
  });
  dialogObserver.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['open','inert']});

  const scanTimer=setInterval(()=>paint('SCAN'),750);
  document.addEventListener('gc-portal-runtime-ready',()=>paint('runtime ready'),{once:true});
  setTimeout(()=>paint('debug ready'),0);

  window.GotCrackedMobileInteractionDebug = {
    version:'20260826-touch2',
    state,
    paint:()=>paint('manual'),
    stop(){ clearInterval(wrapTimer); clearInterval(scanTimer); dialogObserver.disconnect(); document.getElementById('gc-mobile-touch-debug')?.remove(); }
  };
})();
