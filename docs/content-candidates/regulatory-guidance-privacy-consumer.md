# Valo regulatory guidance candidates — privacy and consumer operations

Prepared 14 November 2026. Eight original customer guidance candidates, GUD-11–GUD-18. **Draft input, not published content or a release manifest.** Each customer body is 200–350 words; editorial metadata stays outside it. These entries do not determine a particular business's compliance, replace a regulator's decision, or claim professional review.

## Evidence and common scope

All three official PDF URLs returned complete HTTP 200 responses on 14 November 2026. NDPA and GAID bytes match the earlier retained copies. Page numbers below are **1-based PDF pages**, not printed Gazette page numbers. Full local copies and extracted text are in `analysis/privacy_sources/`; `guidance-source-manifest.json` records raw-file, text and selected-page hashes. OCR quirks must be resolved against the PDF, not silently treated as new legal language.

| Source ID | Exact official source | SHA-256 of complete PDF |
|---|---|---|
| NDPA | Nigeria Data Protection Act 2023 — https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf | `5bfb22cf7b344e92ecca9b80decf73db694a0d1000c4f42188f46e047d8df075` |
| GAID | NDP Act General Application and Implementation Directive 2025 — https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf | `e4359e90c9a11cd772f9605c797d6f36af000c58a27bfba251fa37a89824cc5a` |
| FCCPA | Federal Competition and Consumer Protection Act 2018 — https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf | `aa942cdef860387e8f984de52666e5683d12d6e2813cb47b10335e0bf82a07f5` |

The source IDs in every claim map bind to these exact hashes. The FCCPC consumer-rights webpage is not the operative authority: some of its section descriptions are inaccurate. Current official-site discovery and full-text checking were performed, but an exhaustive amendment, sector-rule and applicability search remains a release task. GAID Article 45 expressly treats NDPA Part VIII as governing transfers; do not flatten Article 18 into a universal consent-only transfer rule. No country adequacy list or individual provider clearance was established.

Common privacy applicability: personal-data processing within NDPA section 2, with actual controller/processor roles identified. Section 3 exemptions must be evaluated on their own conditions; ordinary commercial processing is not treated as household activity. These entries do not decide major-importance registration, DPO appointment or filing status. Common consumer applicability: transactions within the Act and the relevant consumer provisions; section 167's goods definition of consumer excludes resale and goods bought for production/manufacture of other goods for sale. Service recipients are addressed separately by that definition. Do not assume every business-to-business goods purchase falls within the same remedy.

Rights/provenance: original ChatGPT-assisted explanatory prose in this task, with legal propositions paraphrased from the identified official instruments. Bind final body hashes to the existing scoped authoring/rights process; do not infer copyright exclusivity, third-party commentary rights or customer sales-licence acceptance. Operational suggestions below are expressly distinguished from legal rules in metadata.

---

## GUD-11 — What should I explain before collecting customer information?

### CUSTOMER BODY START

Before collecting names, telephone numbers, delivery details or other personal information, identify who decides why and how it will be used. If that is your business, you are acting as a controller for those purposes. This guidance concerns processing covered by Nigeria's Data Protection Act; a business contact list is not automatically a private household activity.

A privacy notice should explain your identity and contact route, each processing purpose and its specific lawful basis, recipients or recipient categories, the retention period, people's rights and their right to complain to the Nigeria Data Protection Commission. Explain automated decision-making or profiling where present, including its significance and expected consequences. A statement that you make no significant automated decisions does not answer whether other profiling occurs.

Give the required information before direct collection. For information obtained elsewhere, the Act also requires information before collection, subject to its stated exceptions where the person already has it or providing it is impossible or involves disproportionate effort or expense. Record the facts behind any exception; do not assume a purchased contact list is exempt.

Make the explanation usable at the actual collection point. A short explanation beside a form can link to fuller detail. For a shop conversation or an audience needing interpretation, use a form the person can understand. GAID also calls for information about processing means, third-party access purposes and an internal remedy contact.

Start with a table linking each purpose to its data, source, recipients, lawful basis and retention. Check it against the systems you actually use, including overseas support access. Publishing a notice does not create consent, justify unnecessary collection or prove that security controls exist. Complete the business facts before adopting a template.

### CUSTOMER BODY END

**Metadata:** scope=controller transparency; required facts=role, collection source, purposes, audiences, systems, recipients, retention, automation; unknown facts remain unanswered. Related template=TPL-29. Paragraph numbers count customer-body paragraphs only.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 11-C1 | NDPA ss2–3, PDF pp7–8; controller definition s65, PDF p38 | P1 territorial/material scope and no automatic household exception; role explanation follows statutory purposes/means definition. |
| 11-C2 | NDPA s27(1)–(3), PDF pp18–19 | P2 notice contents and P3 direct/indirect timing and exact exception categories. |
| 11-C3 | GAID Art27(1)–(4), PDF p31 | P4 audience-accessible delivery, means/access/remedies and P5 notice distinct from consent. |
| 11-C4 | NDPA s24(1)–(3), PDF p16 | P5 minimisation/accountability limits. The collection-point design and working table are implementation suggestions, not prescribed layouts. |

---

## GUD-12 — Do I need consent for every use of personal information?

### CUSTOMER BODY START

Do not choose one lawful basis for your whole business and apply it to every activity. Identify each purpose first. Necessary order fulfilment, a specific legal reporting duty and promotional messages can require different analysis. A privacy notice tells people what happens; it is not permission for everything described in it.

The Data Protection Act recognises consent and specified necessity grounds, including contract, legal obligation, vital interests, public tasks and legitimate interests. Each ground has conditions. Merely putting processing into your terms does not make it necessary for a contract. Where you propose legitimate interests, document the interest, necessity, effects on people and the required assessment; do not treat your commercial preference as overriding their rights or reasonable expectations.

If you rely on consent, make the request clear, specific and affirmative. Silence, inactivity and a preselected confirmation do not establish it. Keep evidence of the choice and make withdrawal as easy as giving consent. Withdrawal does not invalidate earlier lawful processing, but you must stop the activity that depends on that consent; it does not manufacture a replacement basis.

GAID requires consent for direct marketing. Provide a separate usable choice and stop marketing, including related profiling, when the person objects. An order update should not become an advertising message after an opt-out.

For website cookies and similar tracking, provide clear information and an accept/reject choice where required. GAID's narrow necessary-cookie treatment concerns core functions such as security, network stability and accessibility, with additional restrictions concerning sensitive, financial and privately stored data. Calling analytics “necessary” does not settle the question.

Before launching a new purpose, review the actual data and audience. Children's data, sensitive information, significant automated decisions and international transfers need their additional conditions checked. A completed consent box does not resolve every condition or excuse excessive collection.

### CUSTOMER BODY END

**Metadata:** scope=ordinary purpose-by-purpose basis selection, consent and website choices; required facts=purposes, necessity, audience, marketing/tracking inventory, data categories; not a complete sensitive-data/child/transfer assessment. Related template=TPL-29.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 12-C1 | NDPA ss24–25, PDF pp16–17; GAID Art26, PDF p30 | P1–2 purpose limitation, lawful grounds/conditions and legitimate-interest assessment. “Commercial preference” is explanatory synthesis of s25(2), not a separate legal test. |
| 12-C2 | NDPA s26, PDF pp17–18; s35, PDF p23; GAID Art17(6)–(9), PDF p23 | P3 consent evidence, affirmative choice, withdrawal and no retrospective invalidation. |
| 12-C3 | GAID Art18(1)(a), PDF p24; NDPA s36(3)–(4), PDF pp23–24 | P4 direct-marketing consent and cessation, including related profiling. Separating service messages is an operational safeguard. |
| 12-C4 | GAID Art19(1)–(8), PDF pp24–25 | P5 tracking choices and narrow necessary-cookie conditions. |
| 12-C5 | NDPA ss24–25, 30–31, 37, 41–43, PDF pp16–17,20–21,24,27–29 | P6 identifies additional conditional assessments without asserting one universal basis or outcome. |

---

## GUD-13 — How should my business handle a request about someone's data?

### CUSTOMER BODY START

When someone asks what information you hold, wants an error corrected or asks you to stop using it, route the request to a responsible person. Record when it arrived, what is requested and which systems may contain the information. Confirm identity or authority proportionately before disclosure; collecting excessive identification can create another privacy problem.

The Data Protection Act gives access rights without constraint or unreasonable delay. A person can seek confirmation of processing, relevant information about it and a copy of their data. The Act addresses unreasonable copying costs, but this is not permission to charge an automatic access fee. Explain any proposed limitation using the actual provision and facts.

For inaccurate, incomplete, outdated or misleading data, consider correction or appropriate deletion. Erase data without undue delay where it is no longer necessary for its purposes or there is no other lawful basis to retain it. Do not promise that every deletion request removes every record immediately: identify any continuing lawful basis, limit the retained use and explain the outcome. Restriction may be relevant while a request, objection or legal claim is resolved.

An objection to direct marketing requires that use, including related profiling, to stop. Other objections require their own assessment; they are not automatically defeated by saying that the business has a legitimate interest.

Portability is distinct from ordinary access. GAID applies it to data the person provided under consent or necessary contractual processing, with qualifications including other people's rights and public duties. Significant decisions based solely on automation also carry separate safeguards, including human intervention and a chance to contest the decision.

Give a clear response and a working complaint route. Preserve a limited record of your decision and follow through with relevant processors. A workflow checklist is useful, but it cannot replace the legal conditions or create an invented universal response deadline.

### CUSTOMER BODY END

**Metadata:** scope=data-subject requests in covered processing; required facts=request type, identity/authority, source, lawful basis, affected systems, third-party data and exceptions; no automatic fee or blanket deletion promise. Related templates=TPL-29, TPL-32.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 13-C1 | NDPA ss24(1)(c),39, PDF pp16,25 | P1 proportionate verification is an implementation safeguard inferred from minimisation/security, not a prescribed identity-document requirement. |
| 13-C2 | NDPA s34(1)–(2), PDF pp22–23 | P2 access/copy/cost conditions and P3 correction, erasure and restriction. |
| 13-C3 | NDPA s36(1)–(4), PDF pp23–24 | P4 general objection conditions and direct-marketing cessation. |
| 13-C4 | NDPA ss37–38, PDF p24; GAID Art37(1)–(6), PDF pp42–43 | P5 automated-decision safeguards and conditional portability. |
| 13-C5 | NDPA ss27(1)(f),29(1)(b), PDF pp18–20; GAID Art27(3)(i)–(j), PDF p31 | P6 complaint route and processor assistance; request log, routing and limited evidence are operational suggestions. No specific numerical deadline asserted. |

---

## GUD-14 — What should I agree with a supplier handling customer data?

### CUSTOMER BODY START

A payroll operator, hosting service or customer-support supplier may process personal data on your instructions. Check the real role before using a data processing agreement. A supplier deciding its own independent purposes, or sharing decisions with you, should not simply be labelled your processor to fit a standard form.

Where a controller engages a processor, or one processor engages another, section 29 of the Data Protection Act requires measures including a written agreement. The engaging party must ensure the processor meets applicable obligations, assists with people's rights, uses appropriate security, supplies compliance information and notifies it when another processor is engaged. Outsourcing does not make these responsibilities disappear.

Describe the service, people and data involved, processing operations, purposes, lawful bases, locations, duration and authorised instructions. Set out actual confidentiality and security measures, including access, incident handling, return or deletion and recovery. Identify subprocessors and the process for changes. A promise of “industry-standard security” is less useful than an accurate schedule that can be checked.

GAID's agreement requirements also cover potential risks, a relevant impact-assessment outcome, compliance due diligence, specific restrictions, indemnity, insurance, force majeure and dispute resolution. Complete those subjects or precisely incorporate available agreed clauses. Do not invent insurance, a registration certificate or a finding that every small supplier must register.

Agree operational contacts and response arrangements that allow statutory duties to be met. A processor must notify its engaging party on becoming aware of a personal-data breach and respond to information requests; a contractual reporting target must not permit waiting beyond that obligation.

Before sharing real records, test the arrangements against the supplier's actual service and access locations. Keep the signed version and supporting evidence. This agreement does not itself approve an international transfer, establish a lawful basis, complete a required impact assessment or prove that the promised controls work.

### CUSTOMER BODY END

**Metadata:** scope=controller–processor or processor–subprocessor engagement; required facts=actual roles, processing schedule, supplier locations, measures, risk/DPIA and applicability evidence; independent/joint-controller arrangements need separate treatment. Related template=TPL-31.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 14-C1 | NDPA s65 controller/processor definitions, PDF p38 | P1 role distinction; supplier examples are conditional illustrations, not classifications of named providers. |
| 14-C2 | NDPA s29(1)–(2), PDF pp19–20 | P2 agreement, assistance, security, information and further-processor notification. |
| 14-C3 | GAID Art34(2)–(4), PDF pp39–40; NDPA ss28,39, PDF pp19,25 | P3–4 agreement subjects and due diligence; practical schedules/testing are suggested implementation. Registration applicability is deliberately not decided. |
| 14-C4 | NDPA s40(1), PDF p25 | P5 awareness-triggered processor notice and information assistance. |
| 14-C5 | NDPA ss25,28,41–43, PDF pp17,19,27–29 | P6 separate basis, impact assessment and transfer conditions; agreement alone is not proof of compliance. |

---

## GUD-15 — What should I check before customer data goes outside Nigeria?

### CUSTOMER BODY START

Before sending personal data abroad, map where it can actually go. A Nigerian billing address for a supplier does not establish where its hosting, backups, technical support or subcontractors operate. Ask for the relevant countries, recipient roles and onward-access arrangements. Treat an unanswered location question as unresolved, rather than filling your notice with a guessed country.

For transfers from Nigeria, the Data Protection Act requires an applicable route under sections 41–43. Section 41 recognises adequate protection through specified mechanisms, or a qualifying section 43 condition. Record the transfer basis and adequacy assessment. A provider's contract or foreign certification is not automatically a finding that the Act's protection requirements are met.

Adequacy involves matters such as enforceable rights, accessible redress, public-authority access, effective law and supervision. The absence of a Commission decision does not establish adequacy. GAID points to its transfer guidance and approved transfer instruments; a familiar overseas privacy label is not a substitute for checking the actual mechanism and its scope.

Where adequate protection is absent, section 43 contains conditional routes, including informed, unwithdrawn consent after explanation of the relevant risks and narrowly defined necessity grounds. GAID Article 18 also addresses consent for destinations without an adequacy decision, while Article 45 makes the Act's transfer provisions governing. Do not turn that combination into a blanket statement that every transfer is allowed by consent, or that consent is the only statutory route. Resolve the applicable conditions before sending the data.

Keep a practical transfer record: data, purpose, recipients, destinations, safeguards, legal route, evidence and review triggers. Limit data and access, and check changes in suppliers or support locations. This entry clears no country or provider, supplies no approved contractual clauses and does not replace separate conditions for sensitive data, children's data or sector-specific restrictions.

### CUSTOMER BODY END

**Metadata:** scope=pre-transfer assessment for transfers from Nigeria; required facts=data flow, recipients, countries, onward access, applicable mechanism, current NDPC decisions and data category; **no provider/country clearance**. Related template=TPL-31 Schedule C. Legal interaction remains an explicit applicability gate, not a guessed exception.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 15-C1 | NDPA ss24,41(1)–(2), PDF pp16,27 | P1 flow inventory and P5 transfer register/minimisation are operational methods for identifying and recording actual transfers. Remote support is a risk to investigate, not an assertion that every remote access has been legally classified here. |
| 15-C2 | NDPA ss41–42, PDF pp27–28 | P2 routes/recording and P3 adequacy factors, including s42(6) absence of decision. |
| 15-C3 | GAID Art45, PDF pp52–53; Schedule5 paras1–3, PDF pp101–102 | P3 mechanisms and P4 statutory priority. No foreign certification or instrument is declared approved. |
| 15-C4 | NDPA s43(1)(a)–(f), PDF p28; GAID Art18(1)(e), PDF p24 | P4 conditional routes and explicit consent/necessity distinction; does not infer that a particular transfer satisfies either. |
| 15-C5 | NDPA ss30–31,41(4), PDF pp20–21,27 | P5 additional conditional requirements remain outside this entry's determination. |

---

## GUD-16 — What price and transaction details should customers receive?

### CUSTOMER BODY START

If you display goods or services for sale to consumers, make the price clear before the customer commits. Section 115 of the Federal Competition and Consumer Protection Act requires adequate price display, expressed in Nigerian currency. The customer must not be required to pay more than the displayed price; where conflicting prices are displayed at the same time, the lower applicable price matters.

Check the customer's full journey: shelf label or online listing, promotion, basket, checkout and payment request. Unexpected charges appearing only at the final step can undermine a clear price. As a practical control, show applicable taxes and charges and the total before payment, and reconcile every display when a price changes. Do not assume a generic “pricing errors” clause lets you demand a higher amount or rewrite an accepted order.

Except where impracticable, section 118 requires a written transaction record. Include the business name, selling or supplying address, transaction date, description, unit price, quantity, total before applicable taxes, tax amount and total including tax. The Act's rule is not merely a promise to supply a record if the customer later asks.

Use a receipt or transaction record that matches what actually happened. An unpaid invoice or payment instruction should not be presented as confirmation that money was received. Keep enough information to identify and resolve a mismatch without asking the customer to reveal card security codes or account passwords.

Use plain language and distinguish product price, optional extras and the amount payable. This guidance does not decide whether a particular tax applies or prescribe its rate. Confirm the transaction's tax treatment separately, and do not label an ordinary business receipt an official government certificate or a tax-authority endorsement.

### CUSTOMER BODY END

**Metadata:** scope=consumer price display and sales records; required facts=transaction/consumer classification, displayed prices, charges, actual tax treatment, payment state; no tax-rate inference. Suggested related templates=invoice/receipt forms and TPL-30, with payment status kept distinct.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 16-C1 | FCCPA s115(1)–(3), PDF p63 | P1 price display/currency and lower-price rule; P2 generic error clause cannot override that rule. |
| 16-C2 | FCCPA s118, PDF pp64–65 | P3 record duty, impracticability qualification and required fields. |
| 16-C3 | FCCPA s114(1)–(2), PDF pp62–63; ss123,129(1)(d)–(e), PDF pp66–67,71 | P4–5 truthful/plain information and caution against false acknowledgement/account credential collection. Checkout audit, total presentation and document-state labels are operational suggestions. Tax applicability is unresolved. |

---

## GUD-17 — Does “no refunds” settle a complaint about goods?

### CUSTOMER BODY START

A sign saying “no refunds” does not answer whether goods meet a customer's statutory rights. First establish what was supplied, what the customer was told, why the goods are being returned and when the problem arose. Keep the description, order, delivery record and any relevant communications. Different problems lead to different remedies; do not apply one change-of-mind rule to every complaint.

Under section 131 of the Federal Competition and Consumer Protection Act, consumers are entitled to goods meeting the stated quality, safety, suitability and reasonable-durability standards. A specifically communicated purpose can also matter where the supplier's role and knowledge meet the section's conditions. Being second-hand does not justify hiding the goods' condition: section 117 requires conspicuous disclosure of used or reconditioned status.

Section 132 provides a particular remedy where goods fail the section 131(1) standards: within three months after delivery, the consumer may return them without penalty and at the supplier's risk and expense, and the supplier must repair, replace or refund. This is not a universal three-month change-of-mind policy, and it does not establish that every other right ends after three months.

Section 122 separately allows a full refund in specified situations, including where a particular purpose was communicated to the supplier and the goods are found unsuitable for that purpose within a reasonable time after delivery. It also covers certain goods not examined beforehand and rejected within a reasonable time after delivery because they do not match the agreed description, sample, type or quality. Check those conditions rather than inventing a fixed seven-day deadline.

Provide a practical return route and record the reason for the proposed remedy. A voluntary goodwill policy can add benefits but should not remove applicable rights. This entry concerns qualifying consumer goods transactions; services, resale stock, manufacturing inputs and regulated products can require different scope analysis or additional rules.

### CUSTOMER BODY END

**Metadata:** scope=consumer goods quality/return remedies; required facts=buyer purpose, goods/condition, representation, delivery date, alleged defect, communicated use and pre-delivery examination; no universal cancellation window. Related template=TPL-30.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 17-C1 | FCCPA s129(1)(b), PDF p70 | P1/P5 contractual wording cannot remove Act rights. Complaint record is an operational suggestion. |
| 17-C2 | FCCPA ss117,131(1)–(2), PDF pp64,72 | P2 disclosure and conditional quality/specific-purpose rights. |
| 17-C3 | FCCPA s132(1)–(2), PDF p72 | P3 three-month defective/nonconforming-goods route and supplier remedies; no general change-of-mind rule asserted. |
| 17-C4 | FCCPA s122(a)–(b), PDF p66 | P4 separate conditional full-refund routes and reasonable-time wording. |
| 17-C5 | FCCPA s167, definition of consumer, PDF p88; s130, PDF pp71–72 | P5 classification/limits; additional sector requirements are flagged, not determined. |

---

## GUD-18 — How should I handle unfair terms, cancellations and poor service?

### CUSTOMER BODY START

A customer clicking “I agree” does not make every term enforceable. When you sell goods or services to consumers, review whether your terms are excessively one-sided, hide important consequences or attempt to remove rights the law protects. Plain wording helps understanding, but clear presentation cannot make a prohibited exclusion lawful.

Sections 127–129 of the Federal Competition and Consumer Protection Act address unfair terms, prominent notice of certain risk or liability provisions, and prohibited conditions. Give customers a real opportunity to understand relevant provisions before contracting or paying. Do not use a clause to remove statutory remedies or exempt the business from loss attributable to its gross negligence. A false acknowledgement that goods or required documents were received is also not an acceptable shortcut.

For an advance booking, reservation or order, section 120 permits cancellation subject to a reasonable charge. Reasonableness depends on circumstances including the goods or service, notice given, the diligent supplier's ability to find another customer and industry practice. The section prohibits a cancellation fee where the booking cannot be honoured because the intended beneficiary has died or been hospitalised. Do not convert a standard deposit label into an automatic entitlement to keep every payment.

Services have their own standards. Section 130 addresses timely performance, notice of unavoidable delay, reasonable quality and treatment of property entrusted for the work. Where those standards are not met, the consumer may require defects to be remedied or a reasonable portion of the price refunded, considering the extent of the failure.

Write down the agreed scope and timing, keep a complaint route open, and explain the proposed resolution. Preserve relevant records rather than deleting a dispute because an account was closed. This guidance does not decide every contract dispute, authorise a regulated service or replace a transaction-specific assessment of cancellation and remedy rights.

### CUSTOMER BODY END

**Metadata:** scope=consumer terms, advance cancellation and service-quality remedies; required facts=consumer status, term, notice, accepted scope/timing, cancellation reason, supplier mitigation and actual failure; no fixed cancellation percentage. Related template=TPL-30.

| Claim | Exact source locator | Coverage |
|---|---|---|
| 18-C1 | FCCPA ss127–129, PDF pp69–71 | P1–2 unfairness, notice, statutory-right exclusions, gross negligence and false acknowledgements. No assertion that every liability limitation is automatically void. |
| 18-C2 | FCCPA s120(1)–(3), PDF p65 | P3 reasonable cancellation charge and death/hospitalisation exception with beneficiary condition. |
| 18-C3 | FCCPA s130(1)–(2), PDF pp71–72 | P4 service standards and conditional remedy/proportionate-refund route. |
| 18-C4 | FCCPA ss114,127–130, PDF pp62–63,69–72 | P5 scope/complaint record is practical implementation, not a new statutory retention period or mandatory dispute process. |

## Final ingestion checks

Keep all eight IDs distinct. Ingestion must preserve the customer-body boundaries, actual paragraph-to-claim mappings, source hashes and applicability unknowns. Calculate each final body hash after editorial changes. Verify cited pages visually where OCR is unclear, recheck amendments and relevant sector instruments, and run independent factual/challenge review on the final body. A retrieved source, this draft, or a successful renderer is not an eligible publication. No registration, DPO, tax-rate, provider-adequacy or universal retention determination is supplied by this set.
