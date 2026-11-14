# Rich-answer checker integration checkpoint

Status: implemented on a private feature branch; no content or rule publication. Base: `7e663dee8ff914f66e4d4ac7a5fe7b083fe28e51`. This checkpoint is not full R1/R2 acceptance.

## Customer behavior

The optional questionnaire captures business-name, privacy, company-period and product facts with an explicit `checker-facts-v2` version. It keeps known false, omitted, unknown, unanswered and not-applicable answers distinct. Names remain literal. Review, consented save, saved history and comparisons handle nested answers, removed answers and partner rows without flattening them into object text. Changing an operator or prefilling a basic profile preserves optional answers. Saving the basic profile alone explicitly excludes those optional answers.

Anonymous checks do not ask for or accept the business-name namespace. Signed-in preview uses `/workspace/checker/preview`, behind the existing verified workspace and same-origin middleware. It checks membership in the repository transaction and does not persist preview inputs. The public and private preview paths have strict core validation before generated DTO parsing, so browser-supplied source policy or eligibility fields are rejected rather than silently stripped.

Results render all four labels, including a May-apply-only result. Scoped propositions, missing-answer states and an assertion notice are shown. A server-disallowed source-linked task is unavailable even if an item is likely relevant. Existing asserted registration does not generate a duplicate application task. No deadlines are invented.

## Source-bound execution

An eligible server registry rule may select one versioned source-family evaluator instead of a legacy predicate condition. Its family/version/implementation hash is reviewed as part of the existing canonical rule publication body. Registry, manifest, source passage, provenance, freshness and effective-period gates remain mandatory; implementation mismatch is excluded centrally, including task lookups. The four existing deterministic candidate implementations are unchanged. Their isolated eligibility flags are not copied to customer results. No rule, manifest, reviewer decision or release is created by this change.

Unknown role and household-purpose omissions cannot silently establish an exception. The customer supplies factual assertions, not a publication context. Existing v1 facts and result hashes stay unchanged; new rich snapshots have an explicit version. Date-only rich facts remain strings through generated request/response schemas.

## Observed validation

- Real Orval 8.47.0 generation completed from the OpenAPI contract.
- 17 focused Node tests passed: 11 core/contract tests and 6 UI helper tests. The retained raw output is [rich-checker-focused-validation.txt](evidence/rich-checker-focused-validation.txt).
- Strict TypeScript validation of the changed core, focused tests and generated schema modules passed. The command and exit status are in the same log.
- A separate focused UI TypeScript check passed using actual generated API, core, React and query types, plus temporary declarations for unavailable external UI packages. This is not a full application build. Four changed TSX files also parsed through esbuild.
- The old no-rule v1 fixture was run with the unchanged base engine; its hash remains `4d106813d86b2e328264d113807beea64666854d9692d44bae553af03802ea04`.
- Tests execute four-label source-family behavior only with explicitly marked in-memory synthetic fixtures. Production execution rejects those fixtures; tests do not create publication evidence.

The original 80-case corpus and candidate algorithms are untouched. Prior offline outcome remains 72 matches and 8 oracle disagreements: NDPA018, NTAA009, NAFDAC005/009/012/013/016/017. These new tests neither rerun nor resolve that oracle.

## Required integrated verification

Replit/CI must run the full application build and database/HTTP tests at the integration commit. Verify authenticated private preview, anonymous business-name rejection, same-origin rejection, revoked membership, rate limiting, client eligibility injection, consent/revision conflicts, v1/v2 persistence/hash integrity, cross-workspace history/compare denial and live stale/withdrawn rule task refusal. Test released-rule dispatch only with legitimate existing eligible evidence or clearly isolated fixtures; never publish a synthetic fixture.

Browser checks remain unrun: mobile layout, keyboard and screen-reader labels, opening/focusing a missing nested field, signed-out/in transitions, preserved answers, review/edit/re-preview/save/history/compare and all four result groups. Confirm an empty eligible registry still presents honest coverage-unavailable guidance. No rendered or cross-browser evidence is claimed.

No paid AI, PSP call, email, deployment, database migration or release action was performed. Package/lock/CI, budget, privacy and receipt implementation files are outside this branch's scope.
