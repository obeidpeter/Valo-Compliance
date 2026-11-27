# Editorial evidence and CI portability checkpoint

This checkpoint preserves the private development branch and all budget work
through `ef8e47513add00c3bb58fa14ecbc9fffe71cc171`. It changes no budget, checker,
receipt, erasure, privacy-role or recovery feature implementation.

## Integration state

PR11 source `52d81a2459e763df5616ff35bc794461fa35e163` is already merged into
development. Git ancestry and GitHub both confirmed that state. No duplicate
merge or maintenance recovery was performed. Its original six reporting tests,
plus a later seventh, already run under `test:valo`; the database receipt group
is also in routine CI. PR12 awaits the coordinator's final head; PR13 is not
approved for integration. Neither was merged here.

## Changed behavior

- C038/C039 explicitly select the retained v5 baseline, never the latest v8
  candidate or a silent fallback. Missing, altered or stale bindings still hold.
- The exact v5 summary is `docs/valo/evidence/operational-publication-v5.json`,
  SHA-256 `b30281622c7576f971ff97921dbbdff91bb5ed5b2d480aee2704e0a44092baef`,
  candidate `467e1813e83912096930e8142352174d03732f024ecb916d3c59bec2513752f2`.
  Its actual review artifacts are:
  - `3eafe5aa-2b14-4af6-ac13-d283a0b8aaff`,
    SHA-256 `fd0f3742193da82ee79bbe67dd75c2c5c57249d48c311e39c378d17f25830902`;
  - `dce53fdd-da91-41c0-9fc0-9d03bed20855`,
    SHA-256 `7bb9b501dde7d1321934a236872f3c3f5cacfb4012b52888ef08f9a7fe2f3924`.
  The retained factual verdict is **hold**, the challenge verdict **pass**.
  These are historical receipts, not new calls or a publication pass.
- C054 captures pre-execution denial IDs and rejects their reuse. All three
  committed receipts must match this run, candidate and requested action.
- Selected-case execution keeps all original case IDs/hashes and labels
  unselected cases `not_selected`, not passed. Immutable run reports preserve
  previous results; a selected run does not replace the prior full-suite report.
- A dedicated `verify-ci-portability.mjs` reproduces credential-free imports,
  controlled export rejection, portable storage and privacy HTTP checks in a
  new disposable PostgreSQL instance. It does not touch the workspace database
  or supply provider credentials. Native storage is deliberately not proved.

## Executed verification

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Ordinary API engineering suite, no database/provider credentials | 201 | 0 | 1 |
| PR11 reporting / PostgreSQL receipt / commerce | 7 / 4 / 15 | 0 | 0 |
| Credential-free import and native-call detector | 3 | 0 | 0 |
| Controlled export/worker zero-effects boundary | 1 | 0 | 0 |
| Portable PostgreSQL erasure/storage | 18 | 0 | 1 |
| Actual HTTP privacy role/session/origin | 7 | 0 | 0 |
| Editorial provenance and action-denial controls | 6 | 0 | 0 |

Counts overlap (receipt reporting also runs in the API suite); do not sum them
as distinct acceptance cases. The API skip is the separately gated isolated
parser-process test. The portable skip is the explicit genuine-native-storage
proof, not a skip of the portable erasure suite. Full workspace typecheck passed;
API typecheck passed again after the final runner edits.

Fresh isolated receipt run: `0ff4c745-7ae3-4456-b173-83ca20f858d7`,
09:43:21–09:43:43 UTC, 15 November 2026.
Fresh isolated CI run: `e0462619-6150-4c41-91b7-6a577b574ed2`,
09:47:48–09:48:13 UTC. Both clusters were stopped and removed.

C054 actually executed against the development database in evaluation
`ba4bdf18-bbb6-4626-ac42-6f9c3d95e2ee`. PostgreSQL rejected the publisher's
financial operation with SQLSTATE `42501`; three newly committed denials were
read back:

| Action | New audit ID |
|---|---|
| price | `c4cae729-65ce-4918-b2c7-df17645b9e19` |
| payment | `e5712483-d36a-4246-a4a5-c9c6e3e450d7` |
| government_filing | `e627dd3d-aa50-429b-bf1b-44ffccb9960a` |

Pre-existing count for that candidate was zero. No financial rows changed or
external actions executed. This is **one negative engineering control**:
59 other cases were not selected, formal acceptance remains false, and no new
provider review or eligible publication occurred. C038/C039 were not rerun
against native private artifacts during this no-provider-call checkpoint.

A second execution, `bd56a290-5aa5-4a92-869e-adcb5d5a397f`, observed the three
pre-existing records and required three different new IDs:
`91cd1539-636c-444a-bcff-aeed24c8d945`,
`44f7a377-6043-426e-876b-610b69364db0`,
`25c6284b-f605-4ec6-9743-3beab7ba8464`.
It also passed. This is a repeat of C054, not a second accepted case.

The broad unchanged budget integration harness exceeded the shell's 120-second
limit during its managed-caller group. Partial logs were retained under
`generated-artifacts/valo-finite-final-gate/6bd8aba6-b66d-498b-8a8f-f8ea71162694`;
it is **not** counted as a completed passing run. The focused CI portability
runner subsequently completed independently. New budget work remains with its
separate branch.

## Evidence and boundaries

Compact metadata and log hashes: `evidence/editorial-ci-integration-result.json`.
Full local logs: `generated-artifacts/valo-editorial-ci-review/`,
`generated-artifacts/valo-receipt-integration/0ff4c745-7ae3-4456-b173-83ca20f858d7/`,
and `generated-artifacts/valo-ci-portability/e0462619-6150-4c41-91b7-6a577b574ed2/`.

Hosted CI for the preceding exact head had failed **before startup**, reporting
an account billing/spending restriction. These local results do not relabel
those runs green. Hosted results for the new commit must be checked separately;
no plan, account limit or workflow security control was changed.

No owner spending approval, inference call, live payment, external message,
publication, deployment or actual customer deletion was performed. The required
80-rule / 60-customer-AI / 60-editorial acceptance and R1/R2 release gates remain
unaccepted. All previous holds and evidence remain.
