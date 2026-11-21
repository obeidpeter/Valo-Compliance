# Privacy information exchange and inspection

Subsequently reconciled with concurrent checker/erasure implementation; see
[combined checks and migration renumbering](privacy-checker-reconciliation.md).
The original information SQL became canonical migration 0023 without changing
its bytes; the 0022 receipt below records its earlier development execution.

Partial evidence for PRV-003, IAM-003, ADM-001/009 and WRK-006. Not full privacy
fulfilment, formal R1/R2 acceptance or a real managed-MFA browser result.

## Working application behavior

- Customers can answer an information request in the same privacy case.
  The response has a typed generated API, durable support-write limits,
  expected-version checks and per-question duplicate suppression. A stale
  changed response conflicts instead of replacing the original.
- Information is distinct from verification: an unverified request returns to
  awaiting verification; an already verified request preserves its recorded
  verification time. Verifying while a question is pending does not answer it.
- Message bodies are separate, private rows, not copied into immutable audit
  reason strings. They appear in case detail and the named workspace JSON
  section and are included in scoped v2 erasure.
- Staff have a read-only case endpoint before mutation. It records access,
  returns full history/messages and currently available operations, and
  requires the independent privacy role and fresh MFA. Finance-only access
  fails. The operations screen loads that inspection before enabling writes.
- Customer reply drafts use the existing leave/discard guard. Existing
  identity-boundary remounting still applies. Staff unsent reasons are
  preserved; only server-advertised actions are offered.

## Execution

103/103 development database checks and 174/174 engineering/traceability checks
passed; workspace typecheck passed. The six HTTP checks cover unverified and
verified replies, read-only version preservation, duplicate clicks, conflicting
stale replies, active other-tenant denial, finance-only denial, revoked/stale
staff sessions and hostile origins. Identity/session provider transports in
these HTTP tests are controlled. No genuine Clerk MFA/browser proof is claimed.

Migration 0022 was reviewed and applied in development only, SHA-256
`ef0272e4b54699fea96ba5d87ce16b77195c215f33e16f99fa31b8d7fbbf815e`.
Canonical OpenAPI generation produced client types/hooks and server schemas.
Private UI was implemented and typechecked; it was not visually inspected
through a signed-in browser.

An early fixture attempted too many support writes and correctly received
429. The test now exercises unverified and verified replies on the **same**
case within existing limits. No cap/identity change was used to evade limits.
A missing test-cleanup import caused the early run to remain open; that
failure output is retained. Two newly created failed-run fixtures were
identified by exact marker/cutoff/ownership and safely removed, without
removing genuine usage or existing owner content.

Large resumable exports, independent post-cutoff deletion controls/recovery,
external erasure, merchant dispute submission/decisions, rich released-rule
customer integration and the actual finite inference work manifest/liability
reconciliation remain unfinished. No spending, external messages, merchant
execution, live launch or production changes were enabled.
