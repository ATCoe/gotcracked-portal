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

  const proto = window.HTMLDialogElement?.prototype;
  const nativeShowModal = proto?.showModal;
  if (!proto || typeof nativeShowModal !== 'function') return;

  function cleanup(dialog) {
    dialog.style.removeProperty('position');
    dialog.style.removeProperty('inset');
    dialog.style.removeProperty('z-index');
    dialog.style.removeProperty('max-width');
    dialog.style.removeProperty('max-height');
    delete dialog.dataset.gcMobileDialogCompat;
  }

  function prepare(dialog) {
    dialog.dataset.gcMobileDialogCompat = 'true';
    dialog.style.setProperty('position', 'fixed', 'important');
    dialog.style.setProperty('inset', '0', 'important');
    dialog.style.setProperty('z-index', '1000', 'important');
    dialog.style.setProperty('max-width', '100vw', 'important');
    dialog.style.setProperty('max-height', '100dvh', 'important');

    if (dialog.dataset.gcMobileDialogCleanupBound !== 'true') {
      dialog.dataset.gcMobileDialogCleanupBound = 'true';
      dialog.addEventListener('close', () => cleanup(dialog));
    }
  }

  proto.showModal = function patchedShowModal() {
    if (!mobile.matches || !TARGET_IDS.has(this.id)) {
      return nativeShowModal.call(this);
    }

    if (this.open) return;
    prepare(this);

    /*
     * Android occasionally enters the modal top layer without painting these
     * dynamically-rendered full-screen dialogs. The page then becomes inert,
     * which looks like the Portal froze. On phones these workflows already fill
     * the viewport, so use a fixed non-modal dialog instead. It looks identical
     * but cannot make the document inert behind an invisible native modal.
     */
    if (typeof this.show === 'function') this.show();
    else this.setAttribute('open', '');
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !mobile.matches) return;
    const open = [...document.querySelectorAll('dialog[open][data-gc-mobile-dialog-compat="true"]')].pop();
    if (open) {
      event.preventDefault();
      try { open.close(); } catch { open.removeAttribute('open'); cleanup(open); }
    }
  }, true);

  window.GotCrackedMobileDialogCompat = {
    version: '20260826-dialog2',
    isActive: () => mobile.matches
  };
})();
