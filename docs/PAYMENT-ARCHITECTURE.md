# GotCracked Payment Architecture

## Purpose

GotCracked owns the repair, balance, receipt, reconciliation, and customer-account state. Payment processors are adapters behind one provider-neutral contract.

The system is intentionally deployable before a merchant account exists. Until a provider connection is verified, customer online checkout remains unavailable and no payment state can be created from the browser.

## Non-negotiable trust rules

- API keys, access tokens, webhook signing secrets, and merchant secrets never live in browser JavaScript or browser-readable database settings.
- A checkout return URL is navigation only. It never proves payment.
- Only a signed trusted server callback may create a verified provider transaction.
- Provider events and transactions are idempotent.
- Refunds are ledger transactions and recompute the repair's verified paid amount.
- Pickup checkout uses the remaining balance after all verified prepayments, preventing double charging.

## Runtime components

- `customer-account`: owns customer identity/session checks and requests a checkout only for an owned repair.
- `payment-gateway`: service-only checkout coordinator. It validates provider connection, repair stage, balance, and partial-payment policy before calling the provider adapter.
- `payment-webhook`: signed inbound event receiver. It normalizes verified payment/refund events into the GotCracked ledger.
- `payment_provider_connections`: non-secret provider state and capabilities.
- `payment_checkout_sessions`: hosted checkout/session lifecycle and idempotency.
- `payment_transactions`: canonical provider payment/refund transaction ledger.
- `payment_provider_events`: service-only webhook audit/dedupe log.
- `payment_requests`: customer/repair amount requested and verified amount.

## Protected environment contract

When a provider is connected, install these protected Edge Function secrets:

- `PAYMENT_BRIDGE_URL` — HTTPS adapter endpoint that creates hosted checkout sessions.
- `PAYMENT_BRIDGE_TOKEN` — service token used only by `payment-gateway` to call the adapter.
- `PAYMENT_BRIDGE_WEBHOOK_SECRET` — HMAC-SHA256 secret shared with the adapter for normalized inbound events.

A direct provider-specific Edge adapter may replace the bridge later, but it must preserve the same trust and idempotency rules.

## Create-checkout bridge request

`payment-gateway` sends a JSON request with `version: "2026-08-28"`, `action: "create_checkout"`, provider, idempotency key, GotCracked payment request/ticket identifiers, amount/currency, return/cancel URLs, customer contact, repair description, merchant reference, public provider configuration, and GotCracked metadata.

The adapter must return:

- `checkoutUrl` — HTTPS hosted checkout URL.
- `providerSessionId` — stable provider checkout/session identifier.
- `providerPaymentId` — optional provider payment intent/order identifier.
- `expiresAt` — optional ISO timestamp.

The adapter must honor the supplied `Idempotency-Key` header. Retrying the same GotCracked request must not create duplicate provider checkout obligations.

## Normalized webhook contract

The adapter POSTs raw JSON to `payment-webhook` with header `x-gotcracked-signature: sha256=<hex HMAC-SHA256(raw body)>`.

Supported money-changing event types are `payment.succeeded` and `refund.succeeded`. The payload includes `provider`, `eventId`, `paymentRequestId`, `transactionId`, `amountCents`, currency, optional provider session/reference/card/fee fields, timestamp, and metadata.

The webhook rejects unsigned/invalid events before any database write. Unknown signed event types are audited as ignored rather than being allowed to change balances.

## Future activation: "wire payment to Portal"

1. Choose the real provider in Portal Payment settings and keep it in test/sandbox mode.
2. Build/connect that provider's adapter to the normalized create-checkout and webhook contracts above.
3. Install `PAYMENT_BRIDGE_URL`, `PAYMENT_BRIDGE_TOKEN`, and `PAYMENT_BRIDGE_WEBHOOK_SECRET` as protected Supabase Edge secrets (or deploy an equivalent direct provider adapter).
4. Verify merchant identity/capabilities server-side, then set `payment_provider_connections.connection_status` to `connected` through the service-only connection-state RPC.
5. Arm Customer Checkout in Portal settings. Availability will still require a connected provider and an eligible repair stage.
6. Run sandbox tests for successful payment, duplicate webhook, cancelled checkout, delayed webhook, partial payment if enabled, refund, and pickup after prepayment.
7. Confirm Portal balance, customer account, receipt prepayment split, sales ledger, and reconciliation agree.
8. Switch the provider connection to live only after sandbox tests pass, then repeat one controlled live transaction/refund verification.

No customer-facing or work-order redesign should be required at activation time; the remaining work is provider credentials/API adaptation plus sandbox/live verification.
