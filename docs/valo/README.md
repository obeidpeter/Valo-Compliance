# Valo Compliance — implementation and evidence

Visible brand: **Valo**. Homepage copy: **The documents you need. The business rules you should know.**

This is development work, not a released compliance product. Do not infer acceptance from a title, a screenshot, a test fixture or this document.

## Working checker and customer AI checkpoint

The [executed feature checkpoint](checker-ai-checkpoint.md) records verified
customer assessments/history/tasks, opt-in held reminders, four actual-provider
AI drafting flows and eight private DOCX/PDF files checked through the browser.
The 80 engineering rule cases are not Nigerian source-backed acceptance. The
60 customer AI cases are not the separate editorial evaluation. R1/R2 remain
unaccepted and all release approvals remain separate.

## Contract intake

Part 4 reconciles all 27/79 source titles, makes row-level evidence/coverage holds
and all five overlap notes explicit, and connects the public industry page/library
filters to the exact 20-category taxonomy. R2 stays locked and R3 excluded. See
[inventory and coverage evidence](part4-inventory-and-coverage.md).

Part 3 adds the exact UAT packs, G0–G5 criteria/approver roles and non-waivable
release controls to the live proof register. See [measured controls and remaining
scope](part3-proof-and-controls.md). Receipt and partial test results are not release
acceptance.

The coordinating team added the complete master brief, TRD, roadmap and Essential Business Documents extracts to the existing GitHub feature branch. A read-only, Git-blob-hash-checked import preserved them under `docs/specification/` and `docs/registers/`; import SHA-256 evidence is in `evidence/specification-import.json`. All three complete extracts have been read. Word formatting is not reproduced. All 127 formal IDs, exact body/acceptance text, source locators, dependencies and original roadmap gate criteria are now executable. Earlier quoted requirements must remain byte-consistent with that baseline; mismatch fails explicitly.

All 27 supplementary document mappings and 79 regulatory source rows are preserved and traced: five direct template matches, one composite manual and 21 additions give 61 identified template types. The 19 further proposals have distinct artifact purposes compared with that inventory; they bring the identified backlog to 80, not the published catalogue. A personal conflict-of-interest declaration records an individual's disclosure, distinct from the NGO conflict-handling policy. Inventory titles, coordinating-team retrieval notes and model statements never substitute for authoritative claim evidence or rights. NGO SCUML aliases the broader SCUML topic; 79 source rows produce 78 canonical research topics, not 78 universal obligations.

## Executable registers

- `pnpm --filter @workspace/scripts valo:readiness` returns the current formal traceability, conflicts, release holds, catalogue and evaluation-suite state.
- `pnpm --filter @workspace/scripts test:valo` runs early deterministic unit checks. These are NOT the formal 80-rule, 60-customer-AI or 60-editorial suites, nor real model/export/restore evidence.
- `lib/valo-core/src/traceability.ts` and `requirements-r1.ts` preserve every supplied exact requirement body and acceptance text. Paths are partial implementation links, not acceptance evidence.
- `/development` reads the live development-only requirements, content and conflict registers from the API; it exposes no customer records and its detailed endpoints return 404 in production.
- `pnpm --filter @workspace/scripts valo:sync-specification` regenerates the canonical runtime registers only after all 127 source quotations and inventory counts validate.
- `lib/valo-core/src/catalogue.ts` contains inventory metadata only. Zero templates are released.
- `lib/valo-core/src/publication.ts` validates manifest bindings and mandatory conditions. It is **not a live publisher**. No HTTP endpoint accepts a submitted manifest as trustworthy.

## Current proof boundaries

The Next.js web app now serves through the managed Replit preview. Its production build and strict workspace typechecking pass. PostgreSQL synthetic integration tests demonstrate tenant-separated profile/draft persistence, stale-write rejection under concurrency, preserved revisions and durable enquiry acknowledgement. Anonymous HTTP probes demonstrate private 401 responses, no-store headers and cross-origin mutation rejection.

Clerk's branded browser screens and server identity checks are implemented, but verified login, recovery, expired-link handling, suspended/revoked-session browser tests and staff MFA are not yet demonstrated. The screenshot browser is signed out; the signed-in UI was not verified.

`lib/db/drizzle/0000_valo_p0.sql` retains the seven-table development schema. Application-level immutable document revisions have no update/delete route; database-role-level immutability and least-privilege grants are not yet proven. Restoring a prior draft revision is **not** disaster-recovery proof.

The baseline's 12 guided templates are not implemented by the generic manual editor. No private DOCX/PDF renderer, queue or storage has been implemented in this slice; export stays explicitly unavailable. Compliance/industry/resources pages expose held coverage, not invented guides or an approved checker. Prices, purchases, providers and live commerce are not simulated.

No customer drafts, legal publications, compliance rules, purchases, provider bookings or export files have been seeded as completed work.

The validator's synthetic attestations exercise logic. Production must derive attestations from an immutable trusted store, actual provider runs, source passages, rights records and real renderer outputs. Semantic completeness, prompt injection resilience, rights validity and legal accuracy are not established by hashes or unit tests.

## Explicit release restrictions

- R1 first; R2 remains locked until R1 required gates pass.
- R3 is out of scope.
- No public launch, live payments, recurring billing, real confidential customer data, paid hosting commitments or subscription purchases.
- No invented specialist endorsement. Per-item specialist review is not a required gate; actual owner scope policy, independent AI checks and deterministic validation are.
- No legal/regulatory lead is published until controlling text, claims, dates, rights and all applicable gates are proven.

## GitHub

A GitHub connection was attached. An initial metadata request returned HTTP 404. After secure sign-in and repository creation, a second request confirmed `obeidpeter/Valo-Compliance` is private, main points to the user-supplied initial commit, and the connected GitHub App has push access.

**Latest observation supersedes the historical private state:** GitHub metadata returned `private=false`. New application source has not been uploaded. Private visibility must be restored before synchronization resumes. No repository visibility, branch protection, main branch or plan was changed by this development batch. The coordinating team's complete specification baseline was imported read-only; its files were not overwritten.

Do not create a competing repository. Synchronization must preserve the initial main commit, add actual source on a feature branch and open a draft pull request without force pushes or direct main writes. Remote synchronization is not successful until the branch commit/tree and PR response are verified.

The initial source synchronization is now verified: 138 tracked files matched the remote blobs exactly, the initial main commit was preserved as parent, and main was unchanged. [Draft PR #2](https://github.com/obeidpeter/Valo-Compliance/pull/2) is open and verified as draft. See `evidence/repository-sync.json` for the snapshot evidence. This is a foundation-source synchronization, not a claim that the commissioned application is complete.

The owner reports the saved main protection rule is not enforced by the account plan. Enforcement is blocked; no upgrade, transfer, visibility change or bypass is authorised.

Foundation CI was initially held after targeted workflow writes returned HTTP 404. The user reconnected GitHub securely, and the single authorized retry succeeded with HTTP 201. The earlier foundation workflow is active remotely. Both activation runs completed successfully; see `evidence/ci-activation.json` for the actual source commit and observed steps. Expanded API input-safety, Next.js build and ephemeral PostgreSQL migration/isolation jobs are prepared locally, not remotely activated or claimed passing. No required-check or protection settings have been changed.
