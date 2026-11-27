# ChatGPT prose permission and durable editorial holds

The supplied note at `551e5580662cc305c05f3fd2c705a74b035c2c82` was already an ancestor of the current feature branch. Normal fetch/merge reported “Already up to date”; the note and both existing histories were preserved.

## Implemented

- A separate, hash-bound **original ChatGPT prose** permission route. It validates the operational source file against the retained authoring note.
- Independently retrieved full official ROW/EU terms, ChatGPT commercial-output FAQ, service terms and scoped publication policy. Exact page hashes/passages are bound into the rights artifact.
- No invented paid-plan, residence or account-contract classification is required for the FAQ's documented free/paid output-use permission. This does **not** clear Replit/API-authored content through ChatGPT terms.
- Provider permission is separate from copyright eligibility, non-infringement, third-party rights and Valo customer licence acceptance. No commercial sales approval was recorded.
- Review records now bind server evidence to the exact candidate, check date, original source, provenance/rights artifacts, provider snapshot and export report. The publisher checks these bindings again.
- Original AI attribution and software check dates are distinguished from independent upstream authorship certification. The exact mandatory AI disclosure is retained, with an explicit explanation that the two reviews are automated, not human/professional review.
- Review budget reserves a complete factual/challenge pair atomically. It cannot spend on a lone review when insufficient pair capacity remains.
- Quota/provider failures now persist a **held candidate and audit reason**. They cannot make an empty review list eligible.

## Actual results, not publication approval

| Evidence | Actual outcome |
|---|---|
| API/domain suite | **69 passed, one opt-in skip**; includes four new permission guard tests |
| Workspace type checking | Passed |
| Actual source-note and provider-page check | Provider-permission component verified; regional/account contract unclassified |
| Candidate v4 | Two real independent provider responses; both held |
| Candidate v5 | Two real independent responses; factual held, challenge passed |
| Revised candidate v6 | No provider call: existing daily review budget exhausted; durably held |
| Real database failure-path proof | Quota unchanged; held state/audit persisted; held publisher invocation rejected |
| Private artifacts | Five actual content-addressed artifacts retrieved and checksum checked for v6, including its DOCX/PDF and export report |

Versions 4 and 5 retain their original findings. They raised ambiguity about attribution, check dates and the AI-versus-professional disclosure. Subsequent changes supplied server-attested facts and narrowed the wording; **the revised version has not yet received a review pair**. The cap was not raised, reset or bypassed. Elapsed time never changes a held version into a published version.

The original source note does not independently certify copyright or third-party clearance. The four pure guard tests use synthetic text and are not authoritative source evidence. The real proof separately reads the actual retained note, downloaded full-page snapshots, private artifacts and database state.

## Evidence and reproduction

- `evidence/chatgpt-permission-publication-proof.json`: actual source hashes, official page hashes/locators, four provider response IDs, original verdicts and durable-cap proof.
- `policies/chatgpt-provider-permission.json`: scoped permission register; copyright, customer-licence and publication approval remain false.
- `evidence/chatgpt-provider-terms-snapshot.json`: full actual retrieved text for all five official pages, not search snippets.
- `evidence/operational-publication-v4.json`, `v5.json`, `v6.json`: exact versioned outcomes.
- `evidence/chatgpt-permission-api-tests.txt`: full API test output.
- `evidence/chatgpt-permission-predicate-tests.txt`: isolated four-test output.
- `evidence/operational-cap-before-durable-hold.txt`: earlier failure retained to show the failure-path defect being corrected.

```sh
pnpm --filter @workspace/api-server test:valo
pnpm run typecheck
NODE_ENV=development VALO_OPERATIONAL_PUBLICATION=synthetic-development-only \
  pnpm --filter @workspace/api-server exec tsx src/scripts/chatgpt-permission-proof.ts
```

The last command only runs when the actual daily review budget is exhausted; it refuses to manufacture exhaustion or spend a review pair. It requires a fresh retained provider snapshot and creates another auditable held development version.

## Not proved

There is still **no eligible development release or real withdrawal/historical-draft drill**. A held-version rejection is not a substitute for a positive publication control. The original 80/60/60 candidate files remain unchanged; this is not execution or acceptance of those suites. Earlier `operational-publication-checkpoint.json` is a historical report, not an all-current count.

R1/R2 acceptance, public launch, live payments, recurring billing and confidential customer data remain disabled/unaccepted. Independent authorised implementation need not wait for the review budget; only a new real review pair is currently blocked by it.
