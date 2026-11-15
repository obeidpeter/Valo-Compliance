# Runtime-boundary and portable erasure CI repair

The reported failures at `9f6c84b`, runs
[43645147968](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43645147968)
and [43645143946](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43645143946),
remain retained in `evidence/ci-boundary-erasure-repair/original-failures.json`.
They were not safe rejection or successful erasure evidence.

## Harness: execute the capability before testing zero effects

The current branch already supplied the newly required
`authorizeWorkspaceWrite` substitute. This repair additionally normalizes
explicit TypeScript module extensions in the controlled resolver and adds a
positive canary which actually invokes that substitute and observes exactly one
authorization effect. The actual export/API and worker entries still compile,
then run every prohibited environment with zero database, authorization, queue,
storage, rendering and service effects.

An initial new canary compile failure is retained separately. No mode rejection
was counted from that failure. After the resolver correction, the combined
runtime/account-boundary suite passed **46**, with zero skips.

## Explicit, separate storage lanes

`test-support/erasure-proof-storage.ts` is test composition only. Production
App Storage has no new local fallback.

- **Portable CI:** private temporary filesystem bytes, exclusive writes,
  checksums, workspace-scoped keys, actual reads/deletes, real PostgreSQL
  authorization, failure/retry, sealed inventory, replay and tenant checks.
  This lane ignores any native configuration and never represents itself as
  Replit storage proof.
- **Native proof:** requires explicit `VALO_ERASURE_STORAGE_PROOF=native-replit`,
  development runtime and configured native storage. Any nonempty CI marker
  rejects this mode before creating fixtures. It uses the existing native
  SDK adapter and only new synthetic workspaces/objects.
- Native failures never fall back to portable storage. If native cleanup
  cannot be confirmed, the test fails and retains existing fixture database
  records rather than discarding cleanup locators and claiming success.
- Historical native upload/kill/restart checks remain in the native lane,
  rather than being removed or relabelled as portable evidence.

GitHub uses `VALO_ERASURE_STORAGE_PROOF=portable`, without native credentials.
The PostgreSQL job also installs the existing locked Playwright browser and
sets its actual executable path for the controlled dispute-PDF check; it no
longer assumes a Replit-only binary path exists on Ubuntu.

## Executed locally on this source

| Check | Result |
|---|---|
| Runtime/account boundaries | 46 passed, 0 skipped |
| Storage selector/real portable file controls | 2 passed |
| Portable erasure suite, CI=true and native config removed | 18 passed, 1 explicitly native-only skip |
| Native Replit erasure/race suite | 19 passed, 0 skipped |
| Finite inference budget controls | 47 passed |
| Workspace types | passed |

The native suite includes a genuine private upload spanning erasure and
automatic cleanup, process-death recovery, and bytes read before / rejected
after deletion. It is **development** native-provider evidence, not production
recovery, retention, complete account erasure or deletion from external processors.
The portable main erasure flow executed all 11 results with zero skips; the
single wider-suite skip is the separately executed native-provider upload case.

A broad local API engineering rerun exceeded its 90-second process timeout
after two export tests. It is recorded as incomplete, not a new 177-case pass.
The previous 177/one-skip result remains historical; it cannot waive failed CI.
Exact-head GitHub job outcomes must be checked independently after pushing.

No model spending/approval, quota change, email, PSP action, production
migration or launch was performed. Existing budget/privacy implementation and
genuine usage history are preserved. The inference allocation stays disabled;
remaining R1/R2 and wider security/readiness gates remain unaccepted.
