# Operational editorial hold: exact findings and corrected content

Reviewed: 14 November 2026. Repository checkpoint: `3409a4f0e7e38b864b6b3f3240608761569ac462`. Scope: read-only evidence inspection and original prose revision; no application code changed, Replit mutation, quota change or provider review call.

**Result:** Complete corrected TPL-07 and TPL-06 bodies are in `analysis/operational-template-revisions.md`, SHA-256 `f0a427d404b8fc4d2c09b6444ca01760ac221836f52d8781dadc4248237ec664`. Both remain drafts. TPL-07 is the first candidate to ingest and genuinely recheck. No publication success is claimed.

## What the recorded holds actually show

| Evidence at the checkpoint | Finding | Consequence |
|---|---|---|
| [Permission/publication proof](https://github.com/obeidpeter/Valo-Compliance/blob/3409a4f0e7e38b864b6b3f3240608761569ac462/docs/valo/evidence/chatgpt-permission-publication-proof.json), `prior[0]`, version 4 | Both reviews held. Findings questioned the meanings of AI review, provenance-check date, upstream authorship attribution and commercial permission. They did not identify an incorrect stock formula. | Tighten the exact claims and evidence. Do not invent a human review or upstream receipt. |
| Same proof, `prior[1]`, version 5, lines 89–118 | Factual review held; challenge passed with empty findings. Remaining factual findings concerned ambiguous review/provenance language. | A challenge pass alone cannot publish. Nor is this evidence that all operational instructions are wrong. |
| Same proof, `quotaHold`, lines 120–145 | Version 6 made zero new provider requests; six reservations remained six. Hold reason is `OPERATIONAL_REVIEW_DAILY_CAP_REACHED`, recorded durably. | Version 6 has no fresh substantive reviewer verdict. Waiting does not clear it, and this work does not authorise bypassing or increasing the cap. |
| [Current canonical wrapper](https://github.com/obeidpeter/Valo-Compliance/blob/3409a4f0e7e38b864b6b3f3240608761569ac462/artifacts/api-server/src/editorial/operational-content.ts), lines 29–31 | Already explains two automated AI checks, expressly excludes human/professional review, narrows the check date to file integrity/provider permission and disclaims independent upstream authorship verification. | These wording corrections already exist in v6. Report their pending review truthfully instead of presenting them as another content failure or requesting fictitious credentials. |
| [Scoped provider permission](https://github.com/obeidpeter/Valo-Compliance/blob/3409a4f0e7e38b864b6b3f3240608761569ac462/docs/valo/policies/chatgpt-provider-permission.json), `record.sourceBinding` and `limitations` | Provider permission is verified for the retained original file, without classifying the account plan, copyright certification or accepting customer sales terms. | The new file needs a new checked lineage/hash binding. The old verified hash is not evidence that this revision was reviewed. Do not introduce an unrelated paid-plan hold. |

The actual requirement is explicit: TRD EDP-008, `extracted/Valo_Technical_Requirements_Document_AI_Revised(2).txt:333`, requires “AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist”, date, scope and limitations on detail pages and exports. EDP-004/007 require distinct review runs and immutable bindings; EDP-001/007 exclude routine per-item human sign-off. Preserve the exact required notice, explain that review means AI checks, and publish that release status only after the genuine checks pass. DOC-006, line 137, separates creation/provider/commercial permission evidence from the product owner's customer commercial terms before sales.

## Substantive fixes supplied

1. **TPL-07 is self-contained.** Blank means unresolved; confirmed zero is explicit; an unknown input prevents a completed running balance. The old global file instructions were outside the imported TPL section. The new body also distinguishes the opening balance from a receipt and states how the first/subsequent balances connect.
2. **Quantity reconciliation cannot silently count twice.** Each sheet uses one item/location/unit and, where selected, one batch. The count uses the same movement cutoff as the expected balance. A difference is an observation; any chosen correction posts once with a reference. Transfers decrease the origin and increase the destination. Negative balances remain visible for investigation.
3. **TPL-06 separates gross claims from funding.** Line requests and approved expense totals are before advances/reimbursements. Funding has a dated unique reference, category, excluded/returned amount and remaining allocation. Summary B/C use only the remaining allocations. A later payment updates that same funding snapshot once before recalculation.
4. **Both forms preserve uncertainty and scope.** No invented tax rate, statutory period, customer fact, regulatory approval or legal conclusion. Currency conversions require a retained original amount/currency, rate/date/basis and resulting claim-currency amount. Two-column records provide workable editable fields without a nine-column portrait table.

An independent read-only AI review found no remaining concrete arithmetic blocker in these revisions. Its check-date clarification and two usability suggestions were incorporated. This peer review is not an EDP run or publication evidence. Eleven local Decimal assertions checked the example arithmetic; no application tests, export rendering or visual inspection were run here.

## Exact next handoff and acceptance evidence

Ingest the revised **TPL-07 body only** first. The current importer reads the original source path and splits TPL-07 at the TPL-09 heading; this revision file deliberately presents TPL-07 first and TPL-06 second. Do not point that delimiter-based import directly at the entire revision file or it may absorb the second form and internal handoff. Replace the matching body in the existing source structure or use an ID-bounded section extraction, keeping internal metadata out of customer exports. Preserve inventory ID/title/classification.

Update the original-authoring lineage and permission source binding to the exact new bytes. Assemble the required disclosure, accurately scoped actual check date, scope and limitations before hashing the complete canonical candidate. Re-render DOCX/PDF from that candidate. The first form preserves the `Running quantity` phrase used by the existing export check. Run a new independent factual/challenge pair only when the configured allowance permits; the old verdicts cannot attach to the revised hash. Keep any unresolved specific finding held.

| Concrete behavior to check | Expected result |
|---|---|
| Opening 10; receipt 3; count 12; chosen adjustment −1 | Running 13, then 12; never 11 or a duplicated opening receipt. |
| Previous 1.5; received 0.25; issued 0.5; adjustment −0.1 | 1.15 in the stated unit, without binary rounding artifacts. |
| Previous 0; issued 1 | −1 remains visible for investigation. |
| Receipt unknown; other quantities known | No completed running balance; blank is not silently zero. |
| Transfer 3 from location A=10 to B=2 | A=7, B=5; combined quantity remains 12. |
| Requested gross 100; approved gross 90; advance 40; previous reimbursement 20 | Requested balance 40; approved balance 30. |
| Further reimbursement 10 on the preceding approved claim | Updated reimbursement allocation 30; remaining approved balance 20. |
| Advance received 100; returned 20; used on another claim 20 | Remaining allocation 60; against expense total 80 the balance is 20. |

Before claiming successful publication, retain actual exports with usable writing space, page breaks and the required status/date/scope; two actual passing reviews on the canonical hash; the complete mandatory-check evidence; atomic publisher success; and released availability/withdrawal proof. At this checkpoint the export proof checks file signatures and text presence, while manual application/accessibility inspection is explicitly false. `operational-preparation.ts:117` maps all mandatory-check names to `pass`; that mapping itself is not evidence that each named check ran. Replit must bind each claimed check to its actual execution. This note neither weakens those gates nor counts a draft toward the release target.
