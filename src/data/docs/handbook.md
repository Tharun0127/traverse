# Engineering Handbook

The working agreements for the engineering organisation. This document is the reference; when a team's local practice conflicts with it, this document wins unless an explicit exception is recorded.

## How we work

### Working hours and overlap

Teams are distributed across three regions. Every team commits to a four-hour overlap window with the regions it depends on. Outside that window, expect asynchronous responses and design for it: no process should require a synchronous answer to make progress.

Meetings outside a participant's working day are exceptional and require the organiser to offer an alternative. A recurring meeting that repeatedly falls outside someone's day should be restructured or split.

### Asynchronous by default

Decisions are made in writing. A decision reached verbally is not a decision until it is written down somewhere durable and linked from the relevant ticket or design document.

This is not bureaucracy. A distributed organisation where decisions live in memory produces the same argument every quarter, and the people who joined most recently are always the least equipped to participate.

### Documents over slides

Proposals are written as prose documents, not slide decks. A document forces the argument to be complete; a deck lets gaps hide behind bullet points.

Meetings that review a document begin with silent reading time. Do not present the document — everyone reads it, then the discussion starts with questions.

## Code review

### What review is for

Review exists to catch defects, spread knowledge, and keep the codebase coherent. It does not exist to enforce personal preference. If a comment cannot be traced to one of those three purposes, it should be marked as optional.

### Response times

A review request should get a first response within one working day. If you cannot review within that window, say so immediately so the author can find someone else. Silence is the expensive failure mode, not a slow review.

Reviews of urgent production fixes are expected within one hour during working hours. Tag them explicitly; do not rely on the reviewer inferring urgency from the diff.

### Size limits

Pull requests above 400 changed lines are reviewed materially less carefully. This is not a judgement about anyone's diligence — it is a well-replicated finding, and the practical response is to split the change.

Mechanical changes such as renames or formatting may exceed the limit provided they are isolated in their own pull request containing nothing else.

### Approval requirements

One approval is required for changes within a team's own service. Two approvals are required for changes to shared libraries, infrastructure definitions, or anything under a directory marked as owned by more than one team.

An approval means the reviewer read the change and believes it is correct. It does not mean they ran it, unless they say they did.

### Disagreement

If an author and a reviewer disagree and cannot resolve it in two rounds of comments, escalate to a synchronous conversation. If that does not resolve it, the team's technical lead decides, and the reasoning is recorded in the pull request.

Do not resolve disagreements by waiting for the other person to give up. That produces the same conflict again on the next change.

## Testing

### What must be tested

Every behavioural change needs a test that fails before the change and passes after it. This is the only reliable evidence that the test actually tests the thing.

Refactors, by definition, need no new tests. If a refactor requires changing tests, it is not a refactor — it is a behavioural change wearing a refactor's clothes, and it should be reviewed as one.

### The testing pyramid, approximately

Favour many fast unit tests, fewer integration tests, and a small number of end-to-end tests. The exact ratio is less important than the direction: if the suite is slow, the balance is wrong.

A test suite that takes longer than ten minutes will be skipped by somebody under deadline pressure. Suite duration is a correctness property, not a convenience one.

### Flaky tests

A test that fails intermittently is worse than no test, because it trains everyone to ignore failures. A flaky test gets one week to be fixed, then it is deleted and replaced with a ticket.

Do not add retries to make a flaky test pass. Retries hide the flakiness rather than removing it, and the underlying race usually exists in production too.

### Test data

Never use production data in tests, including anonymised production data. Generate fixtures. Anonymisation is harder than it looks and the failure mode is a privacy incident.

## Deployment

### Continuous deployment

Every merge to the main branch deploys to production automatically unless the service is explicitly exempted. Exemptions require a documented reason and are reviewed quarterly.

The purpose is small changes. A team that deploys weekly ships a week of changes at once and cannot attribute a regression to any of them.

### Feature flags

Ship code dark behind a flag rather than holding a long-lived branch. Long-lived branches accumulate merge risk that is invisible until the merge.

Flags are temporary. Every flag has an owner and a removal date recorded at creation. Flags older than ninety days are reported weekly until removed, because a codebase full of stale flags is unreadable.

### Rollback expectations

Every service must be able to roll back within five minutes without a human reading documentation. If your rollback requires a runbook, it is not fast enough.

Rollback is the default response to a production problem. Diagnosis happens after service is restored, not before.

### Change freezes

There are two freezes each year, around the two highest-traffic periods. During a freeze only fixes for active incidents deploy, and each requires approval from a director.

Freeze dates are published at least six weeks ahead. Plan around them; a freeze is not an emergency.

## On-call

### Rotation structure

Every service has a primary and a secondary on-call. Rotations are one week and hand over on Wednesday, not Monday, so a difficult handover does not consume a weekend.

No engineer carries the pager in their first eight weeks. Shadowing is encouraged from week two.

### Acknowledgement and escalation

A page must be acknowledged within fifteen minutes. Unacknowledged pages escalate to the secondary, then after a further ten minutes to the engineering manager.

Acknowledging means you are working on it. It does not mean you have fixed it, and it is not a substitute for status updates in the incident channel.

### What justifies a page

A page must be actionable and urgent. If the recipient cannot do something about it right now, it is not a page — it is a ticket.

Every alert has a documented response. An alert without a documented response is deleted at the next review, regardless of who created it.

### After an incident

SEV1 and SEV2 incidents get a written review within five working days. Reviews are blameless: the question is what made the failure possible, never who made it.

Reviews produce action items with named owners and dates. A review without action items is not finished.

## Architecture

### Service boundaries

A service owns its data. No service reads another service's database directly, ever. Cross-service data access goes through an API.

This rule is inconvenient and it is not negotiable. Direct database access creates a coupling nobody can see in code review and nobody can change safely later.

### Choosing to build a new service

Prefer adding to an existing service. A new service brings deployment, monitoring, on-call, and dependency management costs that are invisible at creation and permanent afterwards.

Create a new service when the scaling profile genuinely differs, when the failure domain must be isolated, or when a separate team will own it. Not because the code feels unrelated.

### Technology choices

The supported languages are TypeScript, Go, and Python. Using anything else requires an architecture review and a named team willing to own the toolchain.

This is about the second engineer, not the first. Any language is productive for the person who chose it, and the cost lands on whoever inherits it.

### Dependencies

New third-party dependencies need a licence check and, for anything parsing untrusted input, a security review. The licence check is automated; the security review is human.

Prefer the standard library. A dependency that saves fifty lines is rarely worth the supply chain surface it adds.

## Data

### Classification

Data is classified as public, internal, confidential, or restricted. Restricted data includes anything that identifies a customer's financial position or personal identity documents.

Classification is assigned at schema design time, not retrofitted. Retrofitting classification onto an existing store reliably misses something.

### Retention

Retain the minimum needed for the stated purpose. Every store declares a retention period at creation and enforces it automatically; retention enforced by a person is retention that will not happen.

Audit logs are the exception and are retained for seven years in an immutable store.

### Access

Access to restricted data is time-boxed, logged, and reviewed monthly. Standing access to restricted data does not exist for individuals — only for services with a named owner.

Access granted for an incident expires when the incident closes.

## Security

### Secrets

Secrets live in the secret manager. A secret in a repository is an incident, not a cleanup task, even in a private repository and even if it is expired.

Rotation is automatic every ninety days. Services read secrets at startup and refresh periodically, so rotation never requires a deploy.

### Dependencies and patching

Critical vulnerabilities in production dependencies are patched within three days. High severity within fourteen. This clock starts at disclosure, not at the point somebody notices.

### Reporting a concern

Anyone can raise a security concern without needing to be sure. A false alarm costs an hour. An unraised concern costs considerably more, and the person best placed to notice is often the least confident.

## Hiring and growth

### Interview conduct

Interviewers prepare before the interview and read the candidate's material in advance. Arriving unprepared is disrespectful and produces a worse signal.

Feedback is written before discussing with other interviewers, to avoid anchoring. Submit within one working day.

### Levels and progression

Levels describe scope and impact, not tenure or technical difficulty. A promotion recognises that someone is already operating at the next level, rather than granting permission to try.

Progression conversations happen twice a year, and there should be no surprises in them. A manager who saves feedback for the review cycle has not done the job.

### Learning time

Every engineer has one day per fortnight for learning that is not tied to a deliverable. It is not optional and it is not a backlog buffer.

A team that consistently cannot take learning time has a staffing problem, and it should be raised as one.
