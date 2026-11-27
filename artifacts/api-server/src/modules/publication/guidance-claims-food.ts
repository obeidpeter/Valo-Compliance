import type { GuideClaimMap, GuideSentence, GuideSupport } from "./guidance-claim-map";

/**
 * The claim maps of the eight food guides, GUD-19 to GUD-26.
 *
 * Each map lists every sentence of its guide in order. Most sentences of these guides suggest a way
 * of working and state nothing about the law. A sentence that says what a guideline of the National
 * Agency for Food and Drug Administration and Control says names the passage it rests on and the
 * first and last words of the exact quotation. None of the eight guidelines is kept in the
 * repository: a passage is named by its place and checksum (guidance-captured-texts.ts), and a
 * sentence is bound only when a capture of the official file supplies the passage.
 *
 * These maps were written by reading each sentence against the guidelines as the project's
 * extractor read them on 21 November 2026. They are a drafter's work, for the two reviews to check:
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

const gmp = {
  traceRecord: q(
    "NAFDAC-GMP-32",
    "d. It is important to have a record of the traceability",
    "procedure for product recall.",
    "section 32.0",
  ),
  recallProcedure: q(
    "NAFDAC-GMP-32",
    "b. There shall be a written procedure that defines the circumstances",
    "how the recalled material should be treated.",
    "section 32.0",
  ),
  authorities: q(
    "NAFDAC-GMP-32",
    "c. In the event of a serious or potentially life-threatening situation",
    "their advice sought.",
    "section 32.0",
  ),
  recallContents: q(
    "NAFDAC-GMP-32-1",
    "a. There should be a written procedure for recalls that includes",
    "to the appropriate distribution level.",
    "section 32.1",
  ),
  distributionTrace: q(
    "NAFDAC-GMP-32-1",
    "b. Distribution records should contain sufficient information",
    "to the initial level of product distribution.",
    "section 32.1",
  ),
  otherProducts: q(
    "NAFDAC-GMP-32-1",
    "d. When there are other products that may represent a public health hazard",
    "recalled if necessary.",
    "section 32.1",
  ),
  heldProducts: q(
    "NAFDAC-GMP-32-1",
    "e. Recalled products should be securely held until they are destroyed",
    "to ensure their safety.",
    "section 32.1",
  ),
  distributionRecord: q(
    "NAFDAC-GMP-39",
    "Distribution records shall contain the following:",
    "Batch or control number of the food or food product.",
    "section 39.0",
  ),
};
const advertPermit = q(
  "NAFDAC-REGISTRATION-8",
  "8.4. Product registration does not automatically confer advertisement permit.",
  "if the product is to be advertised.",
  "section 8.4",
);
const disposal = {
  inventory: q(
    "NAFDAC-DISPOSAL-3",
    "The request shall be accompanied with an inventory",
    "Reason for destruction (Annex I)",
    "section 3.3",
  ),
  custody: q(
    "NAFDAC-DISPOSAL-2",
    "Demarcate an area for storing",
    "until they are disposed of to avoid pilferage.",
    "sections 2.1.5 and 2.1.6",
  ),
  witness: q(
    "NAFDAC-DISPOSAL-7-8",
    "Upon completion of the exercise, a Destruction Witness Form",
    "representative.",
    "section 7.1.5",
  ),
};
export const foodClaimMaps: readonly GuideClaimMap[] = [
  {
    id: "GUD-19",
    risk: "regulated_sector",
    sentences: [
      practice("Start with what your business actually does."),
      practice(
        "Making a packaged sauce, importing a finished drink, storing someone else's ingredients and serving a prepared meal involve different facts.",
      ),
      practice(
        "Write down the product, whether it is packaged, where it is made, your role, the site and the intended market.",
      ),
      practice("An industry label alone cannot choose the right application."),
      s(
        "NAFDAC publishes separate guidance for micro-scale, small-scale and other pre-packaged food manufacturing facilities.",
        q(
          "NAFDAC-MICRO-1",
          "1.1. These Guidelines are for the general public",
          "on a micro scale.",
          "section 1.1",
        ),
        q(
          "NAFDAC-SMALL-1",
          "1.1. These Guidelines are for the general public",
          "on a small scale in Nigeria.",
          "section 1.1",
        ),
        q(
          "NAFDAC-FACILITY-1",
          "1.1. These Guidelines are for the general public",
          "packaged food in Nigeria.",
          "section 1.1",
        ),
      ),
      s(
        "Its current micro-scale guide contains inconsistent staff descriptions in different sections.",
        q(
          "NAFDAC-MICRO-1",
          "1.2. Micro Scale food enterprises are manufacturing facilities",
          "minor scope and capacity.",
          "section 1.2",
        ),
        q("NAFDAC-MICRO-PERSONNEL-1-1", "1.1. Personnel strength", "between1 to 9.", "section 1.1"),
      ),
      practice("Do not settle your route by selecting whichever number looks convenient."),
      reading(
        "A product excluded from a simplified scheme is not thereby exempt from regulation.",
        q(
          "NAFDAC-MICRO-1",
          "1.4. It is necessary to emphasize that no food product shall be manufactured",
          "etc.) Act Cap F33 LFN 2004.",
          "section 1.4",
        ),
        q(
          "NAFDAC-MICRO-1",
          "1.6. The under listed products are exempted under micro scale enterprises:",
          "because they are high risk products",
          "sections 1.6 and 1.7",
        ),
      ),
      practice(
        "Prepare a short enquiry with the actual product description, process, staffing, equipment and site arrangements.",
      ),
      practice(
        "Ask the relevant official service to confirm the applicable route and retain the response with the guide version used.",
      ),
      practice(
        "If you use another business to manufacture or pack, identify both businesses and who owns the product and brand; do not hide the arrangement behind a supplier invoice.",
      ),
      practice(
        "Keep a small decision record: question raised, facts supplied, official response, date and next action.",
      ),
      practice("Recheck it when the product, premises, production arrangement or market changes."),
      reading(
        "A route enquiry is not an application approval, and an application receipt is not a product certificate.",
        q(
          "NAFDAC-MICRO-1",
          "1.5. A food product should not be manufactured and offered for sale in Nigeria unless the",
          "NAFDAC.",
          "section 1.5",
        ),
      ),
      limit("This guidance helps organise that enquiry."),
      limit(
        "It does not determine every national, state or local operating requirement, and it does not establish that every restaurant, salon or retailer needs the same product-manufacturing approval.",
      ),
    ],
  },
  {
    id: "GUD-20",
    risk: "regulated_sector",
    sentences: [
      practice(
        "For a business manufacturing or packing pre-packaged food in Nigeria, prepare the inspection file around the actual premises and products.",
        q(
          "NAFDAC-FACILITY-1",
          "1.1. These Guidelines are for the general public",
          "packaged food in Nigeria.",
          "section 1.1",
        ),
      ),
      s(
        "NAFDAC's facility guide links the application to documents, an inspection and subsequent review.",
        q(
          "NAFDAC-FACILITY-2",
          "2.1. An online application for product registration shall be submitted",
          "the following documents.",
          "section 2.1",
        ),
        q(
          "NAFDAC-FACILITY-4-5",
          "4.1. Upon successful application vetting, the inspection is scheduled",
          "on an agreeable date.",
          "section 4.1",
        ),
        q(
          "NAFDAC-FACILITY-4-5",
          "Application is progressed on the NAPAMS portal",
          "Inspection reporting and review.",
          "section 5.1",
        ),
      ),
      reading(
        "A well-organised file helps answer questions; it does not guarantee a satisfactory inspection.",
        q(
          "NAFDAC-FACILITY-4-5",
          "Where the Inspection is unsatisfactory a Non-",
          "communicated to the company on NAPAMS.",
          "section 5.1",
        ),
      ),
      practice(
        "Create an index showing each requested item, its owner, the version supplied and any unresolved gap.",
      ),
      practice(
        "Match the business identity, site address, product description, packaging artwork and supporting technical records across the file.",
      ),
      practice("Explain a mismatch rather than editing an old certificate to make it appear current."),
      practice(
        "Where another business performs manufacturing, identify the real arrangement and the relevant agreement.",
        q(
          "NAFDAC-FACILITY-2-4-8",
          "2.4.8.1 A written contract agreement between the contract giver and the contract acceptor should",
          "specify brand ownership, recipe ownership,",
          "section 2.4.8.1",
        ),
      ),
      practice(
        "Walk through the process with the people responsible for receiving materials, making the product, checking it, cleaning and dispatch.",
      ),
      practice("Make sure a written procedure describes the work actually performed."),
      practice("Keep training and maintenance records linked to the correct people, equipment and site."),
      limit(
        "These organising steps support preparation; they do not replace the guide's full applicable document list or a technical assessment.",
      ),
      practice("Record inspection correspondence separately from your internal checklist."),
      s(
        "A proposed visit date can change.",
        q("NAFDAC-FACILITY-4-5", "(Note", "will be duly informed)", "section 4.1"),
      ),
      practice(
        "If the Agency raises a concern, track its exact wording, response, supporting evidence and current status.",
        q(
          "NAFDAC-FACILITY-4-5",
          "Where the Inspection is unsatisfactory a Non-",
          "communicated to the company on NAPAMS.",
          "section 5.1",
        ),
      ),
      practice("Do not mark it resolved solely because your team uploaded a reply."),
      practice(
        "Use the current official application route and confirm charges through official instructions.",
      ),
      limit("This guide supplies no fee, approval promise or medical-test prescription."),
      practice(
        "Store any legitimately required staff-health evidence through a restricted process, with only the necessary reference in the general inspection index.",
      ),
    ],
  },
  {
    id: "GUD-21",
    risk: "regulated_sector",
    sentences: [
      practice(
        "If you are applying to register a pre-packaged food product made in Nigeria, keep the product application separate from the business's general registration and internal readiness work.",
        q(
          "NAFDAC-REGISTRATION-1",
          "1.1. These guidelines are for the interest of the general public",
          "food and feed products.",
          "section 1.1",
        ),
      ),
      s(
        "NAFDAC's March 2026 guide distinguishes application review, approval consideration and issue of a product certificate.",
        q(
          "NAFDAC-REGISTRATION-5-6",
          "Effective Date: 01/03/2026",
          "01/03/2026",
          "Effective Date: 01/03/2026",
        ),
        q(
          "NAFDAC-REGISTRATION-5-6",
          "5.1. Upon satisfactory documents review",
          "presented for Approval Meetings.",
          "section 5.1",
        ),
        q(
          "NAFDAC-REGISTRATION-5-6",
          "6.1. For products approved at the meeting",
          "applicant.",
          "section 6.1",
        ),
      ),
      s(
        "Filing a form or paying a fee does not confer registration status.",
        q(
          "NAFDAC-REGISTRATION-8",
          "8.2. Filing an application or paying an application fee",
          "registration status.",
          "section 8.2",
        ),
      ),
      practice("Create one record for the specific product and application reference."),
      practice(
        "Link the exact product name, manufacturer, formulation or specification where applicable, label version and documents submitted.",
      ),
      practice("Keep the latest official correspondence beside the version it concerns."),
      practice(
        "If a document changes, record the change and check how it should be handled before assuming an earlier submission covers it.",
      ),
      practice(
        "Useful internal statuses include preparing, submitted, query received, response submitted and official decision received.",
      ),
      practice("Choose them from actual events."),
      practice(
        "Record a certificate only after receiving it, and check its product identity, conditions and validity details.",
      ),
      practice("A screenshot showing an upload or payment should remain evidence of that step only."),
      practice("For each outstanding question, assign an owner and retain the answer sent."),
      reading(
        "Do not promise a launch date based on an unverified processing estimate: the current guide's processing-time sentence contains inconsistent words and numerals.",
        q(
          "NAFDAC-REGISTRATION-8",
          "8.6. The time line for processing applications",
          "working days.",
          "section 8.6",
        ),
      ),
      practice("Confirm the current position through the official route."),
      limit("This entry addresses the local pre-packaged product route."),
      limit("Imported products and different product classes need their own applicable guidance."),
      s(
        "Product registration also does not automatically provide advertisement permission.",
        q(
          "NAFDAC-REGISTRATION-8",
          "8.4. Product registration does not automatically confer advertisement permit.",
          "if the product is to be advertised.",
          "section 8.4",
        ),
      ),
      practice(
        "Before launch, keep any separate permissions and conditions visible instead of treating one certificate as approval for every activity.",
      ),
    ],
  },
  {
    id: "GUD-22",
    risk: "regulated_sector",
    sentences: [
      practice(
        "A useful traceability record lets the business connect a particular product batch with its inputs and destinations.",
        gmp.traceRecord,
      ),
      s(
        "NAFDAC's food manufacturing guidance calls for distribution information that identifies the product, batch, recipient, dispatch date and quantity.",
        gmp.distributionRecord,
        gmp.distributionTrace,
      ),
      reading(
        "A general sales total cannot answer which recipients received an affected lot.",
        gmp.distributionTrace,
      ),
      practice(
        "Choose a consistent batch or lot identifier and carry it through the records that already describe the work.",
      ),
      practice("Check a real example from incoming materials through production, storage and dispatch."),
      practice("If two systems use different references, record the link explicitly."),
      practice("Do not assume that matching dates prove that records belong to the same batch."),
      practice(
        "For a practical check, select one completed batch and ask a colleague to locate its supporting records without relying on your memory.",
      ),
      practice("Can they identify what was sent, how much, to whom and where the remaining stock is held?"),
      practice("Record gaps and assign someone to resolve them."),
      practice(
        "Keep any practice exercise clearly labelled so it does not become a false recall or customer notification.",
      ),
      practice("Use one stated unit when reconciling quantities."),
      practice("Packs, cartons and weight are not interchangeable without a documented conversion."),
      practice(
        "Returned stock has moved from one location to another; it is not an additional quantity to add to the original dispatch total.",
      ),
      practice("Distinguish a recipient contact from a physical stock count."),
      practice(
        "Limit access to customer contact details while keeping them available to authorised response staff.",
      ),
      limit(
        "This is an organising method for the identified food operation, not a guarantee that a batch is safe or that every required record has been captured.",
      ),
    ],
  },
  {
    id: "GUD-23",
    risk: "regulated_sector",
    sentences: [
      practice(
        "Treat a reported problem as information to assess, not as proof that every unit is affected or that the product is harmless.",
      ),
      practice(
        "Record what was reported, when it arrived, the product and lot details, the available evidence and who is coordinating the response.",
        q(
          "NAFDAC-GMP-32",
          "a. All quality-related complaints, whether received orally or in writing",
          "according to a written procedure.",
          "section 32.0",
        ),
      ),
      practice("Keep the reporter's account distinct from findings established later."),
      s(
        "NAFDAC's food manufacturing guidance expects a defined recall procedure with responsible people, tracing and effectiveness checks.",
        gmp.recallProcedure,
        gmp.recallContents,
        gmp.traceRecord,
      ),
      s(
        "It also calls for authority involvement in serious or potentially life-threatening situations.",
        gmp.authorities,
      ),
      practice(
        "An urgent concern should reach the designated response lead promptly; completing a form must not delay the appropriate emergency or authority response.",
      ),
      practice(
        "The authorised team should record the scope of any investigation, hold, distribution restriction or recall decision and its basis.",
      ),
      practice(
        "Include related products or batches in the assessment where the evidence makes them relevant.",
        gmp.otherProducts,
      ),
      practice(
        "Do not let a generic template choose a recall class, reporting deadline, public statement or product-release decision.",
      ),
      practice("Prepare communications from the verified facts and actual instructions."),
      practice(
        "Identify the product clearly, state the action recipients should take and provide a genuine contact route.",
      ),
      practice("Retain the approved message and evidence of delivery."),
      practice("Drafting a message does not prove that anyone received it."),
      practice("Keep physical quantities, recipient responses and unresolved tracing gaps separate."),
      practice("Record follow-up until the responsible decision-maker has evidence for the next step."),
      limit(
        "This entry covers food operations; medical products and other sectors require their own procedures.",
      ),
      reading(
        "It does not authorise destruction, donation, reprocessing or resale of affected stock, nor does a business closure note replace any required authority decision.",
        gmp.heldProducts,
      ),
    ],
  },
  {
    id: "GUD-24",
    risk: "regulated_sector",
    sentences: [
      practice("Start with the food activity and process being checked."),
      practice(
        "A receiving area, preparation bench, production line and delivery vehicle do not need identical observations.",
      ),
      s(
        "NAFDAC's food hygiene guide supplies a general framework while recognising more specific sector requirements.",
        q(
          "NAFDAC-HYGIENE-2-1",
          "The document provides a baseline structure",
          "particular sectors of the food industry.",
          "section 2.1.1",
        ),
      ),
      practice("Select the applicable controls before treating a checklist result as meaningful."),
      practice(
        "For each item, write the criterion, what was actually observed, where and when it was checked, and who recorded it.",
      ),
      practice(
        "Use distinct outcomes for acceptable against the stated criterion, action needed, not checked and not applicable with a reason.",
      ),
      practice("An empty box or an unavailable record is not evidence that the condition was satisfactory."),
      practice(
        "Keep technical limits tied to the relevant product and validated procedure.",
        q(
          "NAFDAC-HYGIENE-5-2-1",
          "Temperature control systems should take into account:",
          "microorganisms.",
          "section 5.2.1",
        ),
      ),
      practice(
        "A temperature, time, concentration or other limit copied from an unrelated recipe can create false reassurance.",
      ),
      practice(
        "Record the unit, measurement method, instrument reference and actual result.",
        q(
          "NAFDAC-HYGIENE-5-2-1",
          "Temperature recording devices should be checked",
          "tested for accuracy.",
          "section 5.2.1",
        ),
      ),
      practice(
        "Where the limit or method is unresolved, raise the gap with the person responsible instead of inventing a passing value.",
      ),
      practice("Link each concern to an action owner and evidence of follow-up."),
      practice(
        "Separate correcting the working area from deciding what happens to food that may already have been affected.",
      ),
      practice("Cleaning a surface does not establish the suitability of an earlier batch."),
      practice("Never taste suspect food to check its safety."),
      practice("Avoid unnecessary medical details in a general checklist."),
      practice("Use the appropriate restricted route for staff-health matters."),
      limit(
        "A completed checklist records that particular review; it is not a certificate of safety, a full hazard-control system or an automatic permission to release a product.",
      ),
    ],
  },
  {
    id: "GUD-25",
    risk: "regulated_sector",
    sentences: [
      reading(
        "Damaged, expired or otherwise suspect regulated stock needs a documented decision.",
        q(
          "NAFDAC-DISPOSAL-1",
          "Medicines and other regulated products shall be considered as unwholesome when they",
          "damaged, and improperly stored",
          "section 1.3",
        ),
        q(
          "NAFDAC-DISPOSAL-2",
          "Maintain an inventory book (Annex I)",
          "NAFDAC regulated products.",
          "section 2.1.1",
        ),
      ),
      practice("Removing an item from a sales list does not establish that it has been safely disposed of."),
      s(
        "NAFDAC's disposal guide provides an Agency process involving an inventory, verification and supervised destruction arrangements for the regulated products within its scope.",
        q(
          "NAFDAC-DISPOSAL-1",
          "These Guidelines are for the general public",
          "dispose of unwholesome NAFDAC regulated products.",
          "section 1.1",
        ),
        q(
          "NAFDAC-DISPOSAL-3",
          "The request shall be accompanied with an inventory",
          "should clearly state:",
          "section 3.3",
        ),
        q(
          "NAFDAC-DISPOSAL-4",
          "The premises will be visited by NAFDAC Officer(s)",
          "before determination of disposal method.",
          "section 4.1",
        ),
        q(
          "NAFDAC-DISPOSAL-7-8",
          "The destruction exercise shall be supervised",
          "Police officers.",
          "section 7.1.3",
        ),
      ),
      practice(
        "Start by identifying the product, category, batch, quantity, unit, location and reason it is being held.",
        disposal.inventory,
      ),
      practice("Record what is known and what still needs assessment."),
      practice(
        "Keep the item under the site's authorised control arrangements and prevent it being confused with saleable stock.",
        disposal.custody,
      ),
      practice(
        "Do not open, mix, drain, burn or repackage suspect material to make an inventory easier; obtain appropriate instructions for the actual hazard.",
      ),
      practice(
        "Assign a person to verify the applicable NAFDAC route and any other relevant environmental or sector requirements.",
      ),
      practice("Keep the enquiry, instructions, application reference and inventory version together."),
      reading(
        "Medicine-specific professional roles or handling categories must not be copied automatically into an unrelated food or cosmetics operation.",
        q(
          "NAFDAC-DISPOSAL-2",
          "Keep separately medicines which fall under controlled drugs",
          "hazardous medicines or materials.",
          "section 2.1.3",
        ),
        q(
          "NAFDAC-DISPOSAL-2",
          "The decision of when to initiate disposal",
          "avoid accumulation of such products.",
          "section 2.1.7",
        ),
      ),
      practice(
        "Distinguish proposed disposal, authorised arrangements, transfer of custody and disposal actually witnessed.",
        disposal.witness,
      ),
      practice("Record the real quantities at each step, the responsible parties and the evidence received."),
      reading(
        "A transport receipt is not itself a destruction certificate, and a blank certificate template is not proof that disposal occurred.",
        q(
          "NAFDAC-DISPOSAL-7-8",
          "A written application for Certificate of Destruction",
          "company.",
          "sections 8.1 and 8.2",
        ),
      ),
      practice(
        "Do not assume that a refund, supplier credit or insurance settlement resolves the physical stock.",
      ),
      limit(
        "This guidance does not choose a disposal method, quote a fee, promise a service date or authorise donation or resale.",
      ),
      practice(
        "Use the actual instructions and keep unresolved quantities visible until they are properly accounted for.",
      ),
    ],
  },
  {
    id: "GUD-26",
    risk: "regulated_sector",
    sentences: [
      practice("Keep the advertisement review separate from product registration."),
      s(
        "NAFDAC's March 2026 food advertising guide covers registered food products and identifies advertising materials and supporting evidence for its process.",
        q("NAFDAC-ADVERT-1", "Effective Date: 01/03/2026", "01/03/2026", "Effective Date: 01/03/2026"),
        q(
          "NAFDAC-ADVERT-1",
          "1.1. These Guidelines are for the interest of the general public",
          "registered food products.",
          "section 1.1",
        ),
        q(
          "NAFDAC-ADVERT-3",
          "3.1.4. Evidence of substantiation of claims (where applicable).",
          "(where applicable).",
          "section 3.1.4",
        ),
        q(
          "NAFDAC-ADVERT-3",
          "3.2. Advert Materials to be uploaded include:",
          "3.2.7. Any other means (script/artwork/storyboard),",
          "section 3.2",
        ),
      ),
      s(
        "The local food registration guide also states that product registration does not automatically confer advertisement permission.",
        advertPermit,
      ),
      practice("Prepare a campaign record before approving expenditure or publishing a claim."),
      practice(
        "Identify the exact product, intended audience, medium, language, artwork or script version and proposed publication period.",
      ),
      practice(
        "Include online material as well as print or broadcast.",
        q(
          "NAFDAC-ADVERT-3",
          "3.2.4. Print (script/artwork),",
          "3.2.5. Online (script/artwork/storyboard),",
          "sections 3.2.4 and 3.2.5",
        ),
      ),
      practice(
        "Save the version actually submitted so a later edit is not mistaken for the material considered earlier.",
      ),
      practice("Make a claim list alongside the creative work."),
      practice(
        "For each factual statement, identify its supporting evidence and check that the wording does not go beyond it.",
      ),
      practice(
        "A testimonial, influencer script or attractive graphic can still communicate a factual claim.",
      ),
      practice(
        "Do not invent health benefits, official endorsement, approvals or customer experiences to complete an advertisement.",
      ),
      practice(
        "Confirm the applicable approval route and any product-specific restrictions through the official source.",
      ),
      s(
        "The guide identifies prohibited advertising categories, including breast-milk substitutes and infant or young children’s food; this workflow is not an approval route around a prohibition.",
        q(
          "NAFDAC-ADVERT-1",
          "1.3. Advertisement of breast milk substitutes and infant or young children’s food",
          "is prohibited.",
          "section 1.3",
        ),
      ),
      reading(
        "Alcohol and other sensitive categories also need their particular rules checked.",
        q(
          "NAFDAC-ADVERT-1",
          "1.6. Advertisement materials of alcoholic beverages must include the phrases:",
          "responsibly”",
          "section 1.6",
        ),
      ),
      practice(
        "Where an agent or featured person is involved, retain the actual authority and agreements relevant to their role.",
        q(
          "NAFDAC-ADVERT-3",
          "3.1.3. A letter of introduction of Advert Agent from the Applicant",
          "applicable).",
          "section 3.1.3",
        ),
        q(
          "NAFDAC-ADVERT-3",
          "3.1.5. Evidence of contract agreement with featured celebrities or organizations",
          "(where applicable).",
          "section 3.1.5",
        ),
      ),
      practice("Keep submission, queries, revised material and the official outcome distinct."),
      practice(
        "Check the scope and conditions of any permission before using it for a different product, claim or channel.",
      ),
      limit(
        "This entry supplies no approval guarantee, fee or universal processing deadline, and it does not establish compliance with every other advertising or consumer-protection requirement.",
      ),
    ],
  },
];
