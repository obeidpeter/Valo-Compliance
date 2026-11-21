# Source-checker challenge checkpoint

This is an implementation/evaluation checkpoint, not a released ruleset or
acceptance of R1/R2. The original 80-case corpus and previous reports are retained
unchanged. Original raw corpus SHA-256:
`5e333b3f472263e16f767b3165e29c1b1e210fdbac922873d1ffc086027ae1a0`.

The versioned `source-checker-challenges-v1.json` records the coordinating
review supplied by the user, with statutory locators, dispositions and no
fabricated provider receipt. Its recorded preparation does not replace a formal
pipeline challenge receipt, or silently approve the proposed replacement oracle.

## Working changes

- **NDPA018:** domicile, residence and processor connections remain required
  facts. The precomputed no-Nigeria-connection conclusion cannot negate missing
  facts. Tests separately declare all negative connections, and exercise true,
  unknown, unanswered and not-applicable alternatives without changing the
  original fixture.
- **NTAA009:** an ordinary unincorporated partnership is not automatically
  excluded merely because it lacks CAMA incorporation. Section147's reference
  to associations is retained as an unresolved precise classification question;
  no company return is inferred.
- **NDPA009:** commercial reuse does not retain a solely-household exception.
  Section27(3) policy relevance is separate from a new section27(1) collection
  event. Reuse supplies no new collection date. A test with an explicitly
  declared new event has a different input/result hash.
- **NTAA012:** foreign formation is recorded as declared by the supplied legal
  form, not independently verified. Tax residence/classification stays
  unresolved. Contradictory Nigerian-incorporation answers need reconciliation.
- **NTAA013:** a narrow domestic-candidate negative is not a determination of
  nonresident return duties or final withholding treatment. A stipulated final
  tax-treatment conclusion is ignored as evidence for those questions.
- **NAFDAC009/013/016:** the candidate explicitly assesses national registration
  relevance, not local-manufacturer process eligibility. The original mixed
  proposition remains disputed; route/permit/registration requirements are not
  merged into a fictional nationwide exemption or a second application.
- **NAFDAC017:** the original supplied matching sample permit and fulfilled
  conditions are used, without asking them again. The negative is confined to
  that conditional activity and explicitly retains continuing conditions.
- **All twenty CAMA cases:** underlying naming/partner/court facts remain bound;
  these are naming-trigger results, not general registration exemptions. The
  section863 context, other duties and local coverage gaps remain visible.

## Executed evidence

Command: `pnpm --filter @workspace/api-server run test:valo-source-challenges`.
Actual run: **112 passed, zero failed**. This includes the 80 case-bound engine
controls plus harness/isolation and ten new clarification controls; it is not
112 legal acceptance scenarios.

The separate source-corpus runner executed **80**, with **72 authored-label
matches and eight disagreements**, zero unexecuted and a deliberate nonzero
exit. See `evidence/source-checker-80-challenged-evaluation-v1.json`. Original
expected outcomes are unchanged; source-binding hashes identify the new exact
algorithm and retained evidence, not a blanket new retrieval/currentness claim.
The report distinguishes independent preparation from a formal provider receipt.
The runner now binds the explicitly retained versioned control log without
overwriting the older canonical control receipt.

No customer assessment, released manifest, reminder, statutory deadline,
published rule or model call was created. All four customer labels and unknown
states remain supported in isolated candidate validation. The live customer
checker still requires genuinely eligible released evidence.

Workspace typecheck passed. R1/R2 remain incomplete and unaccepted; R2 target
metadata does not implement invitations/roles, NGO journeys, provider workflows,
clause assistance, expanded eligible content, scanned attachments or commercial
experiments. These remain in the assignment after prerequisite gates. R3 stays
excluded.

The $30 inference allocation remains disabled and unchanged. Necessary context
must not be truncated to meet the proposed bounds. A separate AI technical
security/privacy assessment can provide independent evidence; coding agents
cannot approve their own security work. No external human hiring prerequisite
has been added, and owner-controlled privacy/production decisions remain held.
