# Native storage, worker and checker runtime checkpoint

## Preserved development history

Fetched private development matched saved `49c6d62c2933e5e003a1a4c8b54aa7a855ef218a`.
Supplied merge `a274cb02cbb71c10bcefc84d3d2db773608784de` was already its
ancestor, along with the reviewed receipt/checker/privacy sources. No reset,
duplicate feature integration, main merge or PR15 integration occurred.
This checkpoint adds only opt-in test composition, safety checks and evidence.
Application, budget, checker, receipt and privacy domain code are unchanged.

## SQL and genuine native provider execution

Existing privacy migration **0022**, journal **index 22**, was retained.
The complete 29-entry journal and reviewed queue migration applied successfully
only to a freshly provisioned loopback PostgreSQL cluster.
0022 SHA-256:
`8766ba62ee2065953ff62ba68cece0e914b2de6d17ab4dac728551f4b7b9052e`.
The existing application database was not migrated or erased.

Reproducer:

`NODE_ENV=development node scripts/src/valo/verify-ci-portability.mjs --native-storage-integration`

Native use is explicit, rejected in CI/deployed modes, and separate from the
default portable CI path. It uses the real Replit SDK/runtime authentication
and existing private bucket, restricted to a freshly minted test subdirectory.
It does not print the configured private root, bucket or credentials. Existing
private files and shared masters are outside this subtree.

Actual run `b02e1e43-4638-4270-993c-6fc64650627a`:
**15 November 2026, 11:07:43.835–11:09:07.141 UTC**.
Application source: `49c6d62`. The new test composition was executed before
saving and is bound by the containing Git commit.

| Executed engineering group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Credential-free imports/native detector | 3 | 0 | 0 |
| Controlled export zero-effects boundary | 1 | 0 | 0 |
| Erasure suite with native storage selected | 20 | 0 | 0 |
| Real-process export/worker/native storage | 12 | 0 | 0 |
| Checker HTTP router/domain/PostgreSQL | 5 | 0 | 0 |
| Current-source task guard | 15 | 0 | 0 |
| Exact editorial-evidence controls | 6 | 0 | 0 |
| **Run total** | **62** | **0** | **0** |

Counts include parent records. The erasure suite mixes controlled adversarial
cases with genuine native write/read/delete cases, including an upload spanning
completed synthetic erasure and actual late-byte reconciliation. It is not 20
independent complete native account deletions.

The worker suite killed real processes at claiming, claimed, rendering,
uploading, uploaded, completing and completed stages. It exercised bounded
retry, lease fencing, stale delivery and actual dispatcher restart, using real
private files and rendered documents. These are current-project development
process checks, not deployed Autoscale/Reserved-VM or production guarantees.

The test prefix was empty before work. After tests, the native SDK confirmed
it empty again; **fallback cleanup removed zero objects**. Only new synthetic
objects/rows were used. The disposable cluster was stopped and removed.
The report's `maintenanceExecuted:false` means no existing-cohort maintenance
command; synthetic reconciliation functions did execute as tested.

## Additional safety and routine CI

Four namespace-control tests passed independently, with no real provider
credentials: unsafe modes reject before SDK construction; cleanup validates an
entire page before any deletion; only exact scoped keys qualify; a nonempty
freshness probe cannot delete. The mode checks include production/test/unset
development, CI, deployment markers `1`, `true`, `false`, arbitrary nonempty
values, mismatched roots and invalid actions.

These **4 controlled safety tests are additional to the 62 above** and are now
registered in ordinary foundation CI. Native provider execution remains
explicit/manual, never silently substituted into GitHub's portable suite.
Full workspace typecheck and syntax checks passed.

If scoped native cleanup cannot be verified, the harness fails and retains
the stopped synthetic database under ignored workspace output; it does not
silently discard cleanup evidence.

## Real browser results and remaining boundary

The documented testing service refused the `testing` kind. Its attempted job
did not run an authenticated browser. Managed Clerk is configured; this is not
evidence of missing identity credentials or permission to bypass authentication.

An actual local Chromium context then exercised the **anonymous** public app:

1. Unknown and unanswered remained distinct.
2. Private business-name questions were absent.
3. Review/Edit returned to the matching question and moved focus.
4. Actual `POST /api/checker/preview` returned **200**.
5. The result disclosed that nothing was saved; private save was absent.
6. No document-level overflow at **360px**.
7. No document-level overflow at **1280px**.

Keyboard observation found an input with a **2px solid** focus outline.
The live result had no source-backed recommendations. No publication records
were created to force four live labels or a missing-rule follow-up.

**Signed-in questionnaire → preview → consented save → history/comparison
remains unverified in a real managed-session browser.** The five HTTP checks
control identity transport only inside their isolated test process and do not
close this gap. Result-driven missing-answer focus with eligible rules also
remains unproved. No synthetic identity, email or session bypass was introduced.

Retained harness failures: initially selected an unavailable Playwright cached
binary (then used the application's installed Chromium); interacted before
provider readiness (then waited for loaded identity UI); matched an inferred
preview URL (then bound the actual generated endpoint). Failed records/logs
remain distinct from the final seven public checks. No application fix or
authentication weakening was used to make them pass.

Ignored raw outputs:
`generated-artifacts/valo-ci-portability/b02e1e43-4638-4270-993c-6fc64650627a/`
and `generated-artifacts/valo-native-browser/`.

## Component traceability, not requirement acceptance

| Requirements | Narrow new evidence / remaining limit |
|---|---|
| OPS-001/003/007 | Isolated tracked migration/native compatibility; not production deployment/migration approval. |
| EDT-006/007/008; NFR-009 | Real renderer, private objects and worker crash/retry; not every template's formal export UAT. |
| PRV-003 | Native synthetic deletion/race checks; not full account or external-processor erasure. |
| RUL-002/007; WEB-002 | Controlled API and anonymous review/preview; real managed save/history and full accessibility remain open. |
| EDP; UAT-07 | Six exact evidence controls only; no new provider review or authored 60-case acceptance. |

The original 80/60/60 corpora, eight oracle disagreements, source/rights holds,
eligible content counts, production recovery, independent deletion controls
and 35-day retention remain unchanged. No paid inference, PSP/email call,
production erasure, publication, deployment, spending enablement or release
acceptance occurred. PR15 and its spending decision remain outside this unit.
