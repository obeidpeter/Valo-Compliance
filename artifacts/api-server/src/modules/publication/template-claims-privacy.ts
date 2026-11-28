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
];
