# Export recovery, pagination and accessible editing

Development checkpoint, not R1/R2 or production acceptance. Current source/results are bound in `evidence/export-recovery-checkpoint.json`. Earlier dated checkpoints remain historical evidence.

## Export behavior

The application no longer relies on pg-boss's retry state to repair its own export row.

- A running export renews its lease every 10 seconds. The worker reconciles work every 3 seconds. After 90 seconds without a lease update, abandoned queued/running/retrying work is recovered.
- Recovery rotates the queue generation, fencing old workers before object reservation and completion. An old transport delivery cannot publish a file or change the new generation's state.
- Three render attempts or three abandoned-delivery recoveries exhaust a cycle and produce an explicit failed state. The existing retry action resets that same export job, subject to a maximum of three user retry cycles. The saved document/revision is not deleted.
- Scoped export reads also reconcile expired work, so an absent worker does not leave a final attempt indefinitely displayed as running. Recovery can queue work, but actual rendering still needs a running worker.
- Each object's key is reserved durably before upload starts. Asset, retained reservation, ready state and ready event commit together. Acknowledgement uncertainty must not delete a committed asset.
- Orphan cleanup processes at most 25 due reservations per pass, never deletes a referenced asset, and persists backoff after failure. Successful cleanup retains a tombstone and re-deletes hourly: a cloud upload accepted before process death may finish after an earlier deletion.
- Tombstones are not silently discarded. Their eventual retention/deletion policy and operational alert routing still need approval before live data. Cleanup failures emit a redacted operational event, not a claim of successful deletion.

The application lease is not a production availability guarantee. Actual deployment, background-worker/storage access, clock behavior and recovery remain separate measured gates. No paid resources were deployed.

## Actual execution evidence

- **12 crash/recovery runner tests passed (11 leaf cases), no skips.** Real SIGKILL process-group termination at claiming, claimed, rendering, native upload start, uploaded, uncommitted completion and committed completion. Final-attempt tests exercise rollback or failed/retry recovery as appropriate.
- A real pg-boss worker was killed after claiming an actual transport delivery; its database state remained active/unacknowledged. A replacement daemon recovered the final attempt and fulfilled an explicit retry with one visible job, asset and ready event.
- Additional cases cover automatic earlier-attempt recovery, concurrent recovery elections, stale queued transport generations, bounded explicit retries and saved-revision preservation.
- Native App Storage cleanup was verified by failed reads, not merely checksum mismatch. A real late write after deletion was removed again using the retained tombstone.
- **10 existing real-export regression tests passed**, including immutable saved revisions, DOCX/PDF bytes, A4/multipage/naira checks, private access, idempotency and restart.
- Lease expiry was accelerated by backdating owned synthetic database timestamps **after real process death**. These are not measurements of wall-clock production RTO.
- **44 API unit tests**, **49 database regression tests**, **166 foundation tests**, and full workspace TypeScript checks passed. The 80 foundation engine fixtures remain synthetic, not source-backed Nigerian legal acceptance cases.

## Pagination and accessibility

- The catalogue has a fixed 20-row page. Next now compares page × 20 with total, not page × the current short-page length.
- Six pure pagination cases cover first, middle/full, short final, exact-full final, out-of-range and empty collections. Browser fixtures separately verify first/full/final/empty behavior and previous/next URL navigation.
- Library content types are ordinary filter buttons with pressed state, keyboard activation and visible focus, not incomplete ARIA tabs.
- Editor tabs have arrow/Home/End navigation, roving focus, selection state and resolvable labelled panel/control relationships.
- Each repeated business activity has its own label. The title retains a computed visible 2px focus outline during keyboard navigation.
- Broader testing found a real saved-preview overflow. Long text now wraps; tables remain readable in named, keyboard-scrollable regions rather than overflowing the page.
- **11 browser groups passed: eight actual running journeys and three browser-intercepted UI fixtures.** Profile reflow was exercised at 320/390/768px; edit and saved-preview views, focus, tab controls and table keyboard scrolling at 320/360/390/768px. Desktop/mobile public routes and managed synthetic customer/suspension/help/privacy journeys were rerun.
- Initial failing runs are retained. A computed-style assertion was corrected to execute an actual browser callback; the identity widget's own headings are no longer incorrectly counted as a missing page heading.

This does not establish physical iOS/Android/Safari support, complete WCAG 2.2 AA conformance or manual assistive-technology review. Browser catalogue fixtures are not publications. Eligible content remains zero; publication/rights, complete 80/60/60 acceptance suites, commerce/email, production recovery and independent approvals remain unresolved.

## Reproduction and operations

Only use synthetic development data and the existing configured private storage:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test:valo
NODE_ENV=development VALO_RUN_EXPORT_CRASH_TESTS=synthetic-development-only pnpm --filter @workspace/api-server run test:valo-export-recovery
NODE_ENV=development VALO_RUN_EXPORT_TESTS=synthetic-development-only pnpm --filter @workspace/api-server run test:valo-exports
NODE_ENV=development VALO_RUN_CUSTOMER_JOURNEY=synthetic-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/customer-experience-journey.ts
```

Pause the managed development worker while running the controlled crash harness, which starts/kills its own owned child workers, then restart the managed worker. Do not run this against production or real customer jobs. Internal phase hooks require a synthetic development IPC harness; no HTTP/queue payload can enable them.

For an incident: preserve the saved revision, inspect job status/attempts and lease age, restore the worker/database/storage dependency, allow bounded reconciliation, and use the existing retry action when failed. Repeated interruption or cleanup failures require engineering investigation; do not reset counters indefinitely, delete financial/history records, or remove referenced assets to make a status green.

Reviewed additive migration `0010_export_recovery.sql` was applied transactionally in development. It is not proof of existing-database ledger adoption, production migrations, grants or production recovery.
