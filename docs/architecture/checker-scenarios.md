# The 80 scenarios through the live check

The finishing plan's Phase 2 row "The 80 scenarios through the live check" (RUL-008). RUL-008 asks
for "at least 80 source-backed scenarios across six sectors, three checked locations, other-state
gaps, unknowns and effective-date boundaries", and "a separate AI validation run to challenge
expected results". It is accepted when "all critical results and exclusions pass; unresolved
interpretations remain held".

## What there is today

**The corpus.** `docs/evaluation-candidates/checker.json` holds 80 scenarios, 20 for each of the
four research notes the prepared rules come from:
- the business-name rule, from section 814 of the Companies and Allied Matters Act;
- the collection-information rule, from section 27 of the Nigeria Data Protection Act;
- the company-return rule, from section 11 of the Nigeria Tax Administration Act;
- the product-registration rule, from the NAFDAC Act (Cap F33).

They cover six sectors and eight states: Lagos (21), the FCT (21), Bayelsa (19) and five others. 17
cases name a state no rule covers locally, and 15 have an unknown or unanswered answer. Six must
stay held, among them four dates other than the corpus's own. Each case gives its facts in its research
note's words, its expected result and the failures that matter most. The corpus is frozen: its
checksum is pinned.

**The runner of 14 November** (`src/scripts/source-checker-evaluation.ts`) puts each case to its
research note's own calculation, in the note's words.
- Its last run gave the expected result for 72 of the 80. For the other 8,
  `docs/valo/source-checker-oracle-v2-proposed.md` proposes other results from the sources. None is
  accepted.
- It is not in CI, and its source bindings run out around 14 December 2026. In CI, a test runs the
  20 business-name cases through their research note alone, and others test a few cases of the other
  notes.
- None of them runs the requirements check.

**The requirements check** runs the four rules once the owner signs them (decision 0020). Each rule
has its own critical scenarios, 52 in all, which its release plan runs before it can be released.
The 80 are not among them.

**The separate AI run** that would challenge the expected results has a lane of 80 attempts, which is
switched off. Nothing prepares its requests. Its binding check reads a saved content version, which
an owner-signed rule is not.

## What changes

### 1. The 80 through the live check

**Each case is put to the check as a business would answer it.** A mapping turns the case's facts
into the check's own answers:
- the sector becomes the specification's industry, and the state the check's. The local government
  is unknown in all 80 cases;
- a fact the check asks in its own words is given in them. The business-name note's "section 814
  exception: none" is the check's two naming questions answered "no". A receiver or manager is said
  by who carries on the business and their appointment. "Not registered" is the check's "none";
- a value none of the check's choices names is its "Other";
- a fact the check has no question for is left out, and listed. There are 52 such facts in 35 cases:
  a product's description, turnover figures, a previous result kept for its history, or a jurisdiction
  worked out in advance;
- one answer is implied, not stated: who carries on the business. Fifteen business-name cases name
  no receiver or manager, so the individual, firm or company they describe carries it on
  ("proprietor"). Each case's report lists it.

**The four rules are prepared as the owner's sign-off would release them**, from copies of their
official texts that hold their passages, as the sign-off's own test prepares them. They are released
together, as the check would hold them.

**Each case meets the check as the live check would meet it.** Most do so on their own date. A case
that tests a hold meets it like this:
- a date before the rule's text took effect (three cases);
- the rule's review run out, an hour after its review date (one);
- a future date, which the check refuses (one);
- only a proposed rule, so no released rule answers the case: its manifest is not trusted (one).

**What is checked for every case**, on its result:
- the same result twice;
- national only: the rule is national, and the result says state and local coverage is not
  comprehensive;
- no deadline, and no reminder;
- no certification of compliance or exemption;
- unknown answers never an exemption;
- a case that tests a hold gives no result from its rule, and no other case is held;
- a result held for source review offers no task.

**What is compared:**
- the check's result with the corpus's expected one;
- the check's result with the research note's own, on the case's own words. They agree when the
  mapping kept what the note decides.

### 2. The challenge's preparer, its route to a run, and a run against the signed rules

- **A request for each case**, for a separate AI run. It gives the case's facts as mapped, the rule's
  passages with their checksums, the corpus's expected result and the check's result. It asks whether
  the passages support the expected result, and for the words that do. Each request is bound to the
  corpus's checksum, the rule version's manifest and its sources' checksums.
- **The binding check** rebuilds the requests from the released rule version, and refuses any that
  changed. Today it reads only saved content versions.
- **Its route to a run**, as the editorial cases have: a package that names this preparer, the
  owner's approval of that package, then admission and execution, each checking the bindings again.
  A test runs it with a stand-in provider.
- **Running it needs the owner's AI spend approval.** The lane's 80 attempts stay off until then.
- **A command that runs the 80 against the rules the owner has signed** in development, read from
  the released registry, and gives the same report. It writes nothing.

## What does not change

- The corpus and its expected results. A proposed correction stays a proposal until it is accepted.
- The research notes' calculations and the runner of 14 November.
- The rules and the check's calculation. A difference the run finds in the check is reported, not
  fixed here. Fixing it changes what a released calculation gives, so it needs a new version of the
  calculation and new rule versions, which the owner signs.

## Settled while building it

**Slice 1: the 80 through the live check.**
- **The run, on 25 November 2026:**
  - every case kept every condition;
  - 71 of the 80 give the expected result. The six that test a hold are held: five give no result
    from their rule, and the check refuses the future date. Five results stay held for source review,
    with no task offered;
  - 9 do not give the expected result. Eight are the research notes' own results, which the check
    repeats: the same eight as the run of 14 November, each with the sources' reasons in the oracle
    v2 proposal. One is the check's own, below;
  - on every other case not held, the check gives its research note's own result. So the mapping
    changed no note's answer.
- **The check's own difference: CHK-CAND-NDPA-009**, a household contact list reused for a salon's
  promotions. The business claims the personal or household exception. The check's answer "personal
  or household" cannot say "claimed" apart from "confirmed", and its calculation reads the answer as
  confirmed. So, with commercial use stated, it asks whether privacy rights were violated (More
  information needed). The research note and the corpus say commercial reuse ends the exception
  (Likely relevant). The check gives the weaker result, not an exemption.
- **The record of differences** (`corpusDifferences` in `modules/rules/checker-corpus.ts`) names
  each of the nine, the result the check gives, whose result it is and why. The test fails when any
  case's result moves away from the record, or comes back to the expected one. So a change is seen,
  and the record is updated with it. Nothing in the record accepts a result.
- **The mapping is the check's.** Every fact a case gives is answered, put in the check's words or
  listed as not asked, and the test checks each one. A value the check words differently is taken as
  the business's assertion, as the check takes every answer; the questions that would confirm it are
  answered on their own.
- **The run's report** is kept by CI (`checker-corpus-live-run`). For each case it gives the check's
  result, the research note's, the corpus's expected one, the checks, and how the case's facts were
  put. It records no acceptance, and no person or model reviewed it.
- **The test needs no binding that runs out.** The rules' copies are dated from the amendment
  records' latest search, and the research notes are bound to the prepared rules' own sources, as the
  check binds them.
- **RUL-008 is not accepted.** "All critical results and exclusions pass" is not met while nine
  differ, and the AI challenge has not run.

**Slice 2a: the challenge's preparer.**
- **One request for each case of a released rule**, for the challenge lane: the case's answers as
  the check takes them, the facts it does not ask and the one it assumes, the rule's passages with
  their checksums and the words it quotes, the corpus's expected result and the check's own. The
  model is asked whether the passages support the expected result; if not, which result they
  support, with the words that decide it, and what they leave unresolved. It is told to rely on
  nothing but the passages, to treat the case as data, and that its answer is an AI check that
  accepts nothing. The request never says a person has reviewed anything.
- **The answer has a strict schema:** a yes or no, the result the passages support (one of the
  check's four, or "Held"), the deciding words with their sources, the reasoning and what stays
  unresolved, and nothing else.
- **A manifest for each rule's 20 cases**, prepared from the rule's released, owner-signed version.
  It is refused for a version not published, one whose rule and bundle do not match, and one whose
  review has run out, since the check's own result would then only ever be held.
- **Each work is bound** to the corpus file's and the case's checksums, the release row, the
  release's sources and the moment it was prepared. The binding check reads the release the work
  names, requires it still published and its review not run out, rebuilds the work at that moment and
  refuses any difference. Until now this lane could read only a saved content version, which an
  owner-signed rule is not.
- **Every request fits the lane's bound** of 32,000, measured as review requests are.
- **What it does not do:** it sends nothing to a model and reserves no budget, and no package lets
  this lane's work be admitted yet (slice 2b).

**Slice 2b: the route to a run.**
- **A package of its own.** A finite allocation package can name the checker-challenge preparer. It
  admits the challenges of the frozen scenarios and nothing else, and no other package admits them.
  Its holds say each answer challenges a scenario's expected result, accepts nothing and is not
  professional review. The owner's approval command prepares one with `--checker-challenges`;
  approving it is the owner's decision to spend.
- **Prepared, admitted and run as the editorial cases are.** The runner prepares one released rule's
  challenges with `--prepare-checker-challenge <rule id>` into a private report, and admission reads
  it unchanged. Its `--execute` rebuilds the admitted manifest from the release at its own moment,
  checks every binding again, and runs each challenge as its own approved work.
- **Each answer is kept as it came.** A completed answer is kept in its strict schema, and a failed
  or invalid one as a failure, each as a private record that accepts nothing. A work already run is
  not sent again: while its answer is fresh, the dispatcher hands back the one it kept, and the record
  says nothing went out. Once its release is withdrawn, nothing is sent and nothing kept is handed back.
- **The 80 against the signed rules.** `pnpm --filter @workspace/api-server valo:checker-corpus` runs
  the corpus against the rule versions a database releases, as the check admits them, and prints
  which give the expected result, which do not beside the record of differences, and which rules
  have no released version. It reads only.
- **Still the owner's:** running the challenge needs the owner's approval of a checker-challenge
  package, which spends on the provider. Once it has run, a person decides on each answer (decision
  0016); no answer changes the corpus or accepts RUL-008.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The 80 through the live check:** the mapping, the run with its checks, the record of differences, and the report, in CI. | RUL-008 |
| 2a | **The challenge's preparer** and its binding check. | RUL-008 |
| 2b | **The challenge's route to a run:** its package, the owner's approval of it, its admission and its execution, tested with a stand-in provider, and the command that runs the 80 against the rules the owner has signed. Running the challenge needs AI spend. | RUL-008 |

## The owner's points

1. **CHK-CAND-NDPA-009.** The check reads a claimed household exception as confirmed. A fix is a new
   version of the privacy calculation that tells a claim apart, and new versions of its rule, which
   the owner would sign.
2. **The eight research-note differences.** The oracle v2 proposals wait on a review of the expected
   results: the independent reviewer's record (decision 0016), or the owner.
3. **The AI challenge** needs the owner's approval to spend on it.
4. **The corpus's reach.** Its 80 scenarios cover four narrow rules. Rules added later need scenarios
   of their own, which this run would take in the same way.
