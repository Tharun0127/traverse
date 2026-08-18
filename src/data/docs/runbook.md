# Payments Service — Production Runbook

This runbook covers deploy, rollback, and incident response for the payments service. On-call engineers should read the escalation policy before their first shift.

## Prerequisites

Before any production action you need VPN access, an approved change ticket, and membership of the `payments-oncall` group. Access requests go through the platform team and take up to two business days. Do not attempt production changes without all three.

## Deploy to staging

Staging deploys are automatic on merge to `main`. The pipeline runs unit tests, integration tests against a sandboxed Stripe account, and a smoke suite. A staging deploy takes about eleven minutes end to end.

```bash
./scripts/deploy.sh --env staging --wait
```

If the smoke suite fails, the deploy halts and the previous version stays live. Check the pipeline logs before retrying — a retry on a genuine failure will simply fail again.

## Deploy to production

Production deploys are manual and require two approvals recorded in the change ticket. The deploy window is 10:00 to 16:00 on weekdays. Never deploy on a Friday after 14:00.

```bash
./scripts/deploy.sh --env production --canary 5 --wait
```

The canary flag routes five percent of traffic to the new version for twenty minutes. Error rate and p99 latency are compared against the previous version. If either regresses beyond the threshold the canary is pulled automatically.

The canary threshold is a 0.5 percent absolute increase in error rate, or a 200ms increase in p99 latency. These thresholds live in `config/canary.yaml` and changing them requires a separate approval.

## Verify a deploy

After the canary completes, confirm the rollout before closing the ticket.

```bash
./scripts/verify.sh --env production --since 20m
```

The verify script checks that the reported version matches the intended commit, the health endpoint returns 200, the error budget has not been consumed beyond ten percent for the day, and no alerts fired during the canary window.

## Rollback

Rollback is the first response to any production incident. Diagnose afterwards, not before.

```bash
./scripts/rollback.sh --env production --to-previous
```

Rollback takes roughly ninety seconds. It restores the previous container image and the previous configuration snapshot together — configuration and code are versioned as one unit specifically so a rollback cannot leave them mismatched.

A rollback does not revert database migrations. If the deploy included a migration, consult the migration rollback section before rolling back, because a code rollback against a migrated schema can corrupt payment records.

## Migration rollback

Migrations are expand-and-contract. The expand phase is always backward compatible, so a code rollback against an expanded schema is safe. The contract phase is not, and a rollback across a contract migration requires a restore from the pre-migration snapshot.

Snapshots are taken automatically before every contract migration and retained for fourteen days. Restoring one takes about forty minutes and requires the database on-call, not just the service on-call.

## Incident severity

SEV1 is a total payment outage or any confirmed data loss. SEV2 is a partial outage, degraded success rate below 95 percent, or a stuck settlement batch. SEV3 is everything else that needs attention but is not customer-visible.

SEV1 pages the entire on-call rotation immediately and requires an incident commander within five minutes. SEV2 pages the primary on-call only. SEV3 creates a ticket during business hours.

## Escalation policy

The primary on-call has fifteen minutes to acknowledge a page. After fifteen minutes the page escalates to the secondary. After a further ten minutes it escalates to the engineering manager, then to the director.

For any SEV1 lasting more than thirty minutes, notify the finance team. Settlement delays past 18:00 UTC affect next-day payouts and finance needs the lead time to notify affected merchants.

## Common failures

A stuck settlement batch is usually a lock held by a crashed worker. Clear it with the settlement tool rather than restarting the service, which will not release the lock.

Elevated 402 responses almost always mean an upstream processor issue rather than a bug on our side. Check the processor status page before investigating our code.

Elevated 500 responses immediately after a deploy mean roll back first. There is no scenario where debugging a broken production deploy in place is faster than rolling back and debugging the previous version.
