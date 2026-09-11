# MobileSentrix integration

GotCracked treats MobileSentrix as a supplier catalog, not as proof that a part is physically on a GotCracked shelf.

- `parts_registry` contains normalized repair-part identities.
- `part_source_listings` contains MobileSentrix SKUs, account pricing, availability, and supplier URLs.
- `part_price_history` records supplier price and availability changes.
- `inventory_items` remains the physical shop ledger and only changes through receiving, adjustments, reservations, and consumption workflows.

## Account and consumer status

The Blacksburg supplier account is linked as `GotCracked MobileSentrix`. An API consumer named `GotCracked Inventory Portal` has been requested in the MobileSentrix account.

The integration uses MobileSentrix's Magento 1/OpenMage-style REST surface:

- API base: `https://www.mobilesentrix.com`
- Catalog resource: `/api/rest/products`
- OAuth request-token endpoint: `/oauth/initiate`
- OAuth authorization endpoint: `/oauth/authorize`
- OAuth access-token endpoint: `/oauth/token`
- Portal callback: `https://portal.gotcracked.co/?mobilesentrix_oauth=callback`

## Production connection

1. Obtain the consumer key and consumer secret from the approved MobileSentrix API consumer.
2. Open Portal → Settings → MobileSentrix.
3. Save the consumer key and consumer secret. Secrets are written to Supabase Vault and are never read back into the browser.
4. Select **Authorize MobileSentrix account** and approve the GotCracked account on MobileSentrix.
5. Return to the Portal, run **Test API**, and then run **Sync full catalog**.

An already-issued access token and token secret can also be saved directly.

## CSV fallback

A MobileSentrix CSV can seed the same normalized registry while API approval is pending. CSV import is intentionally non-authoritative unless the operator checks **This export is a complete MobileSentrix catalog snapshot**. Only an authoritative full snapshot may deactivate supplier listings that disappeared from the file.

CSV import never sets GotCracked on-hand quantity. Supplier quantity, when present, is stored as supplier metadata and availability text.

## Sync safety

- Supplier requests are restricted to HTTPS MobileSentrix domains.
- Catalog and OAuth paths must remain same-origin absolute paths.
- API responses are normalized in bounded batches.
- Full sync is resumable through `last_cursor` and run metadata.
- Old listings are deactivated only after the final page of a successful full run.
- Secrets and raw supplier HTML are redacted from errors.
- Purchase, checkout, and payment automation are outside this integration.
