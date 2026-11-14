# Source-backed rule evaluation readiness

Prepared 14 November 2026 against original master/TRD v1.1 and repository head `3409a4f0e7e38b864b6b3f3240608761569ac462`. This is corpus review and implementation input, not test execution, independent release approval or RUL-008 acceptance.

## What is ready and what is not

`analysis/checker-evaluation-candidates.json` contains 80 distinct authored cases, 20 each for CAMA 814, NDPA 27, NTAA 11 and NAFDAC Cap F33. Every case remains `needs_independent_review` and `unexecuted`. No expected outcome was converted into a pass. All four source candidates remain unreleased.

| Structural dimension | Actual authored data |
|---|---|
| Unique stable IDs / unique fact-date-source tuples | 80 / 80 |
| Outcomes | 32 Likely relevant; 20 Not indicated by these answers; 20 More information needed; 8 May apply |
| Priority sectors | Retail/wholesale 13; technology/software 13; beauty/personal care 13; professional services 13; restaurants/hospitality 12; packaged foods 16 |
| Geographic contexts | Lagos 21; FCT 21; Bayelsa 19; Rivers 4; Kaduna 3; Oyo 4; Kano 3; Enugu 3; unknown 1; outside-Nigeria/N/A 1 |
| Assessment dates | 76 at 13 November 2026; one each at 31 December 2019, 31 December 2022, 31 December 2025 and 1 January 2030 |
| Executed / accepted | 0 / 0 for this authored artifact |
| Local rule evidence | No state/FCT/LGA rule pack supplied; every case expressly preserves that coverage gap |

The repository's separate `docs/valo/evidence/rule-engine-80-evaluation.json` reports 80 passing **synthetic engineering** cases, zero source-backed Nigerian cases and no independent challenge acceptance. Those engine checks are useful but do not execute this authored source-backed corpus. Do not add those counts to this artifact or describe their success as RUL-008 acceptance.

The exact RUL-008 requirement is: “Maintain at least 80 source-backed scenarios across six sectors, three checked locations, other-state gaps, unknowns and effective-date boundaries. Use a separate AI validation run to challenge expected results.” Its acceptance is: “all critical results and exclusions pass; unresolved interpretations remain held.” RUL-003 also requires equal inputs/date/released version to give equal results; RUL-004 requires facts/version/jurisdiction/sources/reasons; RUL-007 requires reproducible snapshots; EDP-006 requires fixtures on the exact pre-publication candidate.

## Correction to the binding contract

The earlier artifact required an already released rule version before any normal-case execution. That was too broad: EDP-006 requires fixture execution before release, so an offline release check cannot depend on the release it is meant to validate.

The artifact now distinguishes **isolated offline candidate validation** from **customer/live execution**. An offline run must bind an immutable candidate hash/version and exact source-version hashes, identify its isolated context and record that it confers no publication eligibility. A customer/live run additionally requires the actual currently eligible released version, matching those validated bytes. Held/draft/stale negative scenarios must preserve their intended invalid eligibility state. Neither mode may fabricate a release ID. All bindings remain unset in the authored data.

This change corrects readiness metadata only. The 80 IDs, facts, assessment dates and expected labels are unchanged. Normal expected outcomes remain conditional on independent source/rule validation. The update does not claim the separate AI challenge has occurred.

## CAMA case-by-case review

The source section 814 passage and all three exceptions were re-read from the official CAC PDF. The independently retrieved raw hash and exact 814 passage hash match the saved application evidence. No existing CAMA expected label needed a legal reversal. The following are conditions for preserving those labels in executable fixtures:

| Cases | Retained candidate result | Required reason/guard |
|---|---|---|
| 001, 004 | Likely relevant | Individual trade brand/service descriptor; confirmed true-name facts and no material unresolved exception. |
| 002, 003 | Not indicated | Personal-name-only and permitted initials branch; recognise 868's patronymic and recognised-abbreviation definitions. |
| 005 | Not indicated | Include every individual partner's true surname; names are supplied facts, not parser guesses. |
| 006 | Likely relevant | A partner's surname is omitted; checking only the first partner is a critical failure. |
| 007, 013 | Not indicated | Manager and receiver are separate coverage cases; court appointment and carrying on the business must both be confirmed. |
| 008 | Not indicated | Exact corporate name; personal surname is legitimately not applicable. |
| 009 | Likely relevant | Separate corporate trading alias; incorporation alone does not remove the naming condition. |
| 010 | Not indicated | The only extra wording identifies succession; no independent addition remains. |
| 011 | Likely relevant | An independent Hospitality descriptor remains; succession wording is not a general exemption. |
| 012 | Not indicated | Two actual partners share the surname and only plural “s” is added. Do not generalise this to missing different-surname partners. |
| 014 | Likely relevant | Ordinary private manager does not establish court appointment. |
| 015, 016, 017 | More information needed | Respect respectively unknown appointment authority, unknown Nigerian place of business, and unanswered legal form. |
| 018 | Not indicated for current trigger | Planning-only activity is not an overdue/default finding. Optional preparation is a separate suggestion. |
| 019 | Held, displayed as More information needed | CAMA 2020 source cannot determine a 2019 historical answer without the controlling historical source. |
| 020 | Likely relevant | Added trading descriptor explains change; the move from Lagos to Rivers is not the national trigger. Preserve previous snapshot and task. |

`analysis/business-name-release-candidate.md` contains the actual narrowed customer text, source mapping and deterministic decision table. It adds directly relevant CAMA 868 definitions and 863 context to the prior source bundle. Existing `section814Exception: "none"` is a **synthetic fixture stipulation** that the material exceptions have been considered; the application must not derive it from omitted user answers. Convert it to the actual declarative fact fields during binding. Do not treat this oracle convenience as permission to skip questionnaire facts.

## Additional CAMA challenge inputs to add before accepting its implementation

These are distinct boundary candidates, not executed results and not replacements needed to pretend the existing 80 passed. Bind them to actual supported scope. Their purpose is to catch omissions identified by the fuller source reading.

| Supplemental ID | Facts or mutation | Candidate expected behavior |
|---|---|---|
| BN-BOUND-01 | Individual; affirmative no place of business in Nigeria; trading brand | This territorial naming trigger not indicated; no inference about other Nigerian connections or laws. |
| BN-BOUND-02 | True surname is a confirmed patronymic; name contains only it and true forename | Not indicated; do not reject the surname based on a Western naming pattern. |
| BN-BOUND-03 | Forename addition is a confirmed recognised abbreviation, more than one letter | Not indicated; single-letter-only validator is incorrect under 868. If recognition is uncertain, ask rather than guess. |
| BN-BOUND-04 | Three individual partners: two Akan and one Bello; trading name “Akans” omits Bello | Likely relevant; plural exception does not erase a different partner's surname. |
| BN-BOUND-05 | True surname Akan; independent brand remains even after qualifying succession wording is removed | Likely relevant; the words “successor to” are not a whole-name exemption. |
| BN-BOUND-06 | Unincorporated firm includes a corporation partner | More information needed / supported-scope gap in the initial all-individual-firm rule; do not fabricate a corporate surname. |
| BN-BOUND-07 | User selects LLP/LP/trust rather than individual/ordinary firm/company | More information needed / explicit scope gap until an appropriate reviewed rule exists; no unregistered-company inference. |
| BN-BOUND-08 | Added brand; appointment authority unknown; UI attempts `not_applicable` for exception without supporting facts | Preserve unresolved material fact; no definite positive or negative based on the invalid N/A. |
| BN-BOUND-09 | Same current name/operator has a confirmed current business-name registration | Underlying naming relevance may remain; no duplicate register-again task or breach claim. |
| BN-BOUND-10 | Candidate A validated; a single exception/claim/source/policy hash changes before publisher call | Fail exact-version eligibility; require revalidation. Do not reuse old expected-output success. |
| BN-BOUND-11 | Assessment on day before CAMA commencement versus 7 August 2020, with no historical review bundle | Before commencement held; the later date is not automatically supported merely because it equals commencement. Bind the historical controlling version before a definite result. |
| BN-BOUND-12 | Assessment/source-review timestamps exactly before, at and after a configured expiry boundary | Deterministically follow the documented manifest policy; never turn a failed/expired source into a “not indicated” legal result. Policy expiry is not a statutory deadline. |

## Remaining corpus work, in executable order

1. **Freeze exact source/effective-context bundles for all four candidates.** CAMA's 814 extract is ready and the 868/863 additions are supplied here. NDPA needs its section 2/3/27 scope and exceptions tied to the exact original Act; use GAID only for claims whose applicable commencement is established. NTAA's stable 11 annual-return claim can proceed without the disputed small-business asset boundary; retain the version discrepancy and hold historical/straddling-period conclusions not established by the transition sources. NAFDAC's national product/activity candidate must stay separate from disputed employee-count routes, fee amounts and draft regulations.
2. **Translate authored facts to the actual declarative schema.** Keep sourceCandidateID-to-ruleID/version/hash mapping in a binding manifest. Preserve explicit unknown/unanswered/not-applicable values. Record every mapping and rejected/unmapped fact. Do not silently drop an exception, substitute industry for actual activity, or make “not registered” a prerequisite for relevance.
3. **Challenge expected results independently before using them as the acceptance oracle.** Supply the final candidate, official exact passages, periods and all 80 scenarios to a separate AI validation run, isolated from the drafting verdict. Persist model/prompt/run IDs, per-case objections, resolutions and hash of the expected-output set. This research agent's review and the earlier structural review do not substitute for that run.
4. **Add real date boundaries and released-scope regression coverage.** Existing historical/future dates exercise out-of-scope holding but do not test exact approved effective-period and review-expiry boundaries on both sides. Include boundary pairs for each released source/rule and preserve old/current assessment explanations. Add threshold/band tests only for a genuinely approved numeric rule; these four narrow rules deliberately do not decide tax-size or fee thresholds. Never invent a threshold to satisfy a case count.
5. **Execute the complete reviewed suite against the exact candidate build.** Record case ID, synthetic profile hash, assessment date, rule/source/policy hashes, expected result/reasons/questions, actual result, critical-failure flags and elapsed/error status. Repeated equal inputs must be equal. Run result mutation/withdrawal/history cases using the actual persistence and release controls, not just a pure predicate helper.
6. **Confirm coverage in the three priority locations.** National outcomes can be evaluated for Lagos/FCT/Bayelsa profiles, but the current dataset proves no state/local requirement. Assert the actual UI/API preserves this gap. Any released state/FCT pack needs its own authoritative sources and positive/negative outcomes; selecting a place in a national scenario cannot be counted as checking that place's own law.
7. **Recheck after publication binding and preserve failures.** An offline pass supports the exact candidate; subsequent customer execution must resolve to the same released manifest. Hold unresolved interpretations and show the reason. A suite is accepted only after all critical results/exclusions pass and all requirement coverage is actually evidenced. Four narrow candidates and 80 authored rows do not by themselves prove that, but the TRD does not demand 80 distinct statutes either.

Customer AI (60) and editorial publication (60) remain separate suites. Their counts and results must not be combined with the rule suite. The source/currentness work here is usable release input and removes avoidable uncertainty; it does not waive EDP-002–007, mark the source-backed suite executed or accept R1/R2.
