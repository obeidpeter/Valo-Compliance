import type { GuideSupport } from "./guidance-claim-map";
import type { TemplateClaimMap, TemplateSentence } from "./template-claim-map";

/**
 * The claim maps of the food templates, starting with TPL-36, the product recall plan
 * (docs/architecture/reviewed-route.md, part 4).
 *
 * Each map lists every sentence of its template in order: its headings, the labels and blanks of its
 * forms and tables, and each instruction. A sentence about the law names the passage it rests on and
 * the first and last words of the exact quotation. These templates rest on the Agency's guidelines
 * for good manufacturing practice in food production, whose words are not kept in the repository: a
 * passage is named by its place and checksum (guidance-captured-texts.ts), and a sentence is bound
 * only when a capture of the official file supplies the passage. Every quotation here is one the
 * food guides' maps already make (guidance-claims-food.ts), read against the official text as the
 * project's extractor read it on 21 November 2026.
 *
 * These maps are a drafter's work, for the two reviews to check: nothing here is a review or an
 * approval.
 */
const reading = (text: string, ...support: GuideSupport[]): TemplateSentence => ({
  kind: "interpretation",
  text,
  support,
});
const practice = (text: string): TemplateSentence => ({ kind: "optional_practice", text });
const limit = (text: string): TemplateSentence => ({ kind: "template_limit", text });
const none = (text: string): TemplateSentence => ({ kind: "not_a_claim", text });
const q = (passage: string, from: string, to: string, locator: string): GuideSupport => ({
  passage,
  from,
  to,
  locator,
});

/** Recalled products are held securely until a decision on them is made, section 32.1(e), as GUD-23 quotes it. */
const heldProducts = q(
  "NAFDAC-GMP-32-1",
  "e. Recalled products should be securely held until they are destroyed",
  "to ensure their safety.",
  "section 32.1",
);

export const foodTemplateClaimMaps: readonly TemplateClaimMap[] = [
  {
    id: "TPL-36",
    // A business's own recall procedure. Its instructions are practices and its labels and blanks
    // make no claim. It defers the response to the product's risk assessment and the authority's
    // directions, and says what it does not decide, as limits of the plan. Its one reading of the
    // guidelines is that closing the business's record decides nothing an authority must decide.
    risk: "regulated_sector",
    ownNumbers: [
      ...[
        "1. Responsibilities and contact routes",
        "2. Receive and assess a concern",
        "3. Define the affected product and trace its movement",
        "4. Decide and communicate the response",
        "5. Recover, control and account for product",
        "6. Check effectiveness and close with evidence",
      ].map((text) => ({ text, why: "The plan's own section number." })),
      { text: "Record 1", why: "The first row of the product table, as the document numbers it." },
    ],
    sentences: [
      none("PRODUCT RECALL PLAN"),
      none("Edition scope: food and food products"),
      none("Business / responsible legal entity: [ ]"),
      none("Site(s) and product range covered: [ ]"),
      none("Plan reference / version / owner: [ ]"),
      none("Date adopted by the business / next review trigger: [ ]"),
      none("Related complaint, traceability, stock-hold and crisis procedures: [ ]"),
      practice("Use this plan to organise the business's response to a suspected product problem."),
      practice("Complete the roles and contact routes before use."),
      limit(
        "Product-specific risk assessment and current authority directions determine the actual response;",
      ),
      limit(
        "this plan does not classify a recall, establish a reporting deadline or authorise disposal, reprocessing or release.",
      ),

      none("1. Responsibilities and contact routes"),
      none("Function"),
      none("Responsible person / deputy"),
      none("Verified contact / out-of-hours route"),
      none("Decision or task within their authority"),
      none("Response coordinator"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Product safety / technical assessment"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Stock and distribution tracing"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Authority liaison"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Customer and public communications"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Recovery and controlled storage"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Final business decision / oversight"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("Relevant authority contact route, official source checked and date checked: [ ]"),
      none("Other sites, suppliers or distribution partners to involve: [ ]"),
      none("Where contact details and distribution records can be accessed by authorised staff: [ ]"),

      none("2. Receive and assess a concern"),
      practice(
        "Open a response record for a complaint, test finding, supplier notice, labelling error, traceability failure or authority instruction that may affect product safety.",
      ),
      practice("Preserve the information received;"),
      practice("distinguish a report from a verified finding."),
      none("Response reference: [ ] · Live event / clearly labelled exercise: [ ]"),
      none("Date/time first received: [ ] · Received by: [ ]"),
      none("Reporter contact reference, stored with appropriate access: [ ]"),
      none("Product / batch / pack size / relevant date marks: [ ]"),
      none("Concern reported and supporting evidence: [ ]"),
      none("Known affected locations or recipients: [ ]"),
      none("Initial assessment by / time / evidence / uncertainties: [ ]"),
      none(
        "Action actually authorised at this stage: [investigation / stock hold / distribution stop / recall action / other precise action]",
      ),
      none("Authorised by / time / scope / decision evidence: [ ]"),
      none("Any urgent authority advice sought and response received: [ ]"),
      practice(
        "For a serious or potentially life-threatening food concern, promptly escalate through the designated authority liaison and seek the relevant local/national authority's advice.",
      ),
      practice("Do not delay urgent action while filling the form."),
      practice(
        "Record authority instructions accurately, including any communication arrangements for cross-border distribution.",
      ),

      none("3. Define the affected product and trace its movement"),
      none("Record 1"),
      none("Field"),
      none("Entry"),
      none("Product / pack and unit"),
      none("[ ]"),
      none("Batch or lot / date marks"),
      none("[ ]"),
      none("Quantity produced or received"),
      none("[ ]"),
      none("Quantity initially distributed / locations"),
      none("[ ]"),
      none("Record references / gaps"),
      none("[ ]"),
      none("Related batches, ingredients, packaging, shared equipment or products considered: [ ]"),
      none("Assessment result and reason for including or excluding each: [ ]"),
      none("Traceability gaps requiring further investigation: [ ]"),
      none("Sales/dispatch systems or physical stock controls changed, by whom and when: [ ]"),

      none("4. Decide and communicate the response"),
      none("Decision and basis: [ ]"),
      none("Products, lots, territory and distribution levels covered: [ ]"),
      none("Authority notified / date and time / reference / instructions received: [ ]"),
      none("Approved message version / approving person / approval time: [ ]"),
      none("Message preparation record"),
      practice("- Identify the sender and an actual contact route: [ ]."),
      practice("- Identify the product, pack, lot and date marks without ambiguity: [ ]."),
      practice("- Describe the verified issue and any uncertainty: [ ]."),
      practice("- State the actual action recipients should take, based on the authorised response: [ ]."),
      practice("- Give the approved return/contact arrangements and any precautions: [ ]."),
      practice("- State where subsequent updates will appear: [ ]."),
      practice(
        "Do not insert unsupported health reassurance, a refund promise, a recall classification or an official endorsement.",
      ),
      practice("Record any public notice or recipient message actually issued;"),
      practice("a draft message is not evidence of notification."),
      none("Recipient / channel / approved message reference"),
      none("Sent by / time"),
      none("Receipt or response evidence"),
      none("Further contact needed / owner"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),

      none("5. Recover, control and account for product"),
      none("Designated holding location and access controls: [ ]"),
      none("Identification used to distinguish affected stock: [ ]"),
      none("Person recording receipts and movements: [ ]"),
      none("Movement date / reference"),
      none("Product / lot / unit / quantity"),
      none("From / to location"),
      none("Condition / custody record / person"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("[ ]"),
      none("At cutoff [date/time], total units in scope: [ ]."),
      practice(
        "Account for those same units once each: [originally undistributed units still held, excluding returns] + [returned units now in the business's controlled custody] + [units currently held elsewhere, excluding the first two groups] + [units confirmed consumed, used or disposed of and no longer in any current custody group] + [unlocated units].",
      ),
      practice("Explain missing or uncertain quantities: [ ]."),
      practice("Each unit belongs to exactly one group at this cutoff."),
      practice(
        "Returned units held by an outside custodian belong in the held-elsewhere group, not both groups.",
      ),
      practice("Do not add historical dispatch quantities again to this location-based total."),
      none("Any proposed product disposition: [ ]"),
      none("Technical decision and any required authority direction/permission: [ ]"),
      none("Disposition actually completed / date / quantity / evidence / responsible person: [ ]"),
      practice("Keep affected product controlled while the disposition decision is unresolved."),
      limit("This form does not authorise resale, donation, destruction or reprocessing."),

      none("6. Check effectiveness and close with evidence"),
      none("Recipients expected / contacted / responding: [separate counts and cutoff]"),
      none("Non-responders, missing product and additional tracing actions: [ ]"),
      none("Effectiveness check method, findings and follow-up owner: [ ]"),
      none("Authority updates or closure requirements still outstanding: [ ]"),
      none("Root-cause finding, evidence and preventive actions: [ ]"),
      none("Closure decision: [open / further action required / closed by named decision-maker]"),
      none("Decision-maker / date / supporting evidence / unresolved limitations: [ ]"),
      none("Records retained at / custodian / applicable retention basis: [ ]"),
      none("Plan changes, staff briefing and next exercise/review trigger: [ ]"),
      reading(
        "A business closure entry does not substitute for an authority's required decision.",
        heldProducts,
      ),
      practice("Keep original notices, investigation records, quantities and later corrections together."),
    ],
  },
];
