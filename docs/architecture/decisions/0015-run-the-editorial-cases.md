# 0015 — Run the 60 editorial evaluation cases (EDP-010)

Date: 2026-11-20. Status: **proposed**, waiting for the product owner's review. The score, the
template cases and the false-publication flag in points 1 and 2 are built; nothing else in it is.

## Context

EDP-010 asks for 60 editorial cases, kept apart from the 60 customer AI cases and the 80 rule
scenarios. Their expected publish or hold outcomes must rest on source excerpts or deterministic
failure conditions. The requirement is met with zero critical false publications and at least 95%
overall, and it claims no legal-accuracy percentage.

The cases are in `docs/evaluation-candidates/editorial.json`, which is frozen; a test pins its hash.
- Each case has an expected decision and critical failure conditions.
- All 60 are marked for an independent reviewer to confirm the expected outcome before formal use.
- None carries source text. The corpus binds the real candidate, source passages, rights, reviews
  and exports when a case runs.

`scripts/editorial-source-suite.ts` runs the cases against the development database. Its last
retained run, on 14 November, passed 14 of the 26 deterministic controls, failed none, blocked 46
cases and made no provider call. Since then, the reviewer-role denial that C052 needs has been
built.

### What each case still needs

| Cases | Kind | Needs |
| --- | --- | --- |
| C001–C003 | AI review | The review pairs of TPL-07, TPL-06 and TPL-24 (decision 0014), under an approved AI budget |
| C042, C046–C050, C055–C059 | Deterministic | An isolated copy of a genuinely eligible or published version: the first template published with real reviews |
| C004, C018–C020 | AI review | Candidates built for each case on the retained CAMA section 814 passages, and their reviews |
| C006, C022–C025 (NAFDAC); C008, C028, C029 (tax); C007, C026, C027 (privacy) | AI review | The official texts retrieved and retained first: the repository keeps only their addresses, hashes and page locations |
| C005, C011, C013, C015, C017, C021, C030–C036, C040, C041, C060 | AI review | A change to a retained candidate built for each case, and its reviews; C005 and C021 also need source text the repository does not hold |
| The other 15 deterministic cases | Deterministic | Nothing new: 14 passed, and C052 can run again |

## Decision (proposed)

1. **Score every run against the bar** (built). `scoreEditorialEvaluation` counts a blocked,
   unselected or unrun case as not passed. A run meets the bar only when at least 57 cases pass and
   none is a critical false publication. The suite now marks an adverse change that the gate still
   finds eligible as a critical false publication. The score never accepts EDP-010.
2. **The template cases read their template's review pair** (built). C001–C003 read the outcome of
   that pair. A published version passes when the gate, run again at its publication time, still
   finds it eligible; otherwise it is a critical false publication. A held version waits for an
   evaluator: each case asks that an item hold only for a real unmet gate, which the recorded
   reasons alone cannot show.
3. **The lifecycle cases use the first genuine publication.** When a template publishes with real
   reviews, an isolated copy of that database becomes the seed the suite already expects
   (`VALO_EDITORIAL_LIFECYCLE_DATABASE_URL`). C042 reads the same version's passing reviews.
4. **The other AI review cases get requests built for each case.** A preparer would build the
   changed candidate a case describes from retained text. The two reviews would then run on it in
   the finite batch's editorial-evaluation lane. C041, a review that fails at the provider, can use
   controlled-failure evidence, which the corpus allows. Not built: it needs the choices below.
5. **An independent reviewer confirms each expected outcome before it counts**, as the corpus
   requires. An AI review is not that reviewer.

## Decisions for the product owner

1. Who checks the 60 expected outcomes before they count.
2. Whether to retrieve and retain the NAFDAC, tax and privacy texts, which 11 cases need. Leaving
   them out keeps the score below the bar.
3. The AI budget. The 31 case-bound AI review cases are 62 review attempts:
   - US$22.97 at the conservative worst-case reservation of US$0.3705504 per attempt;
   - beside US$12.60 for the 17 template review pairs;
   - together more than the US$30 allocation.

   Real charges are expected to be lower, but none has been measured. The work can be approved in
   two packages, one after the other.

## Consequences

- The suite's report now carries the score. On the retained 14 November results it is 14 of 60,
  with no critical false publication: far from the bar.
- EDP-010 stays unaccepted (known issue KI-005) until the cases run and the owner reviews them.
