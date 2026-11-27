# 0016 — Record the independent reviewer's decisions on the acceptance cases

Date: 2026-11-20. Status: **proposed**; on 25 November 2026 it was taken under the owner's delegation
(finishing plan, delegated decision 6) and is being built: see [the reviewer's record](../reviewer-record.md).
The reviewer is still the owner's to name.

Two facts below have moved since this was written: the live check now matches 71 of the 80 rule
scenarios and differs on 9, one of them NDPA-009, the check's own; and of the three suites only the
editorial suite marks a case `needs_evaluator_decision`.

## Context

Three acceptance suites rest on case corpora whose expected outcomes need an independent reviewer
before a case counts:

| Requirement | Cases | What the corpus asks |
| --- | --- | --- |
| EDP-010 | 60 editorial cases (`docs/evaluation-candidates/editorial.json`) | Each is `needsReview: true`; decision 0015, point 5, requires an independent reviewer to confirm each expected outcome |
| RUL-008 | 80 rule scenarios (`checker.json`) | Each is `needs_independent_review`; the last run matched 72, and the other 8 disagree with their labels in ways the sources support |
| AI-008 | 60 customer AI cases (`customer-ai.json`) | Outputs are kept "for independent assessment" |

The reviewer makes two kinds of judgment:

1. **The expected outcome.** Does a case's expected outcome, with its critical failure conditions,
   follow from its sources? The corpora are frozen and their hashes are pinned, so this judgment
   is bound to the case's hash.
2. **The run outcome.** Some runs cannot be scored mechanically, for example:
   - a held editorial case, where someone must decide whether its reviews found the case's defect;
   - a rule scenario whose engine result disagrees with its label;
   - the quality of a customer case's answer.

   Each such judgment is bound to the run: its batch id and the hash of the results it read.

Today the suites mark these cases `needs_evaluator_decision` and accept nothing, but nothing
records a reviewer's answer. So even once a reviewer is named, no case can count.

AGENTS.md says acceptance must never be inferred from an AI model's verdict. The repository is
public, and an agent with write access to it can commit anything, the agent writing this
included. So a file in the repository cannot show that a person made a decision.

## Proposal

1. **A reviewer role in the staff authority.**
   - The owner grants and revokes it like the other staff roles, and the existing role audit
     records each change.
   - With fresh MFA, as the publication record requires, the role opens the review queue and
     records decisions. It can do nothing else.
   - It cannot be held with the content role, so no one who prepares content confirms its cases.
2. **An append-only review record in the database.** Each decision is one row, holding:
   - the corpus, case id and case hash;
   - the kind of judgment;
   - for a run outcome, the run's batch id and results hash;
   - the answer: confirmed or rejected for an expected outcome, met or not met for a run;
   - a reason, the reviewer's staff identity and the time.

   A later decision supersedes an earlier one by adding a row, never by editing it. The rows are
   staff data, so customer requests get no access to them.
3. **A review queue in the staff area.** It is built from the three corpora and the suites' latest
   results. For each case awaiting a decision it shows:
   - the case's expected outcome, critical failure conditions and sources;
   - for a run, what the run kept: the reviews, the engine's reasons or the customer answer.
4. **The suites read the record.** A case counts only when two things hold:
   - its expected outcome is confirmed for the case hash the suite ran;
   - where the suite cannot score the run itself, the run is recorded as met for that exact run.

   A rejected expected outcome takes the case out of the score. The frozen corpora are never edited;
   a corrected case is a new corpus version under its own decision. The scores still accept nothing.
5. **Evidence.**
   - Each suite report names the review rows it used, by id and hash, and the record is exported
     with the report, so a reader can see which cases a reviewer confirmed.
   - The repository holds the reviewer's opaque staff identity, never their name or email.
   - Accepting a requirement remains the owner's decision. The reviewer's confirmations are evidence
     for it, not acceptance.

**Cost:**
- one migration: the table, and grants for the staff path only;
- the role, the queue screen and changes to the three suites;
- no AI spend.

The reviewer must sign in, so recording decisions needs the development or a deployed environment.

## Alternatives considered

- **A file in the repository that the reviewer commits.** This is simpler, but a commit cannot show
  that a person decided rather than an agent with write access. It would also publish the
  reviewer's account. Rejected.
- **The content staff or the owner reviewing.** The corpora ask for independence. The owner
  approved the corpora and the AI spend, and content staff prepare the candidates under test.
  Possible only if the owner decides independence can be waived for a suite (owner decision 4).

## Decisions for the product owner

1. **The reviewer.** A named person, independent of content preparation; an AI review cannot be
   the reviewer. Their name stays out of the repository.
2. **Separation of roles.** Should the reviewer role exclude the content role, as proposed?
3. **Corrections.** May a reviewer propose a corrected expected outcome with a rejection, or only
   confirm or reject? Either way, a correction becomes a new corpus version under its own
   decision.
4. **How many reviewers.** Does one reviewer cover all three suites, or does each need its own, for
   example someone who knows the tax and regulatory rules for the 80 rule scenarios?
5. **What a confirmation claims.** It confirms that a case's expected outcome follows from its cited
   sources. It is not legal, tax or regulatory advice unless the reviewer is engaged to give that.
   Confirm this wording, or name the claim the confirmations should carry.
