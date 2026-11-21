# Finite-budget CI import and storage boundaries

Follow-up to application `ce1bba0bb12257dccf04a65f7446f641aa7fc329`.
No paid inference, quota changes, finance actions, messages or approval records.

## Evidence reconciliation

The reported new CI failure did not reproduce on the saved `ce1bba0` source.
GitHub runs 43690344225 and 43690348563 both reported success across all four jobs.
The two specific budget/customer unit files also passed all 41 cases with
`DATABASE_URL` removed. No failure stack or new failed-run IDs were supplied.
This does not dismiss the report: the following regression boundaries are now
explicit and fail if a future import or portable proof acquires those dependencies.

## Changes

- Managed inference lazily loads the SDK adapter with the database/dispatcher
  composition, only in the authorized-work entry path. The dispatcher imports
  its store as a type, not a runtime dependency. No authority check was removed.
- A dedicated foundation-CI step runs the actual budget/customer unit files in a
  subprocess with database, storage and model credentials absent. Another test
  rejects database/SDK runtime imports and network/outbound observation on the
  default disabled path.
- Child test processes clear inherited `NODE_TEST_CONTEXT` and require a positive
  executed-test count; exit zero alone cannot masquerade as an executed suite.
  Initial harness checks caught an incorrect working directory and inherited
  test context; those failures were not counted as passing product evidence.
- Portable PostgreSQL erasure CI explicitly has no storage configuration and
  installs a test-only native-I/O detector. Any native read/write/delete/status
  attempt makes the process fail, even if its exception is caught. It does not
  replace production storage or introduce a local-filesystem production fallback.
- A separate explicitly opted-in native erasure command remains available only
  in the authorized Replit development environment. CI gets no native credentials.

## Executed checks

| Check | Actual result |
|---|---|
| API TypeScript | Passed |
| Entire foundation suite without DB, storage or model configuration | 201 passed; 1 existing skip |
| New dependency/zero-dispatch/storage-detector regression | 3 passed |
| Existing finite entry/history/dispatch controls | 55 passed |
| Portable SQL erasure, native configuration removed and native I/O forbidden | 18 passed; 1 explicitly native-only skip |
| Genuine Replit private-storage erasure of newly created synthetic fixtures | 11 passed; zero skips |

The native run reported `native-replit-app-storage`, three writes, seven reads
and twelve delete operations; the portable run reported
`controlled-private-filesystem`. These are deliberately different proofs.
The three new regression checks rerun 41 existing unit cases; do not add those
41 again when describing unique foundation coverage.

Retained output: `generated-artifacts/valo-completion/ci-import-storage/`.
All database erasure fixtures were newly created synthetic workspaces. No owner
content, genuine usage ledger or external provider records were deleted.

## Limits and next work

This is not complete privacy erasure acceptance, production-storage recovery or
formal 80/60/60 evaluation. Pending erasure/export/dispute findings remain pending.
The active-operator hostile-origin privacy test and live rich-answer checker
journey follow this saved checkpoint. Eight original oracle disagreements remain
preserved. Zero eligible rules must not become client-approved recommendations.
