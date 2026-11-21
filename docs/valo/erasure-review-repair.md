# Erasure review repairs and executed boundaries

Application repair: `404b1a102e4d7fbfb26ec3888374b72357528b89`.
This addresses the review of predecessor `1657d361` against the current branch;
it does not claim that every reviewed defect remained present at the later head.

## Changes and verified existing fixes

| Finding | Current behavior and actual evidence |
|---|---|
| Late upload after job/reservation deletion | The worker catch retains tombstone-owned cleanup even when its job update finds no row. Native private-storage tests put real new synthetic bytes after erasure, then the worker maintenance entry removes them. |
| Killed uploader / unknown outcome | Actual child SIGKILL precedes acknowledgement; delayed completion uses native private storage locally. Signed independent locators survive. The scheduled maintenance entry—not a direct manual replay—removes the object. |
| Hold/claim and revoked operator | Existing explicit hold-release enforcement was exercised. A hold or revoked privacy role between objects prevents the next call; the already in-flight outcome remains recorded. |
| Corrupt replay inventory/state | **New:** authenticate the full inventory before application phases as well as object phases. Same-workspace key substitution, an extra empty key and altered case state all hold before membership revocation or profile deletion. |
| Key rotation | Existing versioned/pinned key behavior was executed: historical verification succeeds and missing/wrong keys hold without destructive dispatch. No silent current-session-secret fallback. |
| Privacy HTTP role separation | Actual HTTP routes use the managed-session resolver and privacy role guard, not finance authorization. Privacy-only success and finance-only, stale MFA, session/role revocation and hostile-origin denials passed. Session/provider transports are controlled in this HTTP harness. |
| Requester unreachable after quarantine | **New:** original verified-identity case-only list/detail/reply routes precede the workspace gate. No workspace provisioning or restored membership. Replies deduplicate, preserve verification, return to assigned status and require a staff resume. |

The authenticated full-inventory cursor includes invalid empty keys instead of
silently beginning strictly after an empty-string lower bound. Corruption tests
simulate an altered restored row in a single atomic trigger-disable/edit/enable
transaction scoped to new fixture rows; concurrent sessions never see the
trigger disabled. No managed migration was applied.

## Actual checks

- **31/31** targeted native tests; zero skips. Includes real private App Storage
  writes/deletes for new synthetic objects, controlled accepted-upload transport
  plus actual Node SIGKILL, role/hold cases, keys and HTTP processing.
- **7/7** requester HTTP recheck, including list visibility after quarantine.
  This overlaps the 31-case suite; do not add it as seven new acceptance cases.
- Isolated database/local-object restore passed again: total **67,369 ms**;
  restore/validation **35,177 ms**; recovery-cutoff age **42,480 ms**.
  App Storage **backup restoration** and production RPO/RTO remain unproved.
- **23/23** finite inference dispatcher tests, isolated SQL schema and injected
  transports: successful dispatch/settlement/reuse, lanes, pair reservations,
  tampering, retries, model/usage mismatch and unknown liabilities. These are
  zero-paid-call controls, not new provider-quality or owner-approval evidence.
- Root typecheck, API and web builds passed; **177/177** foundation/traceability
  engineering tests passed. These are not the formal 80/60/60 suites.
- API, web and development worker restarted successfully. The public 390px
  viewport rendered Valo and the required hero; signed-in UI was not visually
  tested. Development HMR/proxy and Clerk structural-CSS warnings remain.
- Live public catalogue read returned zero released items and 40 held templates.
  No release was inferred from this erasure work.

Source-bound JSON and passing/failing logs are retained under
`docs/valo/evidence/erasure-review-repair*`. Initial failures exposed a quota-shared
fixture, an unsupported reply transition and maintenance invoked before its
persisted due time. They were retained, not counted as passes. The corrected
test uses a fresh requester, existing assigned-state semantics, and advances
only its new fixture's scheduler clock. No quota was raised.

## Explicit limits

Unknown upload outcomes cannot promise synchronous permanent absence while a
remote write may still finish. Completed object-delete acknowledgements remain
subject to the signed journal's **hourly automatic rescan** and worker availability.
The killed-upload test advances that fixture's due time; it does not pretend an
hour elapsed or that every provider has confirmed completion.

Support/privacy copies in the scoped v3 application path are minimised, including
historical prepared snapshots and authenticated redactions. New correspondence
needed to handle an open request remains case content, not a claim of full
account erasure. Unlinked public intake, minimum financial/audit/usage evidence,
policy/hold exceptions, Clerk, historical AI processors, PSP and backups require
truthful separate outcomes. Genuine owner data and provider records were not
deleted by these tests.

No new inference spending, quota/identity increase, external email, merchant
action, production launch or full R1/R2 acceptance occurred. The finite batch
remains disabled; genuine usage reconciliation and the exact activation package
are not newly accepted merely because controlled dispatch tests passed.
