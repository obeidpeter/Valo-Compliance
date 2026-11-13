import { sourceContentInventory } from "./content-register.generated";
/** Inventory metadata only. These titles are NOT published documents. */
const baselineTitles = [
  "Invoice", "Quotation", "Receipt", "Purchase order", "Delivery note",
  "Expense claim form", "Inventory register", "Meeting minutes",
  "Customer complaint form", "Leave request form", "Staff onboarding checklist",
  "Payment reminder letter", "Service agreement", "Consultancy agreement",
  "Non-disclosure agreement", "Employment contract", "Offer letter",
  "Supplier agreement", "Sales agreement", "Partnership agreement",
  "Independent contractor agreement", "Business proposal", "Statement of work",
  "Procurement evaluation form", "Board resolution", "Employee handbook",
  "Leave policy", "Disciplinary procedure", "Privacy notice",
  "Website terms and conditions", "Data processing agreement",
  "Data retention policy", "Health and safety checklist", "Incident report",
  "Standard operating procedure", "Product recall plan", "Food hygiene checklist",
  "Equipment maintenance log", "Commercial lease checklist",
  "Compliance evidence checklist",
] as const;

const guided = new Set([1, 2, 3, 4, 5, 8, 12, 13, 14, 15, 16, 17]);
const ai = new Set([1, 2, 12, 22]);

export const baselineTemplates = baselineTitles.map((title, index) => {
  const number = index + 1;
  return {
    id: `TPL-${String(number).padStart(2, "0")}`,
    title,
    release: "R1" as const,
    access: number <= 12 ? "free" as const : "premium" as const,
    guided: guided.has(number),
    customerAi: ai.has(number),
    status: "held" as const,
    holdReasons: ["No rights evidence", "No reviewed candidate", "No passing DOCX/PDF exports"],
    publishedVersion: null,
  };
});

/** Proposed candidates, compared against all 61 identified items; never publications. */
export const additionalCandidates = [
  ["Asset handover and return record", "Record custody of company equipment, distinct from maintenance."],
  ["Travel authorisation form", "Approve a proposed trip before costs are incurred, distinct from expense reimbursement."],
  ["Petty cash reconciliation record", "Reconcile a cash float against vouchers and counted cash."],
  ["Stock discrepancy investigation form", "Investigate mismatches, rather than recording routine inventory balances."],
  ["Goods received inspection record", "Record condition and acceptance of incoming goods, distinct from delivery notes."],
  ["Supplier due diligence questionnaire", "Collect pre-engagement supplier facts, distinct from bid evaluation."],
  ["Customer credit application", "Collect information for a trade-credit decision, without promising approval."],
  ["Credit note", "Record an invoice adjustment; not payment proof or an inferred tax adjustment."],
  ["Sales return authorisation", "Record permission and reasons for product returns, distinct from complaints."],
  ["Project change request", "Document proposed scope/cost changes without silently amending a contract."],
  ["Project acceptance record", "Record user-confirmed deliverable acceptance, not a fabricated signature."],
  ["Business continuity plan", "Plan operational recovery after disruption, distinct from product recall."],
  ["Emergency contact and response sheet", "Assign response contacts and actions, distinct from incident reporting."],
  ["Access permission review record", "Review system access and removals, distinct from staff onboarding."],
  ["Vendor data-sharing register", "Map disclosures to vendors, distinct from a data processing agreement."],
  ["Customer consent record", "Record actual consent and withdrawal without inventing consent."],
  ["Conflict of interest declaration", "An individual's disclosure record, distinct from the NGO conflict-handling policy (TPL-57); does not certify absence of conflicts."],
  ["Whistleblowing intake form", "Record a confidential concern with explicit handling limitations."],
  ["Training attendance and competency record", "Record training and assessment supplied by the business."],
].map(([title, rationale], index) => ({
  id: `CAND-${String(index + 1).padStart(2, "0")}`,
  title, rationale, release: "R2", status: "proposed",
  comparedWithTemplateIds: [
    ["TPL-38"], ["TPL-06"], ["TPL-06", "TPL-07"], ["TPL-07"], ["TPL-05"],
    ["TPL-24"], ["TPL-01", "TPL-19"], ["TPL-01", "TPL-03"], ["TPL-09"],
    ["TPL-23"], ["TPL-23", "TPL-05"], ["TPL-36", "TPL-35"], ["TPL-34"],
    ["TPL-11", "TPL-32"], ["TPL-31", "TPL-29"], ["TPL-29", "TPL-43"],
    ["TPL-57"], ["TPL-28"], ["TPL-11"],
  ][index]!,
  distinctness: "Distinct artifact purpose compared against the 40 baseline and 21 supplementary additions; retain CAND ID until owner prioritisation",
  countsAsPublished: false,
}));

export const catalogueSummary = {
  baselineIdentified: baselineTemplates.length,
  baselineGuidedTarget: 12,
  baselineFreeTarget: 12,
  baselinePremiumTarget: 28,
  baselineAiTarget: 4,
  coordinatingTeamIdentifiedTotal: 61,
  independentlyMappedTotal: 61,
  identifiedIncludingProposals: 80,
  additionalProposed: additionalCandidates.length,
  finalDistinctTotal: null,
  published: 0,
  note: "All 27 mappings are retained: five direct matches, one composite, 21 additions. Nineteen further distinct-purpose proposals bring the identified backlog to 80, not 80 authored, rights-cleared or published templates. NGO SCUML aliases broader SCUML and is never counted twice.",
};

export function contentReadiness() {
  return {
    summary: {
      baselineTemplates: 40, supplementaryRows: 27, directMatches: 5, compositeRows: 1,
      identifiedAdditions: 21, distinctIdentifiedBeforeProposals: 61,
      furtherProposals: additionalCandidates.length, identifiedIncludingProposals: 80,
      regulatoryRows: 79, canonicalRegulatoryTopicsAfterScumlAlias: 78,
      publishedTemplates: 0, publishedGuidance: 0,
      notice: "Research inventory only. Titles, mappings and links are not legal evidence, reviewed content or universal obligations.",
    },
    supplementaryMappings: sourceContentInventory.essential_document_mapping,
    identifiedAdditions: sourceContentInventory.r2_missing_template_candidates,
    furtherProposals: additionalCandidates,
    regulatoryRows: sourceContentInventory.regulatory_inventory,
    industryTaxonomy: sourceContentInventory.industry_taxonomy,
    deeperPacks: sourceContentInventory.r1_deeper_packs,
    statePriorities: sourceContentInventory.state_source_priorities,
    overlaps: sourceContentInventory.overlap_register,
    releaseTargets: sourceContentInventory.release_targets,
  };
}
