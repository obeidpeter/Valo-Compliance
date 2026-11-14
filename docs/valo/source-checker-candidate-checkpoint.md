# Source-bound checker candidate checkpoint

This is **partial R1 development**, not acceptance of RUL-008, R1, R2 or a release gate.
The new algorithms run only in an isolated offline evaluation. The customer
assessment API still requires eligible released rules; none was created by this work.

## Actual implementation

- Implemented rich candidate facts for the supplied CAMA, NDPA, NTAA and NAFDAC
  families, including all partners, court appointments, true-name facts,
  controller/collection/territorial/exception facts, company classification and
  accounting-period facts, and actual product/activity/permit conditions.
- Preserved unknown, unanswered and not-applicable markers separately. A known
  false predicate is not inferred from an omitted answer.
- Bound the exact original 80-case corpus, algorithm bytes, source versions,
  locators, passage hashes and candidate versions. Repeated equal inputs produce
  equal result hashes. Original input hashes include facts not material to a
  particular branch; facts were not silently discarded.
- Exercised all four allowed labels. Every result remains
  `offline_candidate_only`, with no released manifest, customer eligibility,
  automatic task creation, statutory date or reminder.
- Preserved the original expected labels. Disagreements are retained as failures,
  not changed into passes. See the versioned proposed oracle dispositions below.
- Added real source-byte tamper, stale-source, missing-fact, partner/court,
  territorial, scope and live-schema rejection controls.

This does **not** yet integrate the new rich questions into the customer
questionnaire or compile these candidates into releasable declarative rules.
Those remain implementation work. The old synthetic 80 engine fixtures are separate.

## Executed results

| Check | Actual outcome |
|---|---|
| Supplied authored source corpus | **80 executed; 72 matched original expected labels; 8 disagreed; 0 unexecuted** |
| Source-candidate controls | **102 TAP records passed**, including 80 candidate input executions, parent records and additional controls |
| Formal source-backed 80 acceptance | **Not accepted**; disagreements and independent expected-outcome challenge remain |
| Customer-AI 60 / editorial 60 | Not executed by this work; no acceptance inferred |
| Provider AI calls / email sends / PSP calls | **0 / 0 / 0** |
| New published content or rules | **0** |

The original-oracle comparison command exits **1**. A successful engineering
control run does not change that failing comparison into legal acceptance.

Commands:

```sh
pnpm --filter @workspace/api-server test:valo-source-candidates
pnpm --filter @workspace/api-server exec tsx src/scripts/source-checker-evaluation.ts \
  --output=../../docs/valo/evidence/source-checker-80-candidate-evaluation.json \
  --retain-controls=../../generated-artifacts/valo-completion/source-candidate-controls.txt
```

Retained evidence:

- `docs/valo/evidence/source-checker-80-candidate-evaluation.json`: actual
  per-case outcomes, checks, source/candidate/input hashes and limitations.
- `docs/valo/evidence/source-checker-controls.raw.txt`: actual control output.
- `docs/valo/evidence/source-checker-candidate-evaluation.json`: earlier partial
  20-executed/60-unexecuted run, not the current 80-case outcome.
- `docs/valo/source-checker-oracle-v2-proposed.md`: eight explicit proposed
  dispositions; **not an accepted replacement oracle**.

## Actual privacy-source recovery

The direct NDPC PDF request returned **403** in this run. The supplied official
NCC mirror returned the full 43-page Act. Its raw SHA-256 exactly matched the
retained official NDPC research value:

`5bfb22cf7b344e92ecca9b80decf73db694a0d1000c4f42188f46e047d8df075`

`capture-ndpa-passages.ts` verified the raw hash, full page count, Act identity
and printed/page locators, then retained actual extracted pages for sections
2–3 and 27. It records the successful fetch without inventing an unrecorded
numeric success status. The original header-year inconsistencies are not
silently corrected. This does not establish exhaustive currentness, GAID
effectivity, publication rights for unrelated material or a publication pass.

The checker also verifies retained CAMA/NTAA passage bytes and the actual
repository NAFDAC PDF, full text and selected page hashes. Evidence identifies
which original PDF bytes were reverified and which are prior retrieval records;
there is no blanket claim of fresh retrieval.

## Remaining work and boundaries

Independent source/expected-outcome challenge, exact release adapters, richer
customer questions, eligible manifests and live assessment/withdrawal proof
remain. National scenario locations do not prove state/LGA coverage. No
specialist or per-item owner signature was added as a requirement.

Other outstanding R1 work—including twelve complete guided editor integrations,
privacy fulfilment/erasure, verified email events and the remaining staff and
commercial journeys—has not been completed by this checker work. R2 remains
prerequisite-gated and incomplete; R3, live payments and public launch remain off.
