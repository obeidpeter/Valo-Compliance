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
