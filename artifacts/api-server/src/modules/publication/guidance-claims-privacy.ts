import type { GuideClaimMap, GuideSentence, GuideSupport } from "./guidance-claim-map";

/**
 * The claim maps of the five privacy guides, GUD-11 to GUD-15.
 *
 * Each map lists every sentence of its guide in order. A sentence about the law names the passage
 * it rests on and the first and last words of the exact quotation. These guides rest on the Nigeria
 * Data Protection Act 2023 and the Commission's General Application and Implementation Directive
 * 2025 (GAID). Neither text is kept in the repository: a passage is named by its place and checksum
 * (guidance-captured-texts.ts), and a sentence is bound only when a capture of the official file
 * supplies the passage. With no capture, the builder still checks that every word of the guide is
 * placed, and reports each sentence about the law as not bound.
 *
 * These maps were written by reading each sentence against the official text as the project's
 * extractor read it on 21 November 2026. They are a drafter's work, for the two reviews to check:
 * nothing here is a review or an approval.
 */
const s = (text: string, ...support: GuideSupport[]): GuideSentence => ({
  kind: "source_statement",
  text,
  support,
});
const reading = (text: string, ...support: GuideSupport[]): GuideSentence => ({
  kind: "interpretation",
  text,
  support,
});
const practice = (text: string, ...support: GuideSupport[]): GuideSentence =>
  support.length ? { kind: "optional_practice", text, support } : { kind: "optional_practice", text };
const limit = (text: string): GuideSentence => ({ kind: "guide_limit", text });
const q = (passage: string, from: string, to: string, locator: string): GuideSupport => ({
  passage,
  from,
  to,
  locator,
});

// The directive's articles, as their headings name them. A locator that is a heading is checked
// against the passage's own words. The templates' maps quote the same articles
// (template-claims-privacy.ts).
export const gaid = {
  a18: "Article 18: Data Processing Which Requires Consent",
  a19: "Article 19: Consent to Cookies and other Tracking Tools",
  a26: "Article 26: Reliance on Legitimate Interest",
  a27: "Article 27: Consideration Regarding Information to Data Subjects",
  a34: "Article 34: Data Processing Agreement",
  a37: "Article 37: Exercise of Right to Data Portability",
  a45: "Article 45: Cross-Border Data Transfer",
};
const controller = q(
  "NDPA-65-data-controller",
  "“data controller” means",
  "processing of personal data ;",
  "heading: “data controller” means an individual",
);
const s27 = {
  direct: q(
    "NDPA-27",
    "27.—(1) Before a data controller collects",
    "shall inform the data subject of the —",
    "section 27(1)",
  ),
  contents: q(
    "NDPA-27",
    "(a) identity, residence or place of business",
    "section 46 (1) of this Act ; and",
    "section 27(1)(a)–(f)",
  ),
  automated: q(
    "NDPA-27",
    "(g) existence of automated decision-making",
    "challenge such processing.",
    "section 27(1)(g)",
  ),
  indirect: q(
    "NDPA-27",
    "(2) Before a data controller collects personal data, other than directly",
    "disproportionate effort or expense.",
    "section 27(2)",
  ),
};
const s25 = {
  grounds: q("NDPA-25", "25.—(1) Without prejudice", "disclosed.", "section 25(1)"),
  consent: q(
    "NDPA-25",
    "(a) the data subject has given and not withdrawn consent",
    "personal data is to be processed ; or",
    "section 25(1)(a)",
  ),
  contract: q("NDPA-25", "(i) for the performance of a contract", "into a contract,", "section 25(1)(b)(i)"),
  legitimateLimits: q(
    "NDPA-25",
    "(2) Interests in personal data processing shall not be legitimate",
    "in the manner envisaged.",
    "section 25(2)",
  ),
};
const marketingConsent = q(
  "GAID-18-1a",
  "consent is required:",
  "a) For any direct marketing activity;",
  gaid.a18,
);
const noticeIsNotConsent = q(
  "GAID-27",
  "(4) Information to data subjects does not constitute a request for consent.",
  "prior to the processing of personal data.",
  gaid.a27,
);
const minimum = q(
  "NDPA-24",
  "(c) adequate, relevant, and limited to the minimum necessary",
  "collected or further processed ;",
  "section 24(1)(c)",
);
// The same words, from the passage that stops at paragraph (c), for a guide that quotes no more of section 24.
const minimumOnly = q(
  "NDPA-24-1c",
  "(c) adequate, relevant, and limited to the minimum necessary",
  "collected or further processed ;",
  "section 24(1)(c)",
);
const security = q(
  "NDPA-24",
  "(f ) processed in a manner that ensures appropriate security",
  "any form of data breach.",
  "section 24(1)(f)",
);
const s34 = {
  right: q(
    "NDPA-34",
    "34.—(1) A data subject has the right to obtain from a data controller,",
    "without constraint or unreasonable delay —",
    "section 34(1)",
  ),
  confirmation: q(
    "NDPA-34",
    "(a) confirmation as to whether the data controller",
    "and where that is the case —",
    "section 34(1)(a)",
  ),
  copy: q(
    "NDPA-34",
    "(b) a copy of data subject’s personal data",
    "to bear some or all of such costs ;",
    "section 34(1)(b)",
  ),
  correction: q(
    "NDPA-34",
    "(c) the correction or, if correction is not feasible or suitable",
    "or misleading ;",
    "section 34(1)(c)",
  ),
  restriction: q(
    "NDPA-34",
    "(e) restriction of data processing pending —",
    "defense of legal claims.",
    "section 34(1)(e)",
  ),
  erase: q(
    "NDPA-34",
    "(2) A data controller shall erase personal data without undue delay,",
    "lawful basis to retain the personal\ndata.",
    "section 34(2)",
  ),
};
const marketingObjection = q(
  "NDPA-36",
  "(3) Where personal data is processed for direct marketing purposes",
  "processed for such purposes.",
  "section 36(3)–(4)",
);
const complaintNotice = q(
  "NDPA-27",
  "(f ) right to lodge a complaint with the Commission",
  "section 46 (1) of this Act ; and",
  "section 27(1)(f)",
);
const processor = q(
  "NDPA-65-data-processor",
  "“data processor” means",
  "or another data processor ;",
  "heading: “data processor” means an individual",
);
export const s29 = {
  agreement: q(
    "NDPA-29",
    "(2) The measures under subsection (1) include a written agreement",
    "as the case may be.",
    "section 29(2)",
  ),
  engaging: q(
    "NDPA-29",
    "29.—(1) Where a data controller engages the services of a data",
    "engaged data processor —",
    "section 29(1)",
  ),
  duties: q(
    "NDPA-29",
    "(a) complies with the principles and obligations set out in this Act",
    "when a new data processor is engaged.",
    "section 29(1)(a)–(e)",
  ),
  newProcessor: q(
    "NDPA-29",
    "(e) notifies the data controller or engaging data processor",
    "when a new data processor is engaged.",
    "section 29(1)(e)",
  ),
};
const transferRoute = q(
  "NDPA-41-1",
  "41.—(1) A data controller or data processor shall not transfer or permit",
  "section 43 of this Act applies.",
  "section 41(1)",
);
const s41 = {
  route: q(
    "NDPA-41",
    "41.—(1) A data controller or data processor shall not transfer or permit",
    "section 43 of this Act applies.",
    "section 41(1)",
  ),
  record: q(
    "NDPA-41",
    "(2) A data controller or data processor shall record the basis for transfer",
    "section 42 of this Act.",
    "section 41(2)",
  ),
};
const noDecision = q(
  "NDPA-42",
  "(6) The absence of a determination by the Commission",
  "the adequacy of the protections afforded by it.",
  "section 42(6)",
);
const s43routes = q(
  "NDPA-43",
  "43.—(1) In the absence of adequacy of protection under section",
  "giving consent.",
  "section 43(1)",
);
export const privacyClaimMaps: readonly GuideClaimMap[] = [
  {
    id: "GUD-11",
    risk: "privacy",
    sentences: [
      practice(
        "Before collecting names, telephone numbers, delivery details or other personal information, identify who decides why and how it will be used.",
        controller,
      ),
      reading("If that is your business, you are acting as a controller for those purposes.", controller),
      reading(
        "This guidance concerns processing covered by Nigeria's Data Protection Act; a business contact list is not automatically a private household activity.",
        q("NDPA-2", "2.—(1) This Act shall apply", "by automated means or not.", "section 2(1)"),
        q(
          "NDPA-3",
          "3.—(1) This Act shall not apply",
          "solely for personal or household purposes:",
          "section 3(1)",
        ),
      ),
      s(
        "A privacy notice should explain your identity and contact route, each processing purpose and its specific lawful basis, recipients or recipient categories, the retention period, people's rights and their right to complain to the Nigeria Data Protection Commission.",
        s27.contents,
      ),
      s(
        "Explain automated decision-making or profiling where present, including its significance and expected consequences.",
        s27.automated,
      ),
      reading(
        "A statement that you make no significant automated decisions does not answer whether other profiling occurs.",
        s27.automated,
      ),
      s("Give the required information before direct collection.", s27.direct),
      s(
        "For information obtained elsewhere, the Act also requires information before collection, subject to its stated exceptions where the person already has it or providing it is impossible or involves disproportionate effort or expense.",
        s27.indirect,
      ),
      practice("Record the facts behind any exception; do not assume a purchased contact list is exempt."),
      practice("Make the explanation usable at the actual collection point."),
      practice("A short explanation beside a form can link to fuller detail."),
      s(
        "For a shop conversation or an audience needing interpretation, use a form the person can understand.",
        q(
          "GAID-27",
          "(2) In circumstances of exclusive physical events",
          "in the form that the data subject can understand.",
          gaid.a27,
        ),
      ),
      s(
        "GAID also calls for information about processing means, third-party access purposes and an internal remedy contact.",
        q(
          "GAID-27",
          "(3) The information to be provided",
          "data controller or data processor, and",
          gaid.a27,
        ),
      ),
      practice(
        "Start with a table linking each purpose to its data, source, recipients, lawful basis and retention.",
      ),
      practice("Check it against the systems you actually use, including overseas support access."),
      reading(
        "Publishing a notice does not create consent, justify unnecessary collection or prove that security controls exist.",
        q(
          "GAID-27",
          "(4) Information to data subjects does not constitute a request for consent.",
          "prior to the processing of personal data.",
          gaid.a27,
        ),
        q(
          "NDPA-24",
          "(c) adequate, relevant, and limited to the minimum necessary",
          "collected or further processed ;",
          "section 24(1)(c)",
        ),
        q(
          "NDPA-24",
          "(2) A data controller and data processor shall use appropriate technical",
          "of personal data.",
          "section 24(2)",
        ),
      ),
      practice("Complete the business facts before adopting a template."),
    ],
  },
  {
    id: "GUD-12",
    risk: "privacy",
    sentences: [
      reading(
        "Do not choose one lawful basis for your whole business and apply it to every activity.",
        q(
          "NDPA-24-1c",
          "(b) collected for specified, explicit, and legitimate purposes",
          "incompatible with these purposes ;",
          "section 24(1)(b)",
        ),
        s25.consent,
      ),
      practice("Identify each purpose first."),
      reading(
        "Necessary order fulfilment, a specific legal reporting duty and promotional messages can require different analysis.",
        q(
          "NDPA-25",
          "(i) for the performance of a contract",
          "or data processor is subject,",
          "section 25(1)(b)(i)–(ii)",
        ),
        marketingConsent,
      ),
      reading(
        "A privacy notice tells people what happens; it is not permission for everything described in it.",
        noticeIsNotConsent,
      ),
      s(
        "The Data Protection Act recognises consent and specified necessity grounds, including contract, legal obligation, vital interests, public tasks and legitimate interests.",
        s25.grounds,
      ),
      reading(
        "Each ground has conditions.",
        q("NDPA-25", "(b) the processing is necessary", "necessary —", "section 25(1)(b)"),
        s25.legitimateLimits,
      ),
      reading(
        "Merely putting processing into your terms does not make it necessary for a contract.",
        s25.contract,
      ),
      reading(
        "Where you propose legitimate interests, document the interest, necessity, effects on people and the required assessment; do not treat your commercial preference as overriding their rights or reasonable expectations.",
        q(
          "GAID-26-2c",
          "a) Carry out Legitimate Interest Assessment",
          "the legitimate interest pursued;",
          gaid.a26,
        ),
        s25.legitimateLimits,
      ),
      s(
        "If you rely on consent, make the request clear, specific and affirmative.",
        q(
          "NDPA-26",
          "(6) A request for consent shall be in clear and simple language",
          "confirmation ; and",
          "section 26(6)–(7)(a)",
        ),
        s25.consent,
      ),
      s(
        "Silence, inactivity and a preselected confirmation do not establish it.",
        q("NDPA-26", "(3) Silence or inactivity of the data subject", "constitute consent.", "section 26(3)"),
        q(
          "NDPA-26",
          "(a) shall be in the affirmative, and not based on a pre-selected",
          "confirmation ; and",
          "section 26(7)(a)",
        ),
      ),
      s(
        "Keep evidence of the choice and make withdrawal as easy as giving consent.",
        q("NDPA-26", "26.—(1) A data controller shall bear the burden of proof", "consent.", "section 26(1)"),
        q(
          "NDPA-35",
          "(2) The data controller shall ensure that it is as easy",
          "as to give consent.",
          "section 35(2)",
        ),
      ),
      reading(
        "Withdrawal does not invalidate earlier lawful processing, but you must stop the activity that depends on that consent; it does not manufacture a replacement basis.",
        q(
          "NDPA-26",
          "(5) The withdrawal of consent under subsection (4) shall not affect",
          "consent.",
          "section 26(5)",
        ),
        s25.consent,
      ),
      s("GAID requires consent for direct marketing.", marketingConsent),
      s(
        "Provide a separate usable choice and stop marketing, including related profiling, when the person objects.",
        marketingConsent,
        q(
          "NDPA-36",
          "(3) Where personal data is processed for direct marketing purposes",
          "processed for such purposes.",
          "section 36(3)–(4)",
        ),
      ),
      practice("An order update should not become an advertising message after an opt-out."),
      s(
        "For website cookies and similar tracking, provide clear information and an accept/reject choice where required.",
        q("GAID-19", "(2) Except as otherwise provided by this GAID", "requires consent.", gaid.a19),
        q("GAID-19", "All other forms of", "presented to the data subject.", gaid.a19),
        q(
          "GAID-19",
          "b) Make cookie information clear and easy to understand;",
          "c) Notify users of the presence and purpose of the cookies;",
          gaid.a19,
        ),
        q("GAID-19", "(8) The Commission shall treat any personal data tracking tool", "cookies", gaid.a19),
      ),
      s(
        "GAID's narrow necessary-cookie treatment concerns core functions such as security, network stability and accessibility, with additional restrictions concerning sensitive, financial and privately stored data.",
        q(
          "GAID-19",
          "(5) Necessary cookies which do not process sensitive data",
          "and accessibility.",
          gaid.a19,
        ),
      ),
      reading(
        "Calling analytics “necessary” does not settle the question.",
        q("GAID-19", "(6) In this article “necessary cookies” means", "and accessibility.", gaid.a19),
      ),
      practice("Before launching a new purpose, review the actual data and audience."),
      reading(
        "Children's data, sensitive information, significant automated decisions and international transfers need their additional conditions checked.",
        q(
          "NDPA-31-1",
          "31.—(1) Where a data subject is a child",
          "to rely on consent under this Act.",
          "section 31(1)",
        ),
        q(
          "NDPA-30-1a",
          "30.—(1) Without prejudice",
          "sensitive personal data, unless the —",
          "section 30(1)",
        ),
        q(
          "NDPA-37-1",
          "37.—(1) A data subject shall have the right not to be subject to a decision",
          "concerning the data subject.",
          "section 37(1)",
        ),
        q(
          "NDPA-41-1",
          "41.—(1) A data controller or data processor shall not transfer or permit",
          "to another country, unless —",
          "section 41(1)",
        ),
      ),
      reading(
        "A completed consent box does not resolve every condition or excuse excessive collection.",
        minimumOnly,
      ),
    ],
  },
  {
    id: "GUD-13",
    risk: "privacy",
    sentences: [
      practice(
        "When someone asks what information you hold, wants an error corrected or asks you to stop using it, route the request to a responsible person.",
      ),
      practice("Record when it arrived, what is requested and which systems may contain the information."),
      reading(
        "Confirm identity or authority proportionately before disclosure; collecting excessive identification can create another privacy problem.",
        security,
        minimum,
      ),
      s("The Data Protection Act gives access rights without constraint or unreasonable delay.", s34.right),
      s(
        "A person can seek confirmation of processing, relevant information about it and a copy of their data.",
        s34.confirmation,
        s34.copy,
      ),
      reading(
        "The Act addresses unreasonable copying costs, but this is not permission to charge an automatic access fee.",
        s34.copy,
      ),
      practice("Explain any proposed limitation using the actual provision and facts."),
      s(
        "For inaccurate, incomplete, outdated or misleading data, consider correction or appropriate deletion.",
        s34.correction,
      ),
      s(
        "Erase data without undue delay where it is no longer necessary for its purposes or there is no other lawful basis to retain it.",
        s34.erase,
      ),
      reading(
        "Do not promise that every deletion request removes every record immediately: identify any continuing lawful basis, limit the retained use and explain the outcome.",
        s34.erase,
      ),
      s(
        "Restriction may be relevant while a request, objection or legal claim is resolved.",
        s34.restriction,
      ),
      s(
        "An objection to direct marketing requires that use, including related profiling, to stop.",
        marketingObjection,
      ),
      reading(
        "Other objections require their own assessment; they are not automatically defeated by saying that the business has a legitimate interest.",
        q(
          "NDPA-36",
          "36.—(1) A data subject shall have the right to object",
          "of the data subject.",
          "section 36(1)–(2)",
        ),
      ),
      reading(
        "Portability is distinct from ordinary access.",
        q(
          "NDPA-38",
          "(2) Right of data portability under this Act shall entitle the data",
          "from one data controller to another.",
          "section 38(2)",
        ),
        s34.copy,
      ),
      s(
        "GAID applies it to data the person provided under consent or necessary contractual processing, with qualifications including other people's rights and public duties.",
        q(
          "GAID-37",
          "(2) The right to data portability shall apply where",
          "instrument issued by the Commission.",
          gaid.a37,
        ),
      ),
      s(
        "Significant decisions based solely on automation also carry separate safeguards, including human intervention and a chance to contest the decision.",
        q(
          "NDPA-37",
          "37.—(1) A data subject shall have the right not to be subject to a decision",
          "concerning the data subject.",
          "section 37(1)",
        ),
        q(
          "NDPA-37",
          "(3) The data controller shall implement suitable measures",
          "(c) contest the decision.",
          "section 37(3)",
        ),
      ),
      practice(
        "Give a clear response and a working complaint route.",
        complaintNotice,
        q(
          "GAID-27",
          "i) Access to prompt internal remediation",
          "Nigeria Data Protection Commission.",
          gaid.a27,
        ),
      ),
      practice(
        "Preserve a limited record of your decision and follow through with relevant processors.",
        q(
          "NDPA-29",
          "(b) assists the data controller or data processor, as the case may be",
          "under Part VI ;",
          "section 29(1)(b)",
        ),
      ),
      limit(
        "A workflow checklist is useful, but it cannot replace the legal conditions or create an invented universal response deadline.",
      ),
    ],
  },
  {
    id: "GUD-14",
    risk: "privacy",
    sentences: [
      reading(
        "A payroll operator, hosting service or customer-support supplier may process personal data on your instructions.",
        processor,
      ),
      practice("Check the real role before using a data processing agreement."),
      reading(
        "A supplier deciding its own independent purposes, or sharing decisions with you, should not simply be labelled your processor to fit a standard form.",
        controller,
        processor,
      ),
      s(
        "Where a controller engages a processor, or one processor engages another, section 29 of the Data Protection Act requires measures including a written agreement.",
        s29.engaging,
        s29.agreement,
      ),
      s(
        "The engaging party must ensure the processor meets applicable obligations, assists with people's rights, uses appropriate security, supplies compliance information and notifies it when another processor is engaged.",
        s29.duties,
      ),
      reading(
        "Outsourcing does not make these responsibilities disappear.",
        s29.engaging,
        q("GAID-34", "every data controller or data processor shall", "carry out data processing.", gaid.a34),
      ),
      practice(
        "Describe the service, people and data involved, processing operations, purposes, lawful bases, locations, duration and authorised instructions.",
        q(
          "GAID-34",
          "e) Purpose of data processing;",
          "i) Responsibilities of parties under the DPA;",
          gaid.a34,
        ),
      ),
      practice(
        "Set out actual confidentiality and security measures, including access, incident handling, return or deletion and recovery.",
        q(
          "GAID-34",
          "j) Technical and Organisational Measures for data protection",
          "schedule to the DPA);",
          gaid.a34,
        ),
      ),
      practice("Identify subprocessors and the process for changes.", s29.newProcessor),
      practice(
        "A promise of “industry-standard security” is less useful than an accurate schedule that can be checked.",
      ),
      s(
        "GAID's agreement requirements also cover potential risks, a relevant impact-assessment outcome, compliance due diligence, specific restrictions, indemnity, insurance, force majeure and dispute resolution.",
        q("GAID-34", "k) The outcome of a DPIA where relevant;", "t) Dispute Resolution.", gaid.a34),
      ),
      practice("Complete those subjects or precisely incorporate available agreed clauses."),
      practice(
        "Do not invent insurance, a registration certificate or a finding that every small supplier must register.",
      ),
      practice("Agree operational contacts and response arrangements that allow statutory duties to be met."),
      reading(
        "A processor must notify its engaging party on becoming aware of a personal-data breach and respond to information requests; a contractual reporting target must not permit waiting beyond that obligation.",
        q(
          "NDPA-40",
          "40.—(1) Where a personal data breach has occurred",
          "under this section.",
          "section 40(1)",
        ),
      ),
      practice(
        "Before sharing real records, test the arrangements against the supplier's actual service and access locations.",
      ),
      practice("Keep the signed version and supporting evidence."),
      reading(
        "This agreement does not itself approve an international transfer, establish a lawful basis, complete a required impact assessment or prove that the promised controls work.",
        transferRoute,
        q("NDPA-25", "25.—(1) Without prejudice", "processing shall be lawful, where —", "section 25(1)"),
        q(
          "NDPA-28",
          "28.—(1) Where the processing of personal data may likely result in",
          "carry out a data privacy impact assessment.",
          "section 28(1)",
        ),
      ),
    ],
  },
  {
    id: "GUD-15",
    risk: "privacy",
    sentences: [
      practice("Before sending personal data abroad, map where it can actually go."),
      practice(
        "A Nigerian billing address for a supplier does not establish where its hosting, backups, technical support or subcontractors operate.",
      ),
      practice("Ask for the relevant countries, recipient roles and onward-access arrangements."),
      practice(
        "Treat an unanswered location question as unresolved, rather than filling your notice with a guessed country.",
      ),
      s(
        "For transfers from Nigeria, the Data Protection Act requires an applicable route under sections 41–43.",
        s41.route,
      ),
      s(
        "Section 41 recognises adequate protection through specified mechanisms, or a qualifying section 43 condition.",
        s41.route,
      ),
      s("Record the transfer basis and adequacy assessment.", s41.record),
      reading(
        "A provider's contract or foreign certification is not automatically a finding that the Act's protection requirements are met.",
        noDecision,
        s41.route,
      ),
      s(
        "Adequacy involves matters such as enforceable rights, accessible redress, public-authority access, effective law and supervision.",
        q(
          "NDPA-42",
          "(2) The adequacy of protection referred to in subsection (1) shall be",
          "powers ; and",
          "section 42(2)",
        ),
      ),
      s("The absence of a Commission decision does not establish adequacy.", noDecision),
      reading(
        "GAID points to its transfer guidance and approved transfer instruments; a familiar overseas privacy label is not a substitute for checking the actual mechanism and its scope.",
        q(
          "GAID-45",
          "(2) Pending the issuance of any regulatory instrument",
          "recognised under the NDP Act.",
          gaid.a45,
        ),
        q(
          "GAID-SCHEDULE-5-GROUNDS",
          "1. There are various grounds for data transfer, namely:",
          "c) Other lawful bases.",
          "GUIDANCE ON CROSS-BORDER DATA TRANSFER",
        ),
      ),
      s(
        "Where adequate protection is absent, section 43 contains conditional routes, including informed, unwithdrawn consent after explanation of the relevant risks and narrowly defined necessity grounds.",
        s43routes,
      ),
      s(
        "GAID Article 18 also addresses consent for destinations without an adequacy decision, while Article 45 makes the Act's transfer provisions governing.",
        q(
          "GAID-18",
          "e) Before personal data may be transferred to a country",
          "has not made an adequacy decision; and",
          gaid.a18,
        ),
        q(
          "GAID-45",
          "(1) Part VIII of the NDP Act provides for cross-border data transfer.",
          "personal data from Nigeria.",
          gaid.a45,
        ),
      ),
      reading(
        "Do not turn that combination into a blanket statement that every transfer is allowed by consent, or that consent is the only statutory route.",
        s43routes,
        s41.route,
      ),
      practice("Resolve the applicable conditions before sending the data."),
      practice(
        "Keep a practical transfer record: data, purpose, recipients, destinations, safeguards, legal route, evidence and review triggers.",
        s41.record,
      ),
      practice("Limit data and access, and check changes in suppliers or support locations.", minimumOnly),
      limit(
        "This entry clears no country or provider, supplies no approved contractual clauses and does not replace separate conditions for sensitive data, children's data or sector-specific restrictions.",
      ),
    ],
  },
];
