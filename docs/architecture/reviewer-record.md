# The reviewer's record

The finishing plan's Phase 3 row "The reviewer's record", which builds
[decision 0016](decisions/0016-record-independent-review.md) for EDP-010, RUL-008 and AI-008. Each of the
three acceptance suites rests on cases an independent reviewer must judge before a case counts, and each
requirement's evidence asks for the "reviewer and environment". Today nothing records a reviewer's answer,
so no case can count however the suites run.

The requirements, verbatim from the specification:
- EDP-010: "Maintain 60 editorial cases separate from 60 customer AI cases and 80 rule scenarios. Include
  fake/misquoted citations, conflicting dates, missing text, omitted exceptions, wrong jurisdiction, unsafe
  clauses, injection and stale sources. Expected publish/hold outcomes need source excerpts or
  deterministic failure conditions. Accept: zero critical false publications and at least 95% overall; no
  claim of a legal-accuracy percentage."
- RUL-008: "Maintain at least 80 source-backed scenarios across six sectors, three checked locations,
  other-state gaps, unknowns and effective-date boundaries. Use a separate AI validation run to challenge
  expected results. Accept: all critical results and exclusions pass; unresolved interpretations remain
  held."
- AI-008: "Maintain 60 source/rubric-backed cases across the four tasks, missing inputs and adversarial
  text. Accept: at least 95% meet the rubric, every financial calculation is correct and no critical leak
  or invented legal claim remains. Keep this separate from the editorial suite in EDP-010; neither measures
  certified legal accuracy."

## What there is today

**Three corpora, all frozen.** Each case's hash is the SHA-256 of its row as key-sorted JSON, the same
`digest` the suites and the disabled allocation package use.
- **Editorial cases** (`docs/evaluation-candidates/editorial.json`): 60 cases, named by `id`, each
  `needsReview: true`, each with an expected outcome, critical failure conditions and the requirements it
  rests on. The suite (`editorial-source-suite.ts`) marks held template cases, case-bound pairs with both
  their reviews, and C041 `needs_evaluator_decision`. Its score counts the passes it can work out alone,
  and 57 are needed.
- **Rule scenarios** (`checker.json`): 80 cases, named by `caseID`, each `needs_independent_review`, each
  with an expected outcome, reason checks and critical failure conditions. The live check in CI matches
  71 and differs on 9; one of the 9, NDPA-009, is the check's own. The separate AI challenge stores each
  answer as `accepted: false`.
- **Customer AI cases** (`customer-ai.json`): 60 cases, named by `caseID`, each with its expected checks
  and critical failure conditions, kept "for independent assessment". One case has a coded rubric, and the
  suite never passes provider quality.

The run reports leave `reviewerDecision` and `evaluatorDecision` empty.

**Five staff roles:** content, support, finance, system and privacy. A system administrator grants and
revokes them, never their own, and each change is audited. One identity may hold several.

**Why a database record.** AGENTS.md forbids inferring acceptance from an AI model's verdict. The
repository is public, and anyone with write access can commit anything, so a file in it cannot show
that a person decided. A row written only by a signed-in reviewer with recent MFA can.

## What changes

### 1. The reviewer role

- The role is `reviewer`. A system administrator grants and revokes it like the other roles, never their
  own, and the role audit records each change.
- With recent MFA, the role opens the acceptance cases page and records decisions. It can do nothing else.
- No identity holds it at the same time as the content role, so no one who prepares content confirms its
  cases. The role change refuses such a grant, and the database refuses one written any other way.

### 2. The record

- Each decision is one row of `valo_acceptance_reviews`:
  - the corpus, the case's id and hash;
  - the kind of judgment;
  - for a run outcome, the run's id and the hash of the results it read;
  - the answer: confirmed or rejected for an expected outcome, met or not met for a run;
  - why, the reviewer's staff identity and the time.
- The database takes a row only from an active reviewer, dates it itself, and never changes or removes
  one.
- A later decision supersedes an earlier one by adding a row. A decision holds only for the hash it names,
  so a case whose row changes needs a new decision.

### 3. The acceptance cases page

- For each corpus, the page lists the cases with the expected outcome, the critical failure conditions,
  the sources and the latest decision on the case's current hash.
- A confirmation says what it claims: "This confirms that the case's expected outcome follows from its
  cited sources. It is not legal, tax or regulatory advice unless the reviewer is engaged to give that."
- For a run, the page shows what the run kept: the reviews, the engine's reasons, or the customer answer.

### 4. The suites read the record

- A case counts only when two things hold:
  - its expected outcome is confirmed for the case hash the suite ran;
  - where the suite cannot score the run itself, the run is recorded as met for that exact run.
- A rejected expected outcome takes the case out of the score. The frozen corpora are never edited: a
  corrected case is a new corpus version under its own decision.
- Each report names the review rows it used, by id and hash. The scores still accept nothing: accepting a
  requirement stays the owner's decision, and a reviewer's confirmations are evidence for it.

## Decision 0016's points, under the owner's delegation

The owner approved the finishing plan with "Implement all (make the best decisions for me)". This row
takes decision 0016's proposal as written, and its points as follows:
1. **The reviewer** is the owner's to name and grant. No name enters the repository.
2. **Separation of roles:** the reviewer role excludes the content role, as proposed, for as long as both
   would be held. An emergency content grant is refused too: the reviewer role is revoked first.
3. **Corrections:** a reviewer confirms or rejects, always with why. A corrected expected outcome becomes a
   new corpus version under its own decision.
4. **How many reviewers:** one role covers the three corpora. Every decision names the reviewer who made
   it, and the owner may grant the role to more than one person.
5. **What a confirmation claims:** the proposal's wording, above. It is the owner's to confirm.

## What does not change

- The frozen corpora and their hashes.
- What each suite checks by itself, and that no score accepts a requirement.
- The other staff roles, and who may grant a role.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The role and the record of expected outcomes.** A migration adds the `reviewer` role, refuses it alongside the content role, and adds `valo_acceptance_reviews` with its guard, its upgrade test and its runbook. The role change refuses the pair. The acceptance cases page lists the three corpora with each case's expected outcome and latest decision, and records a confirmation or a rejection with why, bound to the case's hash. Tests: only an active reviewer records, a decision holds only for its hash, the record never changes, the roles exclude each other, the words, and a browser check. | EDP-010, RUL-008, AI-008 |
| 2 | **Run outcomes.** The page lists what each suite's latest run left for a reviewer: the editorial cases marked `needs_evaluator_decision`, the scenarios the live check disagrees on, and the customer answers. A decision is bound to the run's id and the hash of its results. Tests of each. | EDP-010, RUL-008, AI-008 |
| 3 | **The suites read the record.** Each suite counts a case only as point 4 says, and its report names the rows it used. A command exports the record a report used. Tests: a case without a confirmation does not count, a rejected one is out of the score, and a decision on another hash or run is not used. | EDP-010, RUL-008, AI-008 |

## The owner's points

1. **Name the reviewer** and grant the role (decision 0016, point 1). Until then no case can count.
2. **Confirm what a confirmation claims** (point 5), and the page's words.
3. **Points 2 to 4** take the proposal's answers. The owner can change any of them.
