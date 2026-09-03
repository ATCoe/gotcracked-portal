(() => {
  'use strict';

  if (window.GotCrackedMobileDialogCompat) return;

  const mobile = window.matchMedia('(max-width: 750px)');
  const TARGET_IDS = new Set([
    'v1-intake-dialog',
    'gc-lead-create-dialog',
    'portal-v1-lead-dialog',
    'gc-pcbuild-dialog'
  ]);
  const viewport = window.visualViewport;
  const returnFocusByDialog = new WeakMap();
  let viewportFrame = 0;

  const proto = window.HTMLDialogElement?.prototype;
  const nativeShowModal = proto?.showModal;
  if (!proto || typeof nativeShowModal !== 'function') return;

  function visibleViewport() {
    const height = Math.max(240, Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight));
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
    return { height, top };
  }

  function syncDialogViewport(dialog) {
    if (!mobile.matches || !dialog?.open || dialog.dataset.gcMobileDialogCompat !== 'true') return;
    const { height, top } = visibleViewport();
    dialog.style.setProperty('--gc-mobile-dialog-height', `${height}px`);
    dialog.style.setProperty('--gc-mobile-dialog-top', `${top}px`);
    dialog.style.setProperty('inset', `${top}px 0 auto 0`, 'important');
    dialog.style.setProperty('height', `${height}px`, 'important');
    dialog.style.setProperty('max-height', `${height}px`, 'important');
  }

  function syncOpenDialogs() {
    viewportFrame = 0;
    document.querySelectorAll('dialog[open][data-gc-mobile-dialog-compat="true"]').forEach(syncDialogViewport);
  }

  function scheduleViewportSync() {
    if (viewportFrame) cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(syncOpenDialogs);
  }

  function cleanup(dialog) {
    dialog.style.removeProperty('position');
    dialog.style.removeProperty('inset');
    dialog.style.removeProperty('height');
    dialog.style.removeProperty('z-index');
    dialog.style.removeProperty('max-width');
    dialog.style.removeProperty('max-height');
    dialog.style.removeProperty('--gc-mobile-dialog-height');
    dialog.style.removeProperty('--gc-mobile-dialog-top');
    delete dialog.dataset.gcMobileDialogCompat;
  }

  function prepare(dialog) {
    dialog.dataset.gcMobileDialogCompat = 'true';
    dialog.style.setProperty('position', 'fixed', 'important');
    dialog.style.setProperty('z-index', '1000', 'important');
    dialog.style.setProperty('max-width', '100vw', 'important');

    if (dialog.dataset.gcMobileDialogCleanupBound !== 'true') {
      dialog.dataset.gcMobileDialogCleanupBound = 'true';
      dialog.addEventListener('close', () => {
        cleanup(dialog);
        const destination=returnFocusByDialog.get(dialog);
        returnFocusByDialog.delete(dialog);
        if(destination?.isConnected)requestAnimationFrame(()=>destination.focus({preventScroll:true}));
      });
    }
  }

  proto.showModal = function patchedShowModal() {
    if (!mobile.matches || !TARGET_IDS.has(this.id)) {
      return nativeShowModal.call(this);
    }

    if (this.open) return;
    if(document.activeElement instanceof HTMLElement)returnFocusByDialog.set(this,document.activeElement);
    prepare(this);

    /*
     * Android occasionally enters the modal top layer without painting these
     * dynamically-rendered full-screen dialogs. The page then becomes inert,
     * which looks like the Portal froze. On phones these workflows already fill
     * the viewport, so use a fixed non-modal dialog instead. It looks identical
     * but cannot make the document inert behind an invisible native modal.
     *
     * The visual viewport shrinks when the software keyboard opens while 100dvh
     * often continues to describe the layout viewport. Sync the dialog to the
     * visual viewport so its fixed footer remains above the keyboard.
     */
    if (typeof this.show === 'function') this.show();
    else this.setAttribute('open', '');
    syncDialogViewport(this);
    requestAnimationFrame(() => syncDialogViewport(this));
  };

  viewport?.addEventListener('resize', scheduleViewportSync, { passive:true });
  viewport?.addEventListener('scroll', scheduleViewportSync, { passive:true });
  window.addEventListener('resize', scheduleViewportSync, { passive:true });
  mobile.addEventListener?.('change', scheduleViewportSync);

  document.addEventListener('focusin', event => {
    if (!mobile.matches || !(event.target instanceof Element)) return;
    if (event.target.closest('dialog[data-gc-mobile-dialog-compat="true"]')) {
      setTimeout(scheduleViewportSync, 0);
      setTimeout(scheduleViewportSync, 120);
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !mobile.matches) return;
    const open = [...document.querySelectorAll('dialog[open][data-gc-mobile-dialog-compat="true"]')].pop();
    if (open) {
      event.preventDefault();
      try { open.close(); } catch { open.removeAttribute('open'); cleanup(open); }
    }
  }, true);

  window.GotCrackedMobileDialogCompat = {
    version: '20260827-dialog3',
    isActive: () => mobile.matches,
    sync: scheduleViewportSync
  };
})();

