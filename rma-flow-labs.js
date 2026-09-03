(() => {
  'use strict';

  // RMA Flow Labs is deliberately inert unless the hosting environment opts in.
  // The flag must be supplied by deployment configuration; there is no client
  // control that can turn the beta on for an unauthorized staff member.
  const enabled = window.GotCrackedFeatureFlags?.RMA_FLOW_LABS === true;
  if (!enabled || window.GotCrackedRmaFlowLabs) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  function render() {
    const inventory = document.getElementById('inventory');
    if (!inventory || document.getElementById('gc-rma-flow-labs')) return;
    const section = document.createElement('section');
    section.id = 'gc-rma-flow-labs';
    section.className = 'card gc-rma-flow-labs';
    section.innerHTML = `<div class="card-title"><div><p class="eyebrow">RMA Flow Labs · internal beta</p><h2>Parts sourcing and returns</h2><p class="subtle">A controlled proving ground for source comparison, purchase requests, receiving, and supplier returns.</p></div><span class="gc-rma-flow-badge">Labs</span></div><div class="gc-rma-flow-grid"><div><strong>Registry</strong><span>Sourceable parts and supplier listings</span></div><div><strong>Physical inventory</strong><span>On-hand stock remains authoritative</span></div><div><strong>Purchase queue</strong><span>Approval required · no autonomous ordering</span></div><div><strong>Returns</strong><span>RMA evidence, status, and repair linkage</span></div></div><p class="gc-rma-flow-note"><strong>Safe beta boundary:</strong> supplier availability never changes on-hand quantity. Checkout and account actions remain manual until an approved provider adapter exists.</p>`;
    inventory.appendChild(section);
  }

  window.GotCrackedRmaFlowLabs = Object.freeze({
    version: '20260902-labs1',
    enabled,
    render,
    normalizeListing(listing = {}) {
      return Object.freeze({
        supplierId: esc(listing.supplier_id),
        supplierSku: esc(listing.supplier_sku),
        priceCents: Number.isFinite(Number(listing.price_cents)) ? Number(listing.price_cents) : null,
        availability: esc(listing.availability),
        fetchedAt: esc(listing.fetched_at || listing.last_seen_at),
        sourceUrl: esc(listing.source_url)
      });
    }
  });

  document.addEventListener('gc-inventory-command-center-rendered', render);
})();

