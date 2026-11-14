# Rich-answer checker integration checkpoint

Status: implemented on a private feature branch; no content or rule publication. Base: `7e663dee8ff914f66e4d4ac7a5fe7b083fe28e51`. This checkpoint is not full R1/R2 acceptance.

## Customer behavior

The optional questionnaire captures business-name, privacy, company-period and product facts with an explicit `checker-facts-v2` version. It keeps known false, omitted, unknown, unanswered and not-applicable answers distinct. Names remain literal. Review, consented save, saved history and comparisons handle nested answers, removed answers and partner rows without flattening them into object text. Changing an operator or prefilling a basic profile preserves optional answers. Saving the basic profile alone explicitly excludes those optional answers.

Anonymous checks do not ask for or accept the business-name namespace. Signed-in preview uses `/workspace/checker/preview`, behind the existing verified workspace and same-origin middleware. It checks membership in the repository transaction and does not persist preview inputs. The public and private preview paths have strict core validation before generated DTO parsing, so browser-supplied source policy or eligibility fields are rejected rather than silently stripped.

Results render all four labels, including a May-apply-only result. Composite source questions map to actual customer fields and preserve each marker. Known contradictory answers are marked for review without rewriting the answer. Unresolved authority or classification issues appear as explicit Valo source-review holds rather than invented questions. Missing factual questions have validated links to their mounted controls; supporting privacy circumstances have a bounded input that warns against personal/sensitive details. Scoped propositions, missing-answer states and an assertion notice are shown. A server-disallowed source-linked task is unavailable even if an item is likely relevant. Existing asserted registration does not generate a duplicate application task. No deadlines are invented.

## Source-bound execution

An eligible server registry rule may select one versioned source-family evaluator instead of a legacy predicate condition. Its family/version/implementation hash is reviewed as part of the existing canonical rule publication body. Registry, manifest, source passage, provenance, freshness and effective-period gates remain mandatory; implementation mismatch is excluded centrally, including task lookups. The four existing deterministic candidate implementations are unchanged. Their isolated eligibility flags are not copied to customer results. No rule, manifest, reviewer decision or release is created by this change.

Unknown role and household-purpose omissions cannot silently establish an exception. The customer supplies factual assertions, not a publication context. Existing v1 facts and result hashes stay unchanged; new rich snapshots have an explicit version. Date-only rich facts remain strings through generated request/response schemas.

## Observed validation

- Real Orval 8.47.0 generation completed from the OpenAPI contract.
- 26 focused Node tests passed: 18 engine/contract tests and 8 UI helper tests. The retained raw output is [rich-checker-focused-validation.txt](evidence/rich-checker-focused-validation.txt).
- Strict TypeScript validation of the changed core, focused tests, generated schema modules and existing predicate fixture helper passed. The actual composite core project build also passed. The command and exit status are in the same log.
- A separate focused UI TypeScript check passed using actual generated API, core, React and query types, plus temporary declarations for unavailable external UI packages. This is not a full application build. Four changed TSX files also parsed through esbuild.
- All 80 existing synthetic predicate-engineering fixtures passed after a type-only `NonNullable` correction for optional rule conditions. These are a separate suite from the original source oracle.
- The old no-rule v1 fixture was run with the unchanged base engine; its hash remains `4d106813d86b2e328264d113807beea64666854d9692d44bae553af03802ea04`.
- Tests execute four-label source-family behavior only with explicitly marked in-memory synthetic fixtures. Production execution rejects those fixtures; tests do not create publication evidence.

The original 80-case corpus and candidate algorithms are untouched. Prior offline outcome remains 72 matches and 8 oracle disagreements: NDPA018, NTAA009, NAFDAC005/009/012/013/016/017. These new tests neither rerun nor resolve that oracle.

## Required integrated verification

Replit/CI must run the full application build and database/HTTP tests at the integration commit. Verify authenticated private preview, anonymous business-name rejection, same-origin rejection, revoked membership, rate limiting, client eligibility injection, consent/revision conflicts, v1/v2 persistence/hash integrity, cross-workspace history/compare denial and live stale/withdrawn rule task refusal. Test released-rule dispatch only with legitimate existing eligible evidence or clearly isolated fixtures; never publish a synthetic fixture.

Browser checks remain unrun: mobile layout, keyboard and screen-reader labels, opening/focusing a missing nested field, signed-out/in transitions, preserved answers, review/edit/re-preview/save/history/compare and all four result groups. Confirm an empty eligible registry still presents honest coverage-unavailable guidance. No rendered or cross-browser evidence is claimed.

No paid AI, PSP call, email, deployment, database migration or release action was performed. Dependency/lock, budget, privacy and receipt implementation files remain outside this branch's scope. Two narrow test scripts and CI steps were subsequently authorized and registered as described below.

CI follow-up: the first commit exposed a composite TypeScript project-boundary error because the contract test was placed in the core source project. It has been moved to `artifacts/api-server/src/lib/valo-checker-rich.test.ts`, which already owns both API-schema and core dependencies. No package scripts, dependency files or CI configuration were changed. Run this test explicitly with the UI helper test when integrating.

Independent-review follow-up: seven engine/contract regressions cover composite marker preservation, known contradictory facts, authority-only holds, supporting circumstances, sample-permit scope, succession names and unsupported classification. Two UI regressions cover mounted targets and rejection of internal aliases. No source candidate implementation or source-oracle expectation was changed.

GitHub CI at `a94598425b6ba9a9defcc68c8e55522b5c2e4ca0` passed library/API-server/UI typechecks before finding the predicate fixture helper type alias addressed here. Its PostgreSQL job failed on the pre-existing native-private-storage configuration in the privacy-erasure suite; no privacy/storage/CI file was changed by this branch. The final head requires its own checks; earlier results are not final-head acceptance.


Task-creation correction: before any source-linked task insert, the service now reassesses the immutable saved facts with the current server-owned registry, current Lagos assessment date and current time. This reuses the engine's trust, implementation, freshness, effective-period and conflicting-version gates, independent of reminder settings and due dates. The saved historical snapshot is not rewritten. A current result must still be likely relevant and permit the source-linked action.

`artifacts/api-server/src/lib/valo-task-source-guard.integration.test.ts` adds an isolated PostgreSQL service test with positive legacy behavior, ten current-rule denial variants, effect/rollback checks, reminders-on and reminders-off paths, ownership/injection checks and manual-task fallback. It controls only the registry dependency through Node's test-process module mocking; it never creates publication rows. Local discovery skipped this database test because a disposable PostgreSQL environment was unavailable. Its cases are authored, not claimed passed. Run explicitly with `VALO_RUN_DB_TESTS=synthetic-development-only NODE_ENV=development node --experimental-test-module-mocks --import tsx --test artifacts/api-server/src/lib/valo-task-source-guard.integration.test.ts` against a loopback disposable database.

The task guard received a separate implementation review before this checkpoint. That review is not database execution or publication approval. Concurrent registry withdrawal is not proven by the test-process registry mock; integrated verification must examine the currently unlocked registry read and transaction ordering.


CI correction after `2aca65f4`: run 43649940135 found two test-only TypeScript errors where the newly authored database test asserted `ruleVersion` on the public task DTO. That DTO intentionally omits the internal binding. The assertions now read the persisted `valoTasks.ruleVersion` column instead, retaining the version-binding checks without changing the customer API. That run's full workspace typecheck failed; it is not claimed passed. Its existing PostgreSQL suite executed 81 tests (79 pass, 2 privacy-storage failures); it did not execute the newly authored checker or task-guard test because package test lists remain explicit. The task guard must still be run explicitly in the isolated integration environment.


CI registration follow-up: `artifacts/api-server/package.json` now adds `test:valo-rich-checker` (the 18 engine/contract and 8 UI helper cases) and `test:valo-task-source-guard` (explicit synthetic marker, development mode and experimental Node test-module mocks). `.github/workflows/valo-foundation.yml` invokes the first immediately after full typechecking and the second immediately after migrations against the existing disposable loopback PostgreSQL service. No existing test command or coverage is removed, and the new tests execute before later unrelated suites. No dependency, lockfile, privacy, receipt or budget source change is involved. The pushed run's actual new-test results must be inspected before claiming database execution passed.
