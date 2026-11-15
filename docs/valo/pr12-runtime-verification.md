# Reviewed checker runtime verification

## Integration facts

Reviewed commit `0bdb8db7c0ac8f2153f9e21422b52fd71f606e88` was already an
ancestor of the preserved development checkpoint
`3c65f1561d4d2edb21ad7c1b8d64142f22c86ee0`.
Existing normal merges `49c09b12e819b6b0746b5885346211921db24366` and
`d28ec15c09c3000f85c865e8a59de46130ab3a8c` retained that source. GitHub also
confirmed PR12 is closed/merged with head `44f1f72f857e88f69668a72c73180bed0761c43d`.
No duplicate merge, reset, cherry-pick or history rewrite was needed.

The preceding checkpoint's statement that PR12 remained unmerged was stale;
exact source ancestry and GitHub state correct that claim. PR11 remains
preserved. No PR13 merge or privacy/budget feature change was performed here.

## Newly added verification

The existing 26 focused tests and current-source task regression already had
package commands and explicit ordinary CI steps. They were retained, not
duplicated. The disposable CI reproducer now runs both.

New `test:valo-checker-http-db` runs the real HTTP router, verified-workspace
and same-origin middleware, domain services and PostgreSQL. Only identity
provider transport is controlled **inside this test process**; no production
authentication bypass was added. The test uses the real empty registry and
does not mock registry eligibility or create publication records.

Its actual journey covers:

- Anonymous business-name rejection; missing identity and unverified email
  denial.
- Valid private preview with private/no-store headers, no saved preview and
  rejection of browser-supplied eligibility.
- Active-identity hostile-origin denial with unchanged assessment rows.
- Explicit save consent and profile revision conflict; typed rich facts,
  canonical defaults, literal names and three marker states.
- Real saved assessment/hash round trip, history, a second changed assessment
  and nested-fact comparison.
- Cross-workspace detail/comparison denial; revoked session, suspension and
  revoked membership denial.
- An unchanged release registry before/after.

The new HTTP group is in ordinary database CI and the disposable reproducer.
It uses newly created synthetic workspaces in disposable loopback PostgreSQL,
not the user's workspace database.

## Actual results

Run `7eb4f957-0c13-4eab-9659-6a3ebfe860b5`, 15 November 2026,
10:06:49.325–10:08:06.236 UTC:

| Group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Credential-free imports/native detector | 3 | 0 | 0 |
| Controlled export zero-effects boundary | 1 | 0 | 0 |
| Rich checker engine/contracts/UI helpers | 26 | 0 | 0 |
| Current-source task guards, real PostgreSQL | 15 | 0 | 0 |
| New actual HTTP checker journey | 5 | 0 | 0 |
| Portable erasure/storage regressions | 18 | 0 | 1 |
| Existing privacy HTTP regressions | 7 | 0 | 0 |
| **Engineering total** | **75** | **0** | **1** |

The explicit skip is the separate genuine-native-storage proof. No whole
erasure suite was skipped; the native-call detector remained enabled.
Full workspace typecheck passed. The database cluster was stopped and removed.
These counts include test parents and are not legal-content acceptance.

Task checks cover ten current-source refusal variants, reminders enabled/disabled,
ownership/injected bindings and a manual-task fallback. Denials preserve task,
outbox, event and historical assessment state. Registry control is limited to
that isolated test process; it does not establish real Nigerian rule eligibility.
Concurrent withdrawal/commit ordering is not proved by that registry mock.

Earlier harness attempts are retained:
`faff7a0d-8b04-401c-af72-120074016525`,
`fb4b3234-47b2-4212-8c86-b1343d3d08c8`,
`b8a73392-66ee-4177-9f48-816ede0b57ec`.
Their failed HTTP assertions are not passes. The final fixture saves a real
synthetic profile, supplies its current revision, compares schema-normalized
facts, and separately asserts exact rich answers. No authored oracle was edited.

## Browser proof and remaining limits

The actual development-proxy anonymous browser journey passed at **360px and
1280px**: questionnaire → review → preview, three distinct answer markers in
the outbound request, visible keyboard focus, no horizontal overflow through
results, and actual source-eligibility injection rejection (422). The real
registry yielded zero items and an honest coverage-unavailable result.

The supported testing service returned `Unknown config kind: testing`.
Its managed sign-in helper was therefore unavailable. No alternative
authentication bypass, sign-up email or provider configuration was introduced.
**Signed-in browser save/history/comparison and result-driven missing-answer
focus remain unverified.** Private HTTP save/history is not mislabeled as that
browser proof. Four-label behavior is proven by the isolated engine/helper
tests, not four real released recommendations in a customer browser.

## Original source contract remains held

The original 80-case corpus bytes remain unchanged, SHA-256
`5e333b3f472263e16f767b3165e29c1b1e210fdbac922873d1ffc086027ae1a0`.
No source algorithm or oracle disposition changed. The retained earlier
72-match/eight-disagreement result was not rerun or accepted here; disagreements
NDPA018, NTAA009 and NAFDAC005/009/012/013/016/017 remain held.

No paid inference, PSP/email execution, new release evidence, publication,
customer-data deletion, main merge or deployment occurred. This does not accept
R1/R2, WCAG conformance or the formal 80/60/60 suites.

Compact evidence: `evidence/pr12-runtime-result.json`.
Full logs: `generated-artifacts/valo-pr12-runtime/` and
`generated-artifacts/valo-ci-portability/7eb4f957-0c13-4eab-9659-6a3ebfe860b5/`.
Hosted CI must be reported separately from local tests.
