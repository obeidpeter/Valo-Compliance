# CAMA section 814: bounded release candidate

Prepared 14 November 2026. Research input for the Valo editorial pipeline; **not a publication approval, professional review, executed rule or accepted requirement**. This narrows and supplements `docs/valo/evidence/business-name/candidate.json` at repository revision `3409a4f0e7e38b864b6b3f3240608761569ac462`. The original section 814 extract is correct. No application code or Replit state was changed.

## Proposed customer item

**Title: Check whether your trading name triggers business-name registration**

If you have a place of business in Nigeria and carry on business under a name, section 814 of the Companies and Allied Matters Act 2020 sets out these naming conditions:

- For an individual, the trigger concerns a name beyond the person's true surname, with only true forenames or their initials added.
- For a firm, it concerns a name beyond the true surnames of all the partners, with only the individual partners' true forenames or initials added.
- For a company, it concerns a trading name other than its corporate name without additions. Being incorporated does not itself answer whether a separate trading name meets this condition.

Section 814 also contains three qualifications. Wording that merely indicates succession to a former business owner does not, by itself, require registration. If two or more individual partners share a surname, adding an “s” to that surname does not, by itself, require registration. The section also provides an exception where the business is carried on by a receiver or manager appointed by a court.

The Act's definitions matter: a surname includes a patronymic, and initials include a recognised abbreviation of a forename. A name should not be classified solely by spelling, punctuation or a software guess about which part is a surname.

**Practical next step:** confirm the type of operator, the name actually used, the relevant true names or corporate name, and whether any of these qualifications applies. If the naming trigger is indicated, use the [CAC business-name registration route](https://www.cac.gov.ng/services/business-name) to check the current application requirements. CAC's page describes an online name check, application and document upload, and payment of its filing fee. It says individuals/proprietors can apply themselves.

**Scope:** this is a check of section 814's naming conditions. “Not indicated by these answers” means only that this check has not identified that trigger. It does not establish that registration is unnecessary generally, that a proposed name will be accepted, or that the business has met other federal, state/FCT or local requirements. No fee amount, filing deadline, processing-time promise, tax position or incorporation advice is supplied here.

Source checked: 14 November 2026. Before actual publication, the page must display the real review and publication timestamps from its manifest. Only after both reviews actually pass may it display: “AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist.” This research document does not earn that label by itself.

## Claim-to-passage mapping

| Claim | Retained primary passage | Supported boundary |
|---|---|---|
| Nigerian place of business and business carried on under a name | CAMA 814(1), PDF 405 / Gazette A405 | A selected Nigerian state, nationality, website audience or intention to start trading does not alone establish these facts. |
| Individual, firm and company name branches | CAMA 814(1)(a)–(c), PDF 405 / A405 | The legal-form branches cannot be replaced by a universal “all SMEs must incorporate” rule. |
| Succession-only addition | CAMA 814(2)(a), PDF 405 / A405 | Disregard only that qualifying addition; a separate trade brand or omitted partner's surname is not cured by succession wording. |
| Shared surname with plural “s” | CAMA 814(2)(b), PDF 406 / A406 | Two or more individual partners must share the surname; the addition alone is not a trigger. Do not erase other partners or additional descriptors. |
| Court-appointed receiver or manager | CAMA 814(2)(c), PDF 406 / A406 | Both the appointment and the business being carried on by that receiver/manager matter. A privately hired manager does not establish this exception. |
| Business/name/firm definitions | CAMA 868(1), PDF 434–435 / A434–435 | “Firm” includes certain corporate-partner combinations; the initial automatic branch below deliberately supports only an all-individual firm with complete naming facts. |
| Patronymic and recognised abbreviation | CAMA 868(1), PDF 436 / A436 | “Initials” is not limited to one ASCII letter; the system must not invent a cultural-name interpretation. |
| Why the negative result is narrow | CAMA 863(1)–(2), PDF 432 / A432, alongside 814 | Section 863 uses broad registration wording. This candidate does not resolve every registration question or give general permission to operate unregistered. |
| Current application route, without fee or time claims | CAC business-name service page, “Registration steps for Business Names” | Original paraphrase of process facts; link to the official route. No copying of marketing claims or assertion of name approval. |

## Deterministic semantics to implement and review

The output is **relevance of the section 814 naming trigger**, not default, breach, incorporation eligibility or a decision on registration approval. Registration status is a separate action fact: an existing registration does not make the underlying naming condition disappear, and a known current registration must not create a duplicate “register again” task.

Use explicit known/unknown/unanswered/not-applicable states. Missing data is never false. Ask only questions material to the selected branch. Inapplicable personal-name questions for a company are skipped; missing questions necessary to evaluate an individual's name cannot be answered “not applicable”. Equal normalised structured facts, assessment date and rule-version hash must produce equal output, without an LLM call.

| Order | Condition | Candidate output and explanation |
|---|---|---|
| 0 | Customer execution lacks the matching released manifest; evidence is withdrawn/expired, materially conflicting or outside supported time context | `More information needed`, with a separate availability/hold notice. No definite recommendation or new statutory reminder. Offline candidate fixture evaluation is permitted in an isolated validation context; it grants no customer eligibility. |
| 1 | A necessary territorial/activity fact is explicitly false | `Not indicated by these answers` for this naming check, with the exact failed predicate and all coverage limitations. Planning-only activity can show optional preparation, never an overdue finding. |
| 2 | A necessary territorial/activity fact is unknown or unanswered | `More information needed`; identify the unanswered fact. Do not infer a Nigerian place of business from the state dropdown. |
| 3 | The business is carried on by a confirmed court-appointed receiver or manager | `Not indicated by these answers`, citing 814(2)(c). Do not describe general exemption from all obligations. |
| 4 | Legal form is unknown, mixed corporate-partner firm, LLP, LP, trust or another form not classified within this released rule's supported scope | `More information needed`, with explicit scope gap. Do not coerce an LLP or corporate partner into an individual surname. |
| 5 | Individual: confirmed true surname/patronymic, optionally true forenames/recognised abbreviations only; firm of individuals: confirmed relevant true surnames of every partner, optionally their permitted forenames/initials only; company: exact corporate name without additions | `Not indicated by these answers` for the naming trigger. The premise must be supplied/confirmed, not guessed by a generic name parser. |
| 6 | After disregarding only confirmed succession wording and/or the qualifying plural “s”, the applicable base-name condition is satisfied and no independent addition/omission remains | `Not indicated by these answers`; cite exactly the applicable 814(2)(a)/(b) qualification and base-name facts. |
| 7 | A supported legal-form branch has a confirmed independent addition, missing partner surname or corporate-name difference, and no material exception fact is unresolved | `Likely relevant`; cite the applicable 814(1) branch and the actual addition/omission. Ask registration-status/action questions separately if needed. |
| 8 | Name composition or a potentially material exception remains unknown, unanswered, contradictory or an unverified claim | `More information needed`; ask the specific question. Do not silently treat the exception as absent or established. |

The fact that a court-appointed exception is affirmatively established can make further name-composition questions unnecessary. Conversely, where there is affirmatively no naming difference even before any exception, asking every exception question adds no value. Implement short-circuiting only when the known facts logically settle this narrow result. “May apply” remains one of the four permitted product labels, but this simple candidate need not artificially exercise every label; material unresolved predicates above use “More information needed”.

Recommended input facts are operator form; whether a place of business is in Nigeria; whether business is being carried on under the supplied name; confirmed name-composition category and supporting raw names; partner count/types and all relevant true surnames; succession addition only; shared-surname/plural-only facts; whether a court appointed the receiver/manager who carries on this business; and registration status for the exact name/operator. Retain the supplied names for explanation, but do not use model guesses as legal facts. Questions about firms must allow more than two partners and a mixture of shared and different surnames.

Assessment date and source effective dates are separate from source fetch/review/publication dates. CAMA's printed commencement is **7 August 2020**, PDF 33 / A33. This present-day candidate does not by itself establish a historical 2020 version, predecessor-law answer or a 2030 answer. A historical assessment needs the version/evidence applicable to that time. Date-boundary fixtures should test approved manifest intervals as well as the commencement boundary; do not manufacture a statutory expiry date.

## Actual source retrieval, identity and amendment work

Three complete official PDFs were independently retrieved on 14 November 2026. Their raw SHA-256 values **match** the application's earlier actual retrieval records. PDF metadata is not the document's legal title. In particular, the CAMA PDF metadata incorrectly says “ELECTORAL (AMENDMENT) ACT, 2015”; the actual Gazette cover, operative Act pages and section 814 were inspected.

| Source | Official URL | Raw bytes / SHA-256 |
|---|---|---|
| CAMA 2020, Act No. 3 | https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf | 1,269,127 / `d39745af4eaeceb8dbdc3678bb5d072b48ad5e022ead3b1cec7f94b88b01a2c8` |
| Business Facilitation (Miscellaneous Provisions) Act 2022, Gazette 17 February 2023 | https://nipc.gov.ng/assets/resources/business-facilitation-miscellaneous-provisions-act-2022/business-facilitation-misc-provisions-act-2022.pdf | 566,637 / `c268648489af515bad45694197fa80d6ba8f5c0485a8cc0bf56cfa08b1417b14` |
| Copyright Act 2022, Gazette 27 March 2023 | https://copyright.gov.ng/CopyrightAct/CopyrightAct2023FinalPublication1.pdf | 738,936 / `75c6154c1d4feb8581d5ef806e633d434dd9f67b7a4dcfc0dac554f4cf3aad4c` |

`analysis/business_name_sources/retrieval_manifest.json` records actual fetch timestamps, source URLs and raw/text hashes. `bounded_passages.json` retains exact extracted statutory passages and passage hashes. The section 814 passage hash is `4bc357be4f635d2980b67447f8bd5e6624ddbbcf4980348ac85f0bd2f998953d`, matching the existing application candidate. Whole-document extracted-text hashes can differ with extractor output; raw PDF equality and the exact passage hash are the reliable cross-extractor comparisons here. Never substitute one extractor's full-text hash for another snapshot.

The full Business Facilitation Act Schedule Part I, paragraphs 1–21, was read, not merely searched for “814”. It amends CAMA sections 78, 127, 142, 149, 154, 171, 181, 207, 222, 240, 244, 248, 275, 283, 307, 378, 394, 572, 658 and 868. It does **not** amend 814. Its change to 868 deletes “insolvency practitioner”; it does not change the business, business-name, firm, forename/surname or initials definitions used here. Its printed commencement is 8 February 2023, PDF 5 / A99. The [official ministry assent announcement](https://fmino.gov.ng/president-muhammadu-buhari-assents-to-the-business-facilitation-miscellaneous-provisions-bill-2022-and-other-bills/) is dated 13 February 2023. The Act's citation year and its assent/commencement year must not be conflated.

A dated primary-source currentness check also examined the current CAC business-name service and iCRP pages, and searched CAC, the National Assembly, NILDS and State House official sources for subsequent CAMA/814 amendments through 14 November 2026. Current CAC pages continue to provide the CAMA 2020 source and a business-name route. Official NILDS results include proposed CAMA amendment **bills**. For example, [this National Assembly record](https://ir.nilds.gov.ng/handle/123456789/1868?show=full) identifies a 2023 bill about unclaimed dividends and labels it a working paper. A repository upload date, bill title or parliamentary reading is not evidence of enactment. No retrieved enacted primary instrument in this scoped search changed 814 or these retained naming definitions.

This is a scoped currentness conclusion supported by identified sources, not an assertion that every possible later amendment or judgment has been excluded. The absence of a universal negative proof should not by itself block this narrow item. The final factual/challenge reviewers must assess the exact claim and this record; an actual material contrary instrument must be resolved or the affected claim held. CAC FAQ/process pages contain differing processing-time claims and potentially old figures; fees, time guarantees and procedural minutiae have therefore been detached from the candidate, not treated as evidence against section 814 itself.

The old candidate's CAMA 20/281/283 formation-capacity dependency is correct as far as it goes, but formation capacity is outside this item's scope. It need not become an unrelated release blocker. The newly retained 868 naming definitions and 863 negative-result context are directly relevant and must accompany review.

## Scoped rights record

The official instrument is titled **Copyright Act 2022**, although it was published in 2023 and its URL contains “2023”. Section 3(b), PDF 8 / A184, excludes official legislative/administrative texts and official translations from copyright, **except their compilations**. Section 2(5) on the same page says compilation copyright does not give exclusive rights in pre-existing material or data.

For this item, the proposed rights basis covers limited official statutory passages and our original explanatory paraphrase. It does not license an entire designed PDF compilation, logos, CAC website design/marketing copy, third-party commentary or AI-provider account/output rights. Keep full source snapshots private as evidence; publish the bounded relevant passages/locators and original explanation rather than republishing a whole Gazette compilation. The factual process summary above is a paraphrase plus official link, not a copy of the website. Complete the separate creator/provenance and actual provider-permission records for the exact generated artifact before release. Do not mark those records satisfied merely because the statute text has this rights basis.

## Required release work, without invented approval steps

1. Ingest the directly relevant 868 definitions and 863 context into the same immutable source bundle; bind the candidate's real source hashes and locators. Record the dated currentness conclusion and the narrowly scoped statutory-text rights basis.
2. Build the declarative candidate with the semantics above and run isolated candidate fixtures on the exact candidate hash. Record actual outputs, errors and critical failures. Candidate validation does not require the item already to be publicly released.
3. Run the factual review and blind challenge separately with the full evidence bundle and exact candidate, without sharing each other's verdict. Record model, prompt, run ID and actual findings. A changed candidate requires rechecks.
4. Pass required mechanical, disclosure, scope, freshness, rights and policy checks. Bind the successful evidence to an immutable release manifest; let the independently permissioned publisher atomically recheck it. No routine per-item human or Nigerian specialist sign-off is imposed by this handoff.
5. Verify customer rendering and withdrawal against the released hash. Confirm that held versions cannot reach the checker, previous assessments remain traceable, and state/local gaps remain visible. These actions have **not** been performed by this research handoff.
