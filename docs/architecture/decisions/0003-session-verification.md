# 0003 — Verify sessions locally; live checks for sensitive actions

Date: 2026-11-16. Status: accepted (owner instruction "implement all" on the
recommended plan).

## Context

Every signed-in request makes two Clerk Backend API calls (session and user).
A revoked session is refused immediately, but every request pays the latency and
a Clerk outage blocks all private traffic.

## Decision

Verify the session token locally on ordinary requests and cache the user's
account state (banned, locked, verified email) for at most 60 seconds. Keep the
live Clerk checks for payments, downloads, privacy requests and all staff
actions.

## Consequences

- A revoked session can keep reading ordinary pages for up to about a minute.
- Money, file release, privacy and staff operations keep immediate revocation.
- Clerk outages affect only the sensitive operations.

## Implementation

Implemented in `artifacts/api-server/src/platform/session-verification.ts` and
used by `verifiedWorkspace`:

- Only routes on an explicit list (documents, templates drafts, saved templates,
  checker preview, assessments, tasks, reminders, profile, support, AI usage,
  export requests and retries) may reuse a passing check. Every other route
  checks live, including the account page, AI drafts and any route added later.
  A route missing from the list costs speed, never safety.
- The cached result belongs to one session (user and session ID) and lasts at
  most 60 seconds. Only passing results are cached.
- A refusal on any route removes the cached result, so the next request checks
  live again.
- Parallel requests from one page share a single provider check; at most 10,000
  sessions are held per process.
- During a Clerk outage, everyday routes keep working for sessions checked within
  the last minute; everything else fails closed.
- Workspace membership is still read from the database on every request, so a
  membership change applies at once.
- Staff actions, privacy cases and workspace data downloads authenticate through
  their own live checks and are unaffected.
