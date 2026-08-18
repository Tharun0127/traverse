# Ledger API — Technical Documentation

The Ledger API records immutable financial events. This document covers authentication, the event model, idempotency, pagination, rate limits, and error semantics.

## Authentication

All requests require a bearer token in the `Authorization` header. Tokens are issued per environment and never expire, but they can be revoked. A revoked token returns 401 with code `token_revoked`.

Tokens carry a scope: `read`, `write`, or `admin`. A `write` token implies `read`. An `admin` token is required only for account closure and manual adjustments.

## The event model

The ledger stores events, not balances. A balance is always computed by folding events, never stored directly. This means a balance query is more expensive than a write, which is the opposite of most systems and is intentional — it makes the ledger auditable by construction.

Every event has an `id`, an `account_id`, an `amount` in minor units, a `currency`, an `occurred_at` timestamp, and a `type`. Events are append-only. There is no update or delete endpoint.

Correcting a mistake means writing a compensating event of the opposite sign, linked to the original by `corrects`. The original remains visible forever.

## Amounts and currency

Amounts are integers in the currency's minor unit. A value of `1050` with currency `USD` is ten dollars and fifty cents. Never send a decimal — a decimal amount is rejected with 400 and code `amount_not_integer`.

Currencies without minor units, such as JPY, use the integer directly. A value of `1050` with currency `JPY` is one thousand and fifty yen.

Mixing currencies within one account is not permitted. An account's currency is fixed at creation.

## Idempotency

Every write accepts an `Idempotency-Key` header. Keys are scoped to the endpoint and retained for twenty-four hours.

Replaying a request with the same key and the same body returns the original response with header `Idempotency-Replayed: true`. Replaying with the same key and a *different* body returns 409 with code `idempotency_key_reuse` — this is a client bug and the ledger deliberately refuses to guess which body was intended.

Keys are not required, but a write without one that times out cannot be safely retried. Always send one.

## Pagination

List endpoints are cursor paginated. Pass `limit` up to 200 and follow `next_cursor` until it is null. Offset pagination is not supported, because the ledger is append-only and offsets shift as events arrive.

Cursors are opaque and expire after one hour. An expired cursor returns 400 with code `cursor_expired`; restart the iteration rather than trying to resume.

## Rate limits

Rate limits are per token, not per account. The default is 100 requests per second for reads and 20 per second for writes, measured in a one-second sliding window.

Exceeding a limit returns 429 with a `Retry-After` header in seconds. The header is authoritative — backing off less than it says will extend the penalty window rather than shorten it.

Balance queries count as five reads because of the fold cost. Bulk balance retrieval should use the snapshot endpoint instead.

## Snapshots

The snapshot endpoint returns precomputed balances for up to 500 accounts in one call. Snapshots are computed every sixty seconds, so they lag real time by up to a minute.

Never use a snapshot for authorization decisions. Use a live balance query, which is consistent as of the moment it returns.

## Error semantics

A 4xx means the request will never succeed as written; do not retry it. A 5xx means the request may succeed later; retry with exponential backoff and jitter.

The one exception is 409 `concurrent_write`, which is a 4xx that *should* be retried. It indicates two writes raced on the same account. Retry immediately, up to three times.

Every error body carries `code`, `message`, and `request_id`. Always log `request_id` — support cannot investigate without it.

## Webhooks

Webhooks are delivered at least once, so handlers must be idempotent. Each delivery carries an `X-Ledger-Signature` header, an HMAC of the raw body with your webhook secret.

Verify the signature against the raw bytes, before any JSON parsing. Parsing and re-serialising changes whitespace and invalidates the signature.

Failed deliveries retry for twenty-four hours with exponential backoff, then move to the dead letter queue, which is readable from the dashboard for seven days.
