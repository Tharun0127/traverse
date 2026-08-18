# Internal Knowledge Base — Platform Engineering

Answers to questions the platform team is asked repeatedly. Roles are marked where access differs.

## How do I get a production database credential?

Request through the access portal with a business justification and a duration. Credentials are time-boxed; the maximum is seven days and the default is eight hours.

Standing production credentials do not exist. If you believe you need one, you need a service account instead, which is a different request type.

## Why did my build fail with "workspace not clean"?

The build refuses to run when generated files differ from what the generators produce. Somebody committed a hand-edited generated file, or forgot to run the generator after changing a source schema.

Run the generator locally and commit the result. Do not edit generated files by hand — the next build will overwrite them and the failure will recur.

## What is the retention on application logs?

Structured application logs are retained for thirty days hot and one year cold. Cold logs are queryable but a query can take several minutes.

Debug-level logs are retained for seventy-two hours only. If you need debug output for an investigation, export it within three days or it is gone.

Audit logs are retained for seven years and are immutable. They are in a separate store with separate access control.

## How do I request a new service?

Open a service request with the platform team including the expected traffic profile, the data classification, and the on-call owner. Provisioning takes about a week.

A service without a named on-call owner will not be provisioned. This is not negotiable and has been the policy since the 2024 incident review.

## Why is my deploy stuck in "pending approval"?

Either an approver has not acted, or the change window is closed. Approvals expire after four hours; an expired approval shows as pending and needs to be re-requested.

Deploys are blocked entirely during declared incidents, including deploys unrelated to the incident.

## Can I run a load test against production?

No. Load tests run against the staging environment, which is provisioned to match production capacity within ten percent.

If you believe your test genuinely requires production, the answer is still no, but the performance team can arrange a traffic replay against an isolated production-shaped environment.

## What is the on-call compensation policy?

On-call is compensated per week carried, at a rate set annually. A carried week includes the weekend. Compensation is automatic based on the rotation roster; you do not need to claim it.

Being paged does not change the rate. Carrying the pager does.

## How do I get access to the billing dashboard?

Billing dashboard access is restricted to finance and to engineering managers. Individual contributors can see cost attribution for their own services through the platform console, which covers almost every question people open this request for.

## What is the incident review process?

Every SEV1 and SEV2 gets a written review within five business days. Reviews are blameless and the template is in the incident repository.

The review must produce action items with owners and dates. A review without action items is not complete. Action items are tracked to closure by the reliability team and reviewed monthly.

## How do secrets get rotated?

Automatically, every ninety days, for anything in the secret manager. Services read secrets at startup and on a refresh interval, so rotation does not require a deploy.

A secret hardcoded in a repository is not rotated, will be flagged by the scanner, and is treated as an incident. Move it to the secret manager rather than rotating it in place.

## What is the policy on third-party dependencies?

New dependencies need a license check and a security review for anything that handles untrusted input. The check is automated in CI; the review is a human step for the subset that touches parsing, crypto, or network.

Dependencies with no release in eighteen months are flagged. Flagged does not mean forbidden, but it needs a note in the review explaining the plan if it becomes unmaintained.
