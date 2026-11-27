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

## 14 November 2026 addendum: independent preparatory source challenge

**Review classification:** independent preparatory source review of the authored expectations, separate from implementation outcomes. The coordinating research agent checked CAMA/NAFDAC; separate research agents challenged NDPA and NTAA. This work had prior corpus context and is not claimed as a blind challenge, a pipeline/provider review receipt, executed rule tests, publication eligibility or RUL-008 acceptance. No case, fact, expected label or execution status was changed.

**Version binding.** The historical review above was fetched from `docs/reviews/rule-evaluation-readiness-2026-11-14.md` at repository head `359665569659e637246cecdba67220ccef525c94` and preserved as an unchanged prefix. Its original UTF-8 SHA-256 is `3db6ffd07b45e13856bc86609974d48c6d89c3d81a99c22587a4a73844f29e28`. The reviewed corpus is `docs/evaluation-candidates/checker.json`, schema 1.1, corresponding to retained `analysis/checker-evaluation-candidates.json`: SHA-256 `5e333b3f472263e16f767b3165e29c1b1e210fdbac922873d1ffc086027ae1a0`. Its recorded earlier schema 1.0 ancestor hash is `6f2b8d46f6f30aaadd6377e73b8720115a88986c6f2990f43cff5c428bb900cf`; that older version is not the reviewed execution input.

### Retained source bindings

All page numbers below are one-based PDF pages. Raw hashes were recomputed from the listed local files during this addendum. Local research files are evidence locations, not a claim that the application has ingested or approved their bytes.

| Source | Retained file and raw SHA-256 | Relevant locators |
|---|---|---|
| CAMA 2020, official CAC PDF | `analysis/business_name_sources/cama_2020.pdf`; `d39745af4eaeceb8dbdc3678bb5d072b48ad5e022ead3b1cec7f94b88b01a2c8` | §814 pp405–406/A405–406; §863 p432; §868 pp434–436. Exact §814 extracted passage hash: `4bc357be4f635d2980b67447f8bd5e6624ddbbcf4980348ac85f0bd2f998953d`. |
| Business Facilitation Act, official NIPC PDF | `analysis/business_name_sources/bfa_2022.pdf`; `c268648489af515bad45694197fa80d6ba8f5c0485a8cc0bf56cfa08b1417b14` | Schedule Part I pp9–13/A103–107; inspected amendment context, not proof of exhaustive absence of later amendments. |
| NDPA 2023, official NDPC PDF | `analysis/privacy_sources/ndpc_act_2023.pdf`; `5bfb22cf7b344e92ecca9b80decf73db694a0d1000c4f42188f46e047d8df075` | §§2–3 pp7–8/A723–724; §27 pp18–19/A734–735. Selected extracted-page hashes are retained in `analysis/privacy_sources/guidance-source-manifest.json`. |
| NTAA 2025, National Assembly copy | `analysis/registration_tax_sources/ntaa_nass_2025.pdf`; `eb3ea717052f48492cc6441ad23f9e7ac2ad4782395db1c391580cc1adef20e2` | §11 pp13–14/A269–270; §147 pp73–75/A329–331; printed commencement p9/A265. |
| NTAA 2025, NRS copy | `analysis/registration_tax_sources/ntaa_nrs_2025.pdf`; `956092e5ec5aad8e8b9cda47d6dbb6bde4dacf1000e59df6fe73a5fc12abc403` | §11 pp11–12/A269–270; §147 pp70–72/A328–330; printed commencement p7/A265 and §148 p74/A332. |
| Cap F33, official NAFDAC PDF | `analysis/governance_safety_sources/nafdac_cap_f33.pdf`; `3099b153d913872ef0d839110a65c8451f758d145eeadd54ebc2f049ff663f07`; 31,142 bytes, 8 pages. Retrieved from the exact official URL with HTTP 200 on 14 November 2026 at 12:13:56 UTC. | §§1–2 p2; §13 pp6–8, with relevant definitions on p7. Exact extracted pages and their hashes are retained in `analysis/governance_safety_sources/nafdac_cap_f33_pages.json`; retrieval metadata is in `nafdac_cap_f33_retrieval.json` in the same folder. |

Official source URLs:

- CAMA: https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf
- Business Facilitation Act: https://nipc.gov.ng/assets/resources/business-facilitation-miscellaneous-provisions-act-2022/business-facilitation-misc-provisions-act-2022.pdf
- NDPA: https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf
- NTAA, National Assembly: https://nass.gov.ng/documents/download/11250
- NTAA, NRS: https://www.nrs.gov.ng/uploads/NIGERIA_TAX_ADMINISTRATION_ACT_2025_8c945071a7.pdf
- Cap F33: https://www.nafdac.gov.ng/wp-content/uploads/Files/Resources/Regulations/NAFDAC_Acts/FOOD-DRUGS-AND-RELATED-PRODUCTS-REGISTRATION-ACT-Cap.F.33.pdf

### Challenge findings requiring explicit disposition

These are objections to resolve before adopting an oracle, not automatic label replacements or permission to weaken a failed test.

| Exact case IDs | Challenge outcome | Source-backed finding |
|---|---|---|
| **CHK-CAND-NDPA-018** | **Support gap in negative result** | §2(2)(a), p7/A723 separately includes Nigerian domicile, residence or operation. The case negates operation, processing location and data-subject location, but not domicile/residence. Being currently outside Nigeria does not settle them. `connectionResultForScenario` is a conclusion. Establish the missing territorial facts, including relevant processor connections if claiming every link is absent, or preserve uncertainty. |
| **CHK-CAND-NTAA-009** | **Support gap in negative result** | §147 Company definition, NASS p73/A329 and NRS p70/A328, extends beyond CAMA incorporation and mentions associations. `ordinary_unincorporated_partnership` plus `incorporatedAsCompany:false` does not document the required exclusion interpretation. A precise scoped justification or classification follow-up is needed. This objection does not establish that the partnership owes a company return. |
| **CHK-CAND-NAFDAC-009, CHK-CAND-NAFDAC-013, CHK-CAND-NAFDAC-016** | **Scope/label ambiguity** | §1(1), p2 covers regulated products and several activities; §13, p7 supplies relevant definitions. Uncertain procedural classification does not necessarily make national registration relevance uncertain. Decide whether the oracle concerns product-registration relevance or local-manufacturer application eligibility before adopting these `May apply` labels. |
| **CHK-CAND-NAFDAC-017** | **Scope/uncertainty ambiguity** | §1(2), p2 provides the conditional sample-permit route. This case already confirms the matching permit and satisfied conditions. Its follow-up repeats established facts. Distinguish the confirmed sample exception from continuing permit conditions; an unexplained `May apply` label is insufficiently precise. |
| **CHK-CAND-NDPA-009** | **Timing ambiguity; no automatic label reversal** | Rejecting solely-household treatment follows §3(1), p8. Reuse of an existing household list does not establish a new collection event for §27(1), p18. Retain relevance without inventing retrospective notice timing; separate the accessible-policy obligation under §27(3), p19, from any additional purpose-change claim needing its own support. |
| **CHK-CAND-NTAA-012** | **Input terminology ambiguity** | §147, NASS pp74–75/A330–331 and NRS pp71–72/A329–330 distinguishes Foreign Company from Nigerian Company; the latter includes effective management/control. `foreign_company` should not predetermine tax classification while Nigerian management is unverified. The known fact is incorporation outside Nigeria. Existing `May apply` remains defensible. |
| **CHK-CAND-NTAA-013** | **Stipulated classification limits coverage** | The domestic-candidate exclusion is defensible. However, `finalTaxTreatment:confirmed_for_scenario` does not independently prove the final-withholding classification underlying §11(3). That would need actual income facts and the applicable NTA provision. §11(2)–(3): NASS pp13–14/A269–270; NRS p11/A269. |
| **CHK-CAND-NTAA-018** | **Qualify the uncertainty** | §11(1),(5), NASS pp13–14 supports separating broad annual-return relevance from period-specific treatment/timing. The retained transition announcement discusses accounting-period treatment. Keep `May apply` uncertainty attached to the unresolved period question, not to unrelated turnover or small-company thresholds. |

### Outcomes retained, with limits

- **CHK-CAND-CAMA-001 through CHK-CAND-CAMA-020:** no label reversal identified under the expressly narrow §814 naming-trigger scope. The earlier case table remains conditional. `section814Exception` and naming-assessment stipulations must be bound to underlying facts; omitted questionnaire answers cannot become an exception decision. §868 definitions and §863 context remain necessary to prevent name parsing errors or general-exemption claims.
- **CHK-CAND-NDPA-008:** its negative depends on the supplied confirmed household/no-rights-violation facts, not mere absence of reported harm. **NDPA-013–016** reasonably preserve uncertainty about collection and exemptions. **NDPA-017** has an affirmative territorial connection. **NDPA-019–020** remain historical/source-policy holds, not declarations that legal duties disappeared. Relevant sources are §§2–3 and 27 at the pages above.
- **CHK-CAND-NTAA-001–007, 014–015 and 019:** no contradiction identified in the narrow current filing-relevance results under §11(1)/(4). Zero tax/turnover, nonprofit purpose or cessation must not automatically become a filing exemption. **NTAA-008, 010–011 and 016** preserve their entity/scope distinctions. **NTAA-017 and 020** remain intentionally unsupported historical/future-context holds.
- **CHK-CAND-NAFDAC-018:** further authority is needed for the claimed food-sample permit; §1(2) does not itself list processed food. Do not infer a food-sample exemption or use absence of commercial supply as a blanket registration exclusion.

The two NTAA copies have different printed commencement dates: National Assembly p9 shows 26 June 2025; NRS p7 shows 1 January 2026 and §148/p74 shows 1 January 2025. These retained differences do not undermine the stable present-day §11 wording by themselves. Conversely, this review does not resolve all historical treatment, establish an official correction, or prove exhaustive currentness.

**Disposition:** two negative-result support gaps remain open; the identified scope, terminology, timing and stipulated-classification limitations also need a recorded decision. The 80 authored cases remain unchanged and unexecuted by this review. No provider run ID, passing-result count, released manifest or acceptance status was created or inferred.

**14 November 2026, 12:13 UTC source-binding update:** the previously missing Cap F33 raw source was successfully retrieved once through ordinary HTTPS without escalation. Its 8-page PDF identity and relevant pages were checked with `pdfinfo` and `pdftotext -layout`. Full extracted-text SHA-256 is `ba915ee0564f131c5d5db3eabe040c19060c9bd833d76dc59a3de2c28d432320`. The retained text confirms the sections used above; the substantive objections are unchanged. This removes the local raw-byte evidence gap only: it does not bind the application registry, resolve currentness/amendments, clear rights or editorial review, or alter the authored corpus.


