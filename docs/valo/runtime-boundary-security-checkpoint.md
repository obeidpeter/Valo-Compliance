# Development export and account-state security checkpoint

Runtime code: `a7ff6a6eb1d79e2063f62d87c81db6953dad822d`.
The accompanying evidence/register commit adds no release approval.

## Working behavior

- Export entry points, pg-boss construction, export recovery/orphan reconciliation
  and worker dispatch require exactly `NODE_ENV=development` and no nonempty
  `REPLIT_DEPLOYMENT` or `REPLIT_DEPLOYMENT_*` marker. `"0"`, `"false"` and
  whitespace do not waive the boundary. An ordinary development-domain name
  does not count as a deployment marker.
- Account/session changes remount private and publicly prefilled form state.
  Old query/mutation caches, in-flight request signals and account toasts are
  discarded. Late responses and late body parsing cannot populate the next
  account. The transport does not add browser bearer-token handling.
- A session-end broadcast clears the matching session's subtree in other tabs.
  A current API 401 also clears it; a late old-session 401 cannot clear the
  next account. A coherent new account gets fresh forms.
- Unsaved profile edits survive same-account rerenders. Routed navigation offers
  save/discard/stay; choosing stay preserves fields. Account-boundary removal
  does not wait for this prompt. Saved server documents are not erased.

## Executed evidence

| Check | Actual result | Boundary |
|---|---|---|
| Runtime controls | 45 passed, zero failed/skipped | Includes real export entry/worker startup code with sentinel transports; rejected modes recorded zero database, queue, renderer, storage or operational-dispatch effects. |
| Browser | 13 controlled checks passed | Actual profile/checker/toaster components and native shared-context BroadcastChannel; controlled A/B identities and API responses, **zero new real Clerk account-switch acceptance runs**. |
| Development database | 62 passed, zero failed/skipped | Actual PostgreSQL, owned synthetic records. |
| Positive private exports | 10 passed, zero failed/skipped | Actual development PostgreSQL/App Storage, usable DOCX/PDF checks, access revocation, bounded retry and worker-process restart. |
| Aggregate API regression | 172 passed, one skipped, zero failed | The skipped isolated parser-process test is not claimed to have run here. |
| Workspace typecheck | Passed | Shared transport, API, web, core and other workspace packages. |
| Traceability/core controls | 166 passed | Preserved all 127 original requirement rows; no release/UAT gate was accepted. |

Commands:

```sh
pnpm --filter @workspace/api-server test:valo-runtime-boundaries
NODE_ENV=development VALO_RUN_ACCOUNT_SCOPE_BROWSER=synthetic-development-only \
  pnpm --filter @workspace/api-server exec tsx src/scripts/account-switch-browser.ts
VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-db
NODE_ENV=development VALO_RUN_EXPORT_TESTS=synthetic-development-only \
  pnpm --filter @workspace/api-server test:valo-exports
pnpm --filter @workspace/api-server test:valo
pnpm run typecheck
```

The browser first reproduces the old cache-only counterexample, then proves
profile reset and B-only submission, same-account edit preservation, late-save
and toast suppression, zero-send cancellation before dispatch, late-query
discard, checker sign-out reset, cross-tab clearing of checker and profile,
current-401 clearing, page-lifecycle reset and 360px profile keyboard/reflow.
It includes a positive visible-toast control; absence of a toast is not tested
against an absent toaster. The initial multi-tab harness used isolated/owned
contexts and did not test broadcast; the corrected shared-context run passed.

See [source hashes and actual outputs](evidence/runtime-boundary-security-checkpoint.json)
and [browser observations](evidence/account-runtime-browser.json).
The subsequent [register/typecheck outputs](evidence/runtime-boundary-register-checks.json)
retain the post-binding validation separately.
The CI workflow now includes the new runtime controls; a configured CI step
is not itself a claim that the new remote CI run passed.

## Still unaccepted

These controls are not the formal source-backed 80-rule, customer-AI 60 or
editorial 60 evaluations, an independent security/privacy approval, a production
worker/storage/restore proof, or complete WCAG/browser acceptance. No content
or rule was published here. R1/G0–G5 and gated R2 remain unaccepted.
Live payments, public launch, inference spending and quota increases remain off.
Commercial/provider/processor decisions and the other unfinished R1/R2 work
remain as previously recorded; this checkpoint does not turn them into
approvals or add a specialist-signature requirement.
