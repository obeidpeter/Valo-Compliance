# 0014 — Publish reviewed pairs, and who runs the enhanced checks

Date: 2026-11-19. Status: **accepted** on 2026-11-19. The product owner chose both recommendations
("Go with your recommendations on 0014"). The decision below describes what was built.

## Context

### Reviewed pairs have no path to publication

Seventeen original operational templates have candidate preparers. Only TPL-07 can reach
publication: its one-step path (`prepareInventoryRelease`) runs the two AI reviews before it saves
the version, then hands the version to the publisher. For the other sixteen the steps are:

1. `prepareOperationalCandidateRelease` saves the candidate as a content version whose bundle has
   no reviews, then records a hold (`FINITE_REVIEW_NOT_RUN`). The row is now `held`.
2. `finite-inference-run.ts --prepare` builds the finite manifest for that row
   (`candidateVersionId`). The owner approves the allocation package that contains it.
3. `finite-inference-run.ts --execute` reruns the readiness check, which accepts held rows. It runs
   the factual and challenge reviews inside the approved pair, saves each review record as a private
   publication artifact, and prints a report with `publicationAccepted: false`.

Nothing takes the next step, and with the current schema nothing can:

- The publisher (`validateOperationalVersionInTransaction`) reads the reviews from the version row's
  own `bundle.reviews` and `attestations.reviews`. It accepts only `candidate` or `published` rows.
- The database makes `bundle` and `attestations` immutable. It allows only these transitions:
  `candidate` to `published` or `held`, and `published` to `withdrawn`. So `held` is final, and the
  reviewed row's empty reviews can never be filled in (migration 0007).
- `(template_id, version)` is unique, and each review is bound to the candidate's hash, which
  includes its version number. A new row at the next version is a different candidate, and the
  reviews do not apply to it.

### The enhanced checks have no one to run them

EDP-005 asks that tax, employment, privacy, governance, contracts and regulated-sector content be
checked for controlling text, amendments, effective dates, exceptions and jurisdiction. The
publication gate (`evaluatePublication`) requires one passing check of each name, bound to the
candidate, for every item that is not `general`. Nothing produces them, so every such item stays
held.

Every operational template is prepared as `general`, so today the gate affects guidance and any
future template of a higher risk class. Guidance is already held for six other reasons
(`mandatoryDevelopmentHolds`).

The gate already checks part of the evidence itself, from the bundle's sources:
- each source is approved, with its operative text confirmed and its amendments resolved;
- its jurisdiction matches the candidate's;
- its effective dates cover the check time.

A "pass" written by code for those would repeat the gate's own checks. For exceptions and
controlling text, it would claim a judgment that no one made.

## Decision

### 1. Review the candidate before saving its version

The preparer (`prepareOperationalCandidateRelease`) keeps a candidate that passes its rights,
mechanical and export checks as a private, hash-bound publication artifact
(`valo-prepared-candidate-v1`, in `modules/publication/prepared-candidate.ts`). The artifact holds
the bundle with no reviews, the attestations of its evidence, and the version ID and number it will
be saved under. A candidate that fails a check is still saved and held, as before.

The finite manifest keeps `candidateVersionId` and adds `candidateArtifact`: the artifact's ID,
hash and template. The work-shape check requires it for publication work and refuses it on every
other lane. Package membership reads the template from it. The readiness check
(`readOperationalInferenceReadiness`) and the work-binding check read the artifact. They refuse it
when its version ID, or its template and version number, are already saved, so a saved version ends
the candidate's review.

`publish-reviewed-pair.ts` (`publishReviewedOperationalCandidate`, in `modules/ai-lanes`) reads the
batch and the review records the finite run saved, and checks each record against:
- the batch's settled ledger entry for its work, and the provider response the batch recorded;
- the candidate, its plan and request, and its server evidence;
- an independent second review in the other role.

It saves the version with its reviews under the drafter role. It then hands the version to the
existing publisher, which rechecks every gate. If a gate fails, it records the hold instead.

This is two transactions, not one, as in TPL-07's one-step path: the drafter role saves and the
publisher role publishes. A rerun after a stop finishes a saved candidate's publication, or reports
its saved status. No migration was needed and no constraint was weakened. `held` stays final, and a
published version carries its reviews in its own immutable bundle.

### 2. The two reviews run the enhanced checks

For an item that is not `general`, both review requests:
- use their own strict schema (`operational_enhanced_review`, prompt `operational-<role>-enhanced-1`);
- carry the bundle's sources;
- ask for one result for each enhanced check, with the passage the reviewer relied on.

`enhancedChecksFromReviews` passes a check only when both blind reviews pass it, each with one
result whose passage (at most 2,000 characters) occurs word for word in the candidate or one of its
sources. The publisher derives the checks again from the attested reviews and refuses a bundle whose
checks differ. Each is recorded as an AI check, never as legal, tax or regulatory review.

A `general` item's review requests are unchanged: a test pins their digest from before this change.

EDP-010's evaluation cases (misquoted citations, conflicting dates, omitted exceptions, wrong
jurisdiction) can then measure exactly these checks.

## How it is checked

- The publish command, in the managed callers database test, with the real preparer, plan,
  dispatcher, binding checks and publisher, a zero-network SDK and a disposable schema. Each
  refusal is tested:
  - a review of another candidate;
  - a review whose provider response the batch did not settle, or whose ledger entry is not
    settled;
  - a changed review: other server evidence, or another plan;
  - an incomplete pair, or one review twice;
  - a missing batch;
  - a stale candidate;
  - another candidate saved under the same version number.
- In the same test: a failing pair is saved with its reviews and held, and stays held on a rerun.
  Two passing synthetic reviews, labelled as controlled fixtures, publish the version through the
  real publisher. This runs only in the disposable schema; the test checks that no shared row
  changes.
- The preparation test: a passing candidate is not saved, and readiness refuses a changed or stale
  artifact and a saved version.
- The finite manifest, decision packet, work-shape and package tests, rebuilt for the artifact
  binding. The managed callers and batch dispatch database tests run with it.
- For the enhanced checks (`operational-enhanced-review.test.ts`):
  - the enhanced schema refuses a result without its passage;
  - a check fails when either review fails, omits or repeats it, or quotes a passage found nowhere;
  - the gate holds an item when either review fails a check;
  - a `general` item's review requests do not change.

## Consequences

- An unreviewed candidate no longer appears as a held row. The staff Content area lists saved
  versions only, so the preparation command's report names each prepared candidate until its reviews
  are checked (known issue KI-010).
- Candidates prepared for the same template take the same version number. The first one saved ends
  the others' reviews; prepare again for a later version.
- Manifests prepared before the change are refused (`PUBLICATION_CANDIDATE_REQUIRED`). None was
  approved.
- Review requests for non-`general` items grow with their sources, and their worst-case cost enters
  the allocation package the owner approves.
- No preparer yet produces non-`general` content. The operational lane prepares only `general`
  original templates, and the guidance pipeline builds no publication bundle. So no enhanced check
  has run on real content. Guidance stays held for its six standing reasons.
- TPL-07's one-step path stays as it is.
- The publish command's success path on real content still needs an owner-approved allocation
  (KI-003).

## Alternatives considered

**A reviewed copy at the same version.** The unique index would exclude held rows, so the command
could insert a second row for the same candidate with its reviews and publish that one. The code is
small, but the migration weakens a uniqueness constraint, and one version number would then name two
rows. Every reader that assumes one row per version would need checking:
- the catalogue;
- saved templates;
- entitlements;
- documents' `template_version_id`;
- source impacts.

**Attach reviews to the held row.** An append-only table would hold reviews of a version, and the
trigger would allow `held` to `published` once two passing reviews are attached. One row per
version remains, but `held` stops being final, and a version's evidence is split between its
immutable bundle and another table. The publisher, the publication record screen (ADM-002) and the
audits all read that evidence.

**A content reviewer runs the enhanced checks.** A staff action, needing the content role and fresh
MFA, would record each check with a note, bound to the candidate and audited. It needs a person able
to judge controlling text and exceptions, and the platform does not create one. It could be added on
top of the reviews' checks, as a confirmation.

## Owner decision

On 2026-11-19 the product owner chose:
- review before saving;
- the two AI reviews run the enhanced checks.

Both change what the AI budget pays for. Spending still needs its own approval.
