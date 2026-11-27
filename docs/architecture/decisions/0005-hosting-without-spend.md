# 0005 — Prepare hosting in code; provision nothing without approval

Date: 2026-11-16. Status: accepted.

## Context

The specification proposes autoscaling for web and API plus a separate worker
server. The Phase 2 documents propose one Reserved VM ($35/month) for both.
`.replit` still targets autoscale. Staging and production environments are new
recurring costs that need owner approval.

## Decision

Make the code run in either topology: stateless API instances, worker work as
queue jobs, configuration from validated settings, a container image and a
release procedure. Do not provision any paid environment until the owner
approves the hosting choice and its cost.

## Consequences

- Phase 5 code can be completed and tested locally and in CI.
- Staging, production and monitoring accounts stay blocked on approval.
