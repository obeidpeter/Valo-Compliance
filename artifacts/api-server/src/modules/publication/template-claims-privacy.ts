import type { GuideSupport } from "./guidance-claim-map";
import { gaid, s29 } from "./guidance-claims-privacy";
import type { TemplateClaimMap, TemplateSentence } from "./template-claim-map";

/**
 * The claim maps of the privacy templates, starting with TPL-31, the data processing agreement
 * (docs/architecture/reviewed-route.md, part 4).
 *
 * Each map lists every sentence of its template in order: the agreement's clauses, its headings, and
 * each cell of its schedules. A sentence about the law names the passage it rests on and the first and
 * last words of the exact quotation. These templates rest on the Nigeria Data Protection Act 2023 and
 * the Commission's General Application and Implementation Directive 2025, whose words are not kept in
 * the repository: a passage is named by its place and checksum (guidance-captured-texts.ts), and a
 * sentence is bound only when a capture of the official file supplies the passage. Every quotation
 * here is one the privacy guides' maps already make (guidance-claims-privacy.ts), read against the
 * official text as the project's extractor read it on 21 November 2026.
 *
 * These maps are a drafter's work, for the two reviews to check: nothing here is a review or an
 * approval.
 */
const reading = (text: string, ...support: GuideSupport[]): TemplateSentence => ({
  kind: "interpretation",
  text,
  support,
});
const term = (text: string): TemplateSentence => ({ kind: "party_term", text });
const practice = (text: string): TemplateSentence => ({ kind: "optional_practice", text });
const limit = (text: string): TemplateSentence => ({ kind: "template_limit", text });
const none = (text: string): TemplateSentence => ({ kind: "not_a_claim", text });
const q = (passage: string, from: string, to: string, locator: string): GuideSupport => ({
  passage,
  from,
  to,
  locator,
});

/** The engaging party's duty under section 29(1) and the directive's Article 34, as GUD-14 quotes them. */
const accountable = q(
  "GAID-34",
  "every data controller or data processor shall",
  "carry out data processing.",
  gaid.a34,
);
/** A processor's duty to tell its engaging party of a breach, section 40(1), as GUD-14 quotes it. */
const breachNotice = q(
  "NDPA-40",
  "40.—(1) Where a personal data breach has occurred",
  "under this section.",
  "section 40(1)",
);

/** The rights and consent a privacy notice describes, quoted as the privacy guides quote them (GUD-11 to GUD-15). */
/** Withdrawing consent leaves earlier lawful processing as it was, section 26(5). */
const withdrawalKeepsEarlier = q(
  "NDPA-26",
  "(5) The withdrawal of consent under subsection (4) shall not affect",
  "consent.",
  "section 26(5)",
);
/** Consent counts as a lawful basis only while it is given and not withdrawn, section 25(1)(a). */
const consentGround = q(
  "NDPA-25",
  "(a) the data subject has given and not withdrawn consent",
  "personal data is to be processed ; or",
  "section 25(1)(a)",
);
/** A person's rights to confirmation, a copy, correction and restriction, section 34(1), and erasure, section 34(2). */
const confirmation = q(
  "NDPA-34",
  "(a) confirmation as to whether the data controller",
  "and where that is the case —",
  "section 34(1)(a)",
);
const copy = q(
  "NDPA-34",
  "(b) a copy of data subject’s personal data",
  "to bear some or all of such costs ;",
  "section 34(1)(b)",
);
const correction = q(
  "NDPA-34",
  "(c) the correction or, if correction is not feasible or suitable",
  "or misleading ;",
  "section 34(1)(c)",
);
const restriction = q(
  "NDPA-34",
  "(e) restriction of data processing pending —",
  "defense of legal claims.",
  "section 34(1)(e)",
);
const erase = q(
  "NDPA-34",
  "(2) A data controller shall erase personal data without undue delay,",
  "lawful basis to retain the personal\ndata.",
  "section 34(2)",
);
/** Portability, section 38(2), and where the directive applies it, Article 37(2). */
const portability = q(
  "NDPA-38",
  "(2) Right of data portability under this Act shall entitle the data",
  "from one data controller to another.",
  "section 38(2)",
);
const portabilityScope = q(
  "GAID-37",
  "(2) The right to data portability shall apply where",
  "instrument issued by the Commission.",
  gaid.a37,
);
/** The right to object, section 36(1)–(2), and the safeguards for decisions made by automated means alone, section 37. */
const objection = q(
  "NDPA-36",
  "36.—(1) A data subject shall have the right to object",
  "of the data subject.",
  "section 36(1)–(2)",
);
const automated = q(
  "NDPA-37",
  "37.—(1) A data subject shall have the right not to be subject to a decision",
  "concerning the data subject.",
  "section 37(1)",
);
const contest = q(
  "NDPA-37",
  "(3) The data controller shall implement suitable measures",
  "(c) contest the decision.",
  "section 37(3)",
);
/** The right to complain to the Commission, which a notice must tell a person of, section 27(1)(f). */
const complaint = q(
  "NDPA-27",
  "(f ) right to lodge a complaint with the Commission",
  "section 46 (1) of this Act ; and",
  "section 27(1)(f)",
);

/** A schedule's table, row by row: each label states nothing, and so does a plain blank. */
const blank = (label: string, entry = "[Details]") => [none(label), none(entry)];

export const privacyTemplateClaimMaps: readonly TemplateClaimMap[] = [
  {
    id: "TPL-31",
    // An agreement between two parties: EDP-005 asks it to expose what it assumes and leaves open.
    risk: "contracts",
    contract: {
      parties: [
        "The Controller decides why personal data is processed for the service in Schedule A, and the Processor handles that data only on the Controller's behalf.",
        "The parties are not joint controllers, and neither processes the service data for purposes of its own.",
      ],
      use: [
        "It sits beside a service agreement between the same parties.",
        "The parties complete Schedules A to D with their real service, data, measures, subprocessors and locations before they sign.",
        "Every time and target in it is one the parties agree; the template sets none of them.",
      ],
      openClauses: [
        "the channel for the Controller's instructions (clause 2)",
        "the channel for notice of a new subprocessor, and the approval or objection process and its period (clause 4)",
        "the contact for individuals' requests, and the response arrangements (clause 5)",
        "the escalation channel for a breach, and the parties' reporting target (clause 6)",
        "the processing and remote-access locations (clause 7)",
        "the notice, confidentiality, security and cost arrangements for an inspection or assessment (clause 8)",
        "the return or deletion schedule, the backup expiry and restore controls, and the evidence that deletion is complete (clause 9)",
        "the processing description, the implemented controls, the subprocessors and locations, and the due diligence, risks and agreed terms (Schedules A to D)",
      ],
    },
    ownNumbers: [
      ...[
        "1. Scope and instructions",
        "2. Controller responsibilities",
        "3. People and security",
        "4. Other processors",
        "5. Individuals' requests and assessments",
        "6. Security incidents",
        "7. Locations and transfers",
        "8. Records and assurance",
        "9. Ending processing",
        "10. Agreement management",
      ].map((text) => ({ text, why: "The agreement's own clause number." })),
      { text: "Record 1", why: "The first row of Schedule C's table, as the document numbers it." },
    ],
    sentences: [
      none("Data processing agreement"),
      none("Agreement reference: [reference] · Effective date: [date]"),
      none("Controller: [legal name, address, authorised contact]"),
      none("Processor: [legal name, address, authorised contact]"),
      none("Related service agreement: [title, reference and date]"),

      none("1. Scope and instructions"),
      term(
        "This agreement governs the Processor's handling of personal data on the Controller's behalf for the service described in Schedule A.",
      ),
      term("The Controller determines the relevant purposes and documents lawful instructions."),
      term(
        "The Processor processes that data only on those instructions, including approved instructions about access, disclosure, deletion and transfers, unless applicable law requires otherwise.",
      ),
      term("Where lawful, the Processor informs the Controller of that requirement before acting."),
      term(
        "If an instruction appears inconsistent with applicable data-protection requirements, the Processor promptly alerts the Controller, explains the concern, and pauses the affected action while the parties resolve it where a pause is lawful.",
      ),
      term(
        "Neither party treats this agreement as permission to use service data for unrelated advertising, sale, general model training or its own new purposes.",
      ),

      none("2. Controller responsibilities"),
      term(
        "The Controller identifies the applicable lawful basis and any additional conditions, gives the required information to individuals, and supplies only data necessary for the agreed purpose.",
      ),
      term(
        "It gives instructions through [authorised channel] and keeps the instruction and authority record current.",
      ),
      term(
        "The Controller assesses whether a high-risk activity requires an impact assessment or other additional measure.",
      ),
      term("The Processor supplies relevant information and assistance;"),
      limit("this agreement does not itself complete that assessment."),

      none("3. People and security"),
      term(
        "The Processor limits access to authorised people who need it for the service and are bound to protect confidentiality.",
      ),
      term(
        "It maintains the specific technical and organisational measures in Schedule B and reviews whether they remain proportionate to the data and risks.",
      ),
      term(
        "It must not materially reduce the agreed protection without informing the Controller and resolving the effect on the service.",
      ),
      term(
        "The Processor separates customers' data appropriately, manages access changes, records relevant security events, and protects data during transfer, storage, restoration and disposal as described in Schedule B.",
      ),
      term(
        "The parties do not describe an unimplemented control or unverified certification as being in place.",
      ),

      none("4. Other processors"),
      term("Approved subprocessors and their roles, locations and safeguards are listed in Schedule C."),
      term(
        "Before engaging a new subprocessor, the Processor notifies the Controller through [channel] with enough information to assess the change and follows [specific approval/objection process and agreed period].",
      ),
      term("Subcontracting requires written terms appropriate to these obligations."),
      term(
        "If a reasonable protection concern cannot be resolved, the parties agree a safe alternative or the affected service ends under the service agreement;",
      ),
      term("notification alone does not override an agreed restriction."),

      none("5. Individuals' requests and assessments"),
      term(
        "The Processor promptly forwards a request concerning the Controller's data to [contact], unless instructed otherwise or legally required to respond directly.",
      ),
      term("It does not disclose data to an unverified requester."),
      term(
        "It provides reasonable assistance to locate, access, correct, restrict, export or delete relevant data and to support lawful objections, investigations and assessments.",
      ),
      term("The agreed operational response arrangements are [arrangements];"),
      term("they must allow the Controller to meet applicable requirements."),

      none("6. Security incidents"),
      term(
        "On becoming aware of a personal-data breach affecting the service, the Processor notifies the Controller using the agreed escalation channel [channel].",
      ),
      term("The parties' additional operational reporting target is [explicit agreed target];"),
      // A caution drawn from section 40(1): an agreed target never outlasts the processor's own duty.
      reading(
        "it does not permit waiting beyond an earlier statutory duty or delaying the initial notification.",
        breachNotice,
      ),
      term("Initial information may be supplemented as the investigation develops."),
      term(
        "The notification includes, so far as known, what happened, the categories and approximate numbers of affected people and records, likely consequences, containment and proposed remedies, contact details and outstanding uncertainties.",
      ),
      term(
        "The Processor preserves appropriate evidence, keeps the required breach record, responds to the Controller's information requests, takes reasonable containment measures, and assists the Controller's risk assessment and legally required notifications.",
      ),
      term("It must not delay the initial warning merely to complete a final investigation."),
      term("Neither party falsely reports an unconfirmed event as a completed finding."),

      none("7. Locations and transfers"),
      term("Processing and remote-access locations are [list]."),
      term(
        "A proposed new location or international transfer requires the agreed instruction and a verified applicable transfer arrangement recorded in Schedule C or an addendum.",
      ),
      limit("This agreement alone is not a finding of adequacy or permission to transfer to any country."),
      term("Relevant onward transfers and subcontractor access must be included in the assessment."),

      none("8. Records and assurance"),
      term(
        "The Processor supplies information reasonably needed to demonstrate its performance of these obligations.",
      ),
      term(
        "The Controller may assess the agreed controls through proportionate documentation review and, where reasonably necessary, an appropriately scoped inspection or independent assessment under [notice, confidentiality, security and cost arrangements].",
      ),
      term(
        "These arrangements must not prevent information reasonably required by law or lawful regulator access.",
      ),
      term("Reports must distinguish tested controls from planned controls."),

      none("9. Ending processing"),
      term(
        "At the end of the service, or on a lawful instruction, the Processor returns or deletes the specified personal data according to the Controller's choice and the agreed schedule [schedule].",
      ),
      term(
        "It identifies any specific lawful retention exception, restricts retained copies to that purpose, and states when they will be deleted.",
      ),
      term("Backups follow [actual expiry and restore controls];"),
      term("deleted data must not silently return to active use following restoration."),
      term("The Processor provides [defined completion evidence]."),

      none("10. Agreement management"),
      term("The parties keep authorised contacts, schedules and instructions current."),
      term("Amendments are recorded in writing by authorised representatives."),
      term(
        "Where the service agreement conflicts with this agreement on personal-data protection, this agreement prevails to the extent necessary for that subject, subject to applicable law.",
      ),
      term(
        "Schedule D records the parties' due diligence, risk assessment and agreed indemnity, insurance, force-majeure and dispute provisions, either in full or through precise incorporated clauses supplied with this agreement.",
      ),
      term("An unanswered item is not an agreed exclusion."),
      limit("No clause removes statutory responsibility;"),
      // The reading GUD-14 gives the same passages: outsourcing does not make the duties disappear.
      reading(
        "engaging a subprocessor does not eliminate the engaging party's accountability.",
        s29.engaging,
        accountable,
      ),

      none("Schedule A — Processing description"),
      ...blank("Item", "Agreed details"),
      ...blank("Service and specific purposes"),
      none("Purpose-specific lawful bases and additional conditions"),
      practice("[Actual basis/condition and supporting assessment; not a list of alternatives]"),
      none("Processing operations"),
      practice("[Collection, storage, access, transformation, export or deletion actually required]"),
      ...blank("Categories of individuals"),
      none("Data categories"),
      practice("[Details; sensitive and children's data identified separately]"),
      ...blank("Duration and end trigger"),
      ...blank("Lawful instruction channel and authorised contacts"),
      ...blank("Return format and deletion arrangements"),

      none("Schedule B — Implemented controls"),
      none("Control area"),
      none("Actual measure"),
      none("Responsible person or team"),
      none("Evidence and review date"),
      ...[
        "Access and confidentiality",
        "Storage/transmission protection",
        "Isolation, logging and incident response",
        "Backup, recovery and deletion",
      ].flatMap((area) => [none(area), none("[Measure]"), none("[Owner]"), none("[Evidence]")]),

      none("Schedule C — Subprocessors and locations"),
      none("Record 1"),
      ...blank("Field", "Entry"),
      ...blank("Organisation"),
      ...blank("Service and data accessed"),
      ...blank("Processing/access countries"),
      none("Agreed transfer arrangement if required"),
      practice("[Verified arrangement or explained N/A]"),
      ...blank("Authorisation and change process", "[Record]"),

      none("Schedule D — Due diligence, risks and agreed terms"),
      ...blank("Item", "Completed record or exact incorporated clause"),
      none("Compliance due diligence"),
      practice(
        "[Evidence for each party; assess applicable NDPC registration requirements and verify registration evidence where applicable.",
      ),
      practice("Do not assume every SME must register or that a certificate alone proves compliance.]"),
      none("Potential risks and mitigation"),
      practice("[Risks to people, affected processing and measures]"),
      none("Relevant impact assessment"),
      practice(
        "[Assessment reference, outcome and unresolved actions; or a supported explanation of why one is not required]",
      ),
      none("Specific processing restrictions"),
      practice("[Prohibited uses, access, disclosures and other agreed limits]"),
      none("Indemnity"),
      practice(
        "[Express negotiated allocation or precise incorporated clause, subject to mandatory law; no invented unlimited indemnity]",
      ),
      none("Insurance"),
      practice(
        "[Agreed requirements and verified actual coverage/limits, or expressly recorded absence of cover; do not invent a policy]",
      ),
      none("Force majeure"),
      practice(
        "[Defined events, notice, mitigation and service consequences; no automatic suspension of statutory data duties]",
      ),
      none("Dispute resolution"),
      practice(
        "[Applicable law, contacts, escalation and lawful forum/process, preserving regulator powers and individuals' rights]",
      ),

      none("For the Controller: [authorised name, role, signature, date]"),
      none("For the Processor: [authorised name, role, signature, date]"),
    ],
  },
  {
    id: "TPL-29",
    // A business's notice of its own processing. What it says of itself and of what it does are its own
    // statements, placed as its terms: they say nothing about what the law requires. The rights and the
    // consent rules it describes are readings of the Act, each bound to a passage the privacy guides quote.
    risk: "privacy",
    ownNumbers: [
      { text: "Record 1", why: "The first row of the purposes table, as the document numbers it." },
      { text: "Record 2", why: "The second row of the purposes table, as the document numbers it." },
    ],
    sentences: [
      none("Privacy notice"),
      none("[Legal business name], trading as [trading name, if applicable]"),
      none("Effective date: [date] · Notice version: [version]"),
      none("Applies to: [website, shop, service and audience covered]"),

      none("Who is responsible for your information"),
      term(
        "[Legal business name] decides why and how the personal information described in this notice is used.",
      ),
      term("Our business address is [address]."),
      term("Contact us at [privacy email], [telephone or accessible alternative] or [postal address]."),
      term(
        "Our representative or data protection officer, where one has actually been appointed for this processing, can be contacted at [details; remove if inapplicable].",
      ),
      term("This notice explains our own processing for [scope]."),
      term(
        "Where we handle information solely on another organisation's instructions, that organisation's notice explains its purposes;",
      ),
      term("contact [appropriate route] to identify it and direct a request correctly."),

      none("What we use and why"),
      term(
        "We collect information using [actual website forms, telephone, in-person records, connected systems or other means].",
      ),
      none("The following table describes each distinct purpose."),
      term("We do not treat your reading this notice as consent."),
      none("Record 1"),
      none("Field"),
      none("Entry"),
      none("Purpose"),
      none("[One defined purpose]"),
      none("Information used"),
      none("[Only the data actually required]"),
      none("Where it comes from"),
      none("[You / named source or source category]"),
      none("Specific lawful basis and why it applies"),
      none("[Applicable basis and purpose-specific explanation]"),
      none("Retention period and when it starts"),
      none("[Determinate period and trigger]"),
      none("Record 2"),
      none("Field"),
      none("Entry"),
      none("Purpose"),
      none("[Next purpose]"),
      none("Information used"),
      none("[Data categories]"),
      none("Where it comes from"),
      none("[Source]"),
      none("Specific lawful basis and why it applies"),
      none("[Basis and explanation]"),
      none("Retention period and when it starts"),
      none("[Period and trigger]"),
      term(
        "Information marked [identify required fields] is necessary for [specific service, contract or legal requirement].",
      ),
      term("Without it, [actual consequence]."),
      term("Other information is optional;"),
      term("choosing not to provide it has [actual consequence or none]."),
      term(
        "We will explain a new purpose and its lawful basis before using information for that new purpose where required.",
      ),
      term("Where we rely on consent, we request it separately for the identified purpose."),
      term("You can withdraw it through [a route as easy to use as the original consent method]."),
      reading(
        "Withdrawal does not retrospectively undo processing already carried out lawfully.",
        withdrawalKeepsEarlier,
      ),
      term(
        "We stop the processing that depends on that consent and explain any independently applicable basis for retaining particular records;",
      ),
      reading("withdrawal does not itself create a replacement lawful basis.", consentGround),

      none("Who receives information"),
      term("We restrict access to people and organisations with a need for the stated purpose."),
      none("Recipient or recipient category"),
      none("Information shared"),
      none("Reason for access"),
      none("Location of processing or access"),
      none("[Actual service provider / recipient]"),
      none("[Data categories]"),
      none("[Purpose]"),
      none("[Country or countries]"),
      practice(
        "[If information can be accessed outside Nigeria, describe the actual destinations, recipient roles and verified transfer arrangements, and explain how a person can request relevant information about those safeguards. If there is no such access, state that only after checking hosting, support, backup and subcontractor access.]",
      ),
      term("We may disclose information to a competent authority when there is a valid legal requirement."),
      term("We assess the request and limit disclosure to the information the requirement covers."),

      none("Marketing, cookies and similar technology"),
      practice(
        "[If direct marketing is used: describe its purpose and channels, the separate consent choice and consent record, and the usable withdrawal/objection control. Do not treat a purchase, account creation or acceptance of this notice as marketing consent.]",
      ),
      term("To stop direct marketing, use [unsubscribe or equivalent easy channel]."),
      term(
        "This does not stop essential messages about an existing order or service where those messages have a separate lawful purpose;",
      ),
      term("those messages do not include marketing after you have opted out."),
      practice(
        "[For a website using cookies or comparable tracking: link the accurate list of purposes, providers, durations and controls. Explain the conspicuous accept/reject choice and withdrawal route for optional technologies, and enable them only after the required choice. Separately identify any narrowly necessary technology and its verified treatment; do not label analytics, advertising or tracking necessary merely because it is useful. If none are used, remove this paragraph.]",
      ),

      none("Automated decisions and sensitive information"),
      practice(
        "[Describe any automated decision-making or profiling actually used, including its purpose, information used, significance and expected consequences. Separately identify whether any decision is based solely on automated processing and has legal or similarly significant effects; for such decisions, explain the verified condition permitting it and the routes to human intervention, to express a view and to contest the decision. If none exists, state only the fact that has been checked: absence of solely automated significant decisions does not imply absence of all profiling or automation.]",
      ),
      practice(
        "[If sensitive information or children's information is processed, explain the actual categories, purpose, applicable additional condition, safeguards and audience-appropriate information. Do not state that all business customers are adults without evidence. Remove this paragraph only if these processing activities are genuinely outside scope.]",
      ),

      none("Keeping information safe and ending retention"),
      term(
        "We use [accurate, proportionate access, storage and transmission safeguards that are actually in place].",
      ),
      term("These measures reduce risk;"),
      term("no system can be promised to be completely secure."),
      term(
        "We restrict retained records when their original use has ended and delete or genuinely anonymise them when their retention period expires, unless an identified lawful reason requires continued retention.",
      ),
      term("Such exceptions are limited to the relevant information and reviewed."),

      none("Your choices and requests"),
      reading(
        "You may ask whether we hold your information and request access or a copy, correction, erasure or restriction.",
        confirmation,
        copy,
        correction,
        restriction,
        erase,
      ),
      reading(
        "Where the portability right applies to information you provided for consent-based or contractual processing, you may request a structured, commonly used, machine-readable copy and transfer to another controller, directly where technically possible and without prejudicing others' rights.",
        portability,
        portabilityScope,
      ),
      reading(
        "You may object to processing, withdraw consent where consent is used, and challenge qualifying automated decisions.",
        objection,
        withdrawalKeepsEarlier,
        automated,
        contest,
      ),
      term("Some rights depend on the circumstances and applicable law;"),
      term(
        "we will explain any lawful limitation and available next step rather than treating a request as automatically rejected.",
      ),
      term("Contact [working rights channel]."),
      term("Tell us enough to locate the relevant information and understand your request."),
      term(
        "We may request proportionate identity or authority verification so that we do not disclose information to the wrong person.",
      ),
      term(
        "We will acknowledge and handle requests under the applicable requirements and explain any further information needed.",
      ),
      term("You may raise a concern through [internal complaint channel]."),
      reading("You also have the right to complain to the Nigeria Data Protection Commission;", complaint),
      term("current contact and complaint information is available at https://ndpc.gov.ng ."),
      term("You do not have to give up that right to use our internal process."),

      none("Changes to this notice"),
      term("We identify the effective date and version above."),
      term(
        "If a change materially affects how your information is used, we will notify affected people through [actual appropriate method] and obtain fresh consent where that is required.",
      ),
      term("Earlier versions can be requested at [route]."),
    ],
  },
];
