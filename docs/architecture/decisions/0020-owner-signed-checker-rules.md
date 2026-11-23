# 0020 — Owner sign-off for requirements-checker rules

Date: 2026-11-23. Status: **proposed**. The product owner approved the direction on 2026-11-23,
in the content and speed plan ("Approved. Go ahead and implement"): "How checker rules are
released. I recommend an owner sign-off route like the one for regulatory guides, starting with the
four research notes. The existing route needs two paid AI reviews per rule." This record sets out
the route before it is built, so the owner can read what a sign-off will mean. It is marked accepted,
with its implementation, in the pull request that builds it.

## Context

The requirements checker has no released rule. Every check answers "No published rule covers these
answers yet", and says that this does not mean the business is exempt from anything.

A rule version is released today only by the operator command `rule-release.ts plan|apply` (ADM-004,
`modules/editorial/valo-rule-release.ts`). The checker admits a stored release only when its
publication bundle passes `evaluatePublication`: a factual and a challenge AI review, both passing,
the mechanical checks, the enhanced checks for any risk but `general`, and Word and PDF exports. No
AI allocation is approved, so no rule can pass that route.

Four research notes exist as engine code, pinned by hash and used by no released rule:

| Note | Evaluator | State |
| --- | --- | --- |
| CAMA s.814, registering a business name | `checker-business-name.ts` | Closest to release. Its captures are from 13–14 November and must be fetched again; its decision table needs critical scenarios in the checker's current facts. |
| NDPA s.27, information at collection | `checker-source-candidates.ts` | The registered source is the data protection commission's copy (ndpc.gov.ng); the retained capture is the communications commission's copy (ncc.gov.ng), so the registered copy must be captured. |
| NTAA s.11 and s.147, a company's return | `checker-source-candidates.ts` | Held: its binding records an unresolved discrepancy in the printed commencement date. Under EDP-005 a material uncertainty holds the whole rule. |
| NAFDAC Act (Cap F33), product manufacturing | `checker-source-candidates.ts` | No registered source names an official copy of the Act; one must be found and registered first. |

The 80 checker evaluation cases (`docs/evaluation-candidates/checker.json`) are frozen and wait for
an independent review (decision 0016): the last run matched 72, and the other 8 disagree with their
labels in ways the sources support. They are not used as release scenarios.

## Decision

1. **Who signs.** In development only, the designated development owner may release a rule version:
   the same owner who signs regulatory articles (a permanent system role granted by the operator
   bootstrap, `valo_manual_regulatory_owner`), with sign-in verified within the last 30 seconds.
2. **What is signed.** A rule candidate kept in the repository: the rule (`ruleSchema`, provenance
   `owner_signoff`), its sources' passages and the claims that tie each rule source to a passage, its
   rights record, and its critical scenarios. They travel in an owner-signed rule bundle bound by a
   manifest. The bundle has no AI run or review records, and nothing in it says a review happened.
3. **What is checked before the owner can sign.**
   - The reviewed route's evidence checks, unchanged: the candidate's hash, sources on the policy's
     official hosts, each claim's passage in its source's text, sources current and their amendments
     resolved, rights cleared, no unresolved material issue or missing evidence (EDP-005), and the
     candidate's class, jurisdiction and risk inside the guidance policy.
   - ADM-004's plan is ready: the rule is valid, it is the next version, every critical scenario
     passes, and the screen shows how many saved results it would change.
   - A source check of this exact candidate under a day old: each source is a registered source whose
     current capture, retrieved within a day, holds every quoted passage.
   - The guidance policy's approval stands, as for regulatory articles.
4. **What the owner confirms.** For any risk but `general`, EDP-005's enhanced checks are the owner's
   to confirm for this exact candidate, one by one, with the evidence the screen shows for each: the
   controlling text (each passage and its locator), amendments (the source's amendment record), the
   effective dates, the exceptions (the rule's exclusions), and the jurisdiction. The owner also reads
   what the rule tells a customer for each label and each scenario's expected and actual label.
5. **What the sign-off does.** One transaction records an immutable sign-off (owner, rule, version,
   manifest hash, source check, the confirmed checks, time), the release, its source bindings, and the
   rule's earlier version as superseded. A database trigger refuses an owner-signed release that has
   no matching sign-off by the designated owner made within a day of its source check. The owner can
   withdraw a release. An owner-signed release changes only its status and is never deleted; it leaves
   publication once, superseded or withdrawn, and is never published again without a new version and
   a new sign-off.
6. **What the checker admits.** An owner-signed rule counts only while its sign-off matches its
   manifest, the evidence checks still pass, the guidance policy's approval stands, its sources stay
   current (the daily check within 24 hours, and the source check within 30 days for any risk but
   `general`), and no source impact holds it. These are the reviewed route's conditions with the
   owner's sign-off in place of the two AI reviews.
7. **What it is not.** The owner's sign-off is the owner's editorial decision. It is not legal, tax or
   regulatory advice, and the checker keeps its labels: likely relevant, may apply, more information
   needed, not indicated by these answers. None of them says a business is exempt.

The reviewed route, `evaluatePublication` and decision 0014 stay as they are. The owner-signed
bundle's evaluator repeats the reviewed route's evidence checks, and a test runs the same altered
evidence through both so they cannot drift apart.

## Consequences

- A rule can reach customers without AI spend, on the owner's reading of the sources.
- Each released rule needs the owner's attention again whenever its sources change or its source check
  passes 30 days.
- NTAA and NAFDAC rules wait for their holds to be resolved; CAMA s.814 and NDPA s.27 come first.

## Implementation

Not built yet. Step 6 of the content and speed plan builds it.
