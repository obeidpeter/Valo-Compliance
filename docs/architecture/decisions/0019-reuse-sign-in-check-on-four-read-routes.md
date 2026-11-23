# 0019 — Reuse a passed sign-in check on four more read routes

Date: 2026-11-23. Status: **accepted** on 2026-11-23. The product owner approved the content and
speed plan with its recommendations ("Approved. Go ahead and implement"), among them: "allowing 60
seconds' reuse on five more read-only customer screens, as documents and tasks already do. Staff
screens stay live." The plan and the owner's answers are recorded in
[plan.md](../plan.md#content-and-speed).

## Context

Decision [0003](0003-session-verification.md) lets an explicit list of everyday routes reuse a
passing sign-in check for at most 60 seconds. Every other route asks the identity provider again on
every request, "including the account page, AI drafts and any route added later". Some read-only
customer screens outside that list ask again on every load, which costs a round trip to the provider
each time.

## Decision

Four more routes may reuse a passing check, for their reads (GET and HEAD) only:

- `/v1/exports`: the list of a business's exports. A file (`/v1/exports/:id/file`) stays live.
- `/workspace/correction-notices`.
- `/workspace/support-cases` and `/workspace/support-cases/:id`. A case's older messages
  (`/workspace/support-cases/:id/messages/more`) stay live.

A write to any of these paths checks live.

The plan named five screens. Once decision 0003's live checks are kept, only these four read routes
remain. Payments and purchases (including the owned-editions labels and receipts), file downloads,
privacy, the account page and AI drafts all stay live, as do staff actions.

The rest of decision 0003 stands. A cached result belongs to one session and lasts at most 60
seconds, and only passing results are cached. A refusal on any route removes the cached result, and
workspace membership is read from the database on every request.

## Consequences

- A revoked session can keep reading these four lists for up to about a minute. It already can for
  documents and tasks.
- These four reads keep working through a sign-in provider outage, for sessions checked within the
  last minute.
- Money, file release, privacy and staff operations keep immediate revocation.

## Implementation

The routes are in `CACHED_READ_ROUTES` in `artifacts/api-server/src/platform/session-verification.ts`.
`routeUsesCachedCheck(path, method)` allows them for GET and HEAD only, and `verifiedWorkspace`
passes the request's method. The test "four ordinary read routes reuse a passing check for their
reads only, …" in `session-verification.test.ts` checks the four routes and the routes kept live.

This record adds to the route list in decision 0003's implementation section. It supersedes nothing
else in 0003.
