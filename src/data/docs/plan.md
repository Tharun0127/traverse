# Execution Plan — Search Re-Platform

Plan for migrating product search from the legacy Solr cluster to the new vector-hybrid service. Target: complete before the November freeze.

## Objective

Cut p95 search latency from 780ms to under 250ms, and raise zero-result rate improvement by at least 30 percent on long-tail queries, without a visible cutover to customers.

Success is measured on the search conversion metric, not on latency alone. A faster search that converts worse is a failed migration.

## Phase 1 — Shadow indexing

Build the new index alongside the old one. Every write to the catalogue fans out to both. No read traffic touches the new index yet.

Shadow indexing runs for at least two weeks so we observe a full merchandising cycle, including a weekend promotion. Exit criterion is index parity above 99.9 percent measured by nightly diff.

Owner: search platform. Estimated three weeks including the parity harness.

## Phase 2 — Dark reads

Send a copy of every production query to the new service. Discard the response, record the latency and the result set. Compare result sets offline against the legacy response.

This phase surfaces relevance regressions without any customer risk. Exit criterion is that the top-three overlap with legacy exceeds 85 percent on head queries, and human relevance review of a 500-query long-tail sample scores no worse than legacy.

Dark reads double query volume, so provision the new cluster for full production load before starting.

Owner: search platform with relevance review from merchandising. Estimated two weeks.

## Phase 3 — Canary

Route one percent of live traffic to the new service, held for 48 hours, then five percent, then twenty-five.

Each step requires the conversion metric to be flat or better against a holdout, measured over at least 24 hours. A conversion drop beyond 0.5 percent relative reverts to the previous step automatically.

Do not advance two steps in one day. The conversion signal is noisy at low traffic and needs the time to separate from variance.

Owner: search platform. Estimated two weeks assuming no reverts.

## Phase 4 — Full cutover and decommission

Move to 100 percent, keep the legacy cluster warm and writable for thirty days, then decommission.

The thirty-day window is not padding. It covers the quarterly merchandising review, which is the most likely time someone discovers a relevance regression the automated checks missed.

Owner: search platform and infrastructure. Estimated one week active, thirty days elapsed.

## Dependencies

Phase 2 cannot start before the catalogue write fan-out from Phase 1 is stable, because dark read comparison against a stale index produces meaningless diffs.

Phase 3 requires the conversion holdout infrastructure, owned by the experimentation team, which is currently scheduled for late September. This is the critical path item.

The November freeze begins on the 15th. Working backwards, Phase 3 must begin by October 20th at the latest.

## Risks

The largest risk is the experimentation dependency slipping. If the holdout infrastructure is not ready by October 1st, we either delay past the freeze or run the canary on latency and error rate alone, accepting that we would not detect a conversion regression until after full cutover. The second option is not recommended.

Second risk is index parity never reaching 99.9 percent because of a class of catalogue update the fan-out does not handle. Mitigation is to build the nightly diff harness in week one of Phase 1 rather than at the end, so we learn early.

Third risk is cost. The new cluster during dark reads runs at double capacity for two weeks. Budget is approved but a schedule slip extends that burn.

## Explicitly out of scope

Personalised ranking is not part of this migration. It is a follow-on project and folding it in would make the conversion signal impossible to attribute.

Search UI changes are out of scope. The migration must be invisible; changing the interface at the same time would confound the measurement.
