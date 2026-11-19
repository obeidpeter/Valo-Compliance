# 0014 — Publish reviewed pairs, and who runs the enhanced checks

Date: 2026-11-19. Status: **proposed**, waiting for the product owner's review. Nothing in it is
built.

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

## Decision (proposed)

### 1. Review the candidate before saving its version

The preparer would keep the candidate and its evidence as a private publication artifact instead of
a held row. The finite manifest would bind that artifact's hash where it now binds
`candidateVersionId`, and the readiness and work-binding checks would read the artifact.

A new operator command would publish a reviewed pair. It would read the approved run's result
artifact and check each review record against three things: the candidate artifact, the plan the
owner approved, and the provider responses the ledger settled for that batch. Then, in one
transaction, it would save the version with its reviews and pass it to the existing publisher, which
rechecks every gate. If any gate fails, it would record the hold instead.

This needs no migration and weakens no constraint. `held` stays final, and a published version
carries its reviews in its own immutable bundle, as TPL-07's does.

### 2. The two reviews run the enhanced checks

For an item that is not `general`, the factual and challenge review prompts would ask each reviewer
for a structured result for each enhanced check, with the passage it relied on. An enhanced check
would pass only when both blind reviews pass it. It would be recorded as an AI check, never as
legal, tax or regulatory review.

EDP-010's evaluation cases (misquoted citations, conflicting dates, omitted exceptions, wrong
jurisdiction) would then measure exactly these checks.

## How it will be checked

- Each refusal of the publish command, tested with synthetic records:
  - a review of another candidate;
  - a review whose provider response the approved batch did not settle;
  - a failing or incomplete review;
  - a changed candidate or evidence artifact;
  - a stale candidate.
- Its success path, tested only in a disposable database with synthetic reviews labelled as such,
  as the synthetic rule release is. Never against the development database.
- The finite manifest, decision packet and work-binding tests, rebuilt for the artifact binding.
  The managed callers test, run with the real binding checks.
- For the enhanced checks:
  - the review schema refuses a result without its passage;
  - the gate holds an item when either review fails a check;
  - a `general` item's reviews do not change.

## Consequences

- An unreviewed candidate no longer appears as a held row, so the staff Content area lists
  candidates from their artifacts until they are reviewed.
- Manifests prepared before the change would be refused. None is approved today.
- Review requests for non-`general` items grow, and their worst-case cost enters the allocation
  package the owner approves.
- TPL-07's one-step path could become a special case of the new command, or stay as it is.

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

## Decisions for the product owner

1. How reviewed pairs reach publication: review before saving (recommended), a reviewed copy at the
   same version, or reviews attached to the held row.
2. Who runs the enhanced checks: the two AI reviews (recommended), a content reviewer, or both.
3. Both choices change what the AI budget pays for. The publish command's success path on real
   content still needs an approved allocation.
