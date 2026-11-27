# Evaluation evidence policy

Three separate formal suites are required:

| Suite | Minimum distinct cases | Acceptance |
|---|---:|---|
| Deterministic checker rules | 80 | All critical expected outcomes pass |
| Customer AI | 60 | At least 95% overall, zero critical failures |
| Editorial | 60 | At least 95% overall, zero critical false publications |

All three currently have **zero executed acceptance cases**. Early synthetic validator tests are deliberately excluded from these totals.

Rule scenarios need immutable rule/source versions, dated input facts with unknown/unanswered/not-applicable distinctions, expected reasons/applicability and observed outputs. Do not generate live rules from an LLM.

Customer AI cases need actual provider run IDs, prompt/model versions, supplied business facts, missing-fact expectations, deterministic numeric expectations and observed output. Never invent amounts, parties, registration details, tax rates, signatures or payment proof.

Editorial cases need real source excerpts or explicit deterministic failure conditions and expected publish/hold outcomes. Reviewers receive the same candidate/source bundle, not each other's verdict. Agreement is not professional review or a legal-accuracy measurement.

All evidence must identify the exact candidate/rule/application version and test execution. A model-authored success report, simulated provider success or fixture attestation is not operational proof.

Other required evidence remains absent: end-to-end identity/recovery, API, migrations, negative isolation, private exports, concurrency, sandbox payment/reconciliation, accessibility/mobile, load, restore, independent security/privacy and real-user beta. No absent gate is accepted.
