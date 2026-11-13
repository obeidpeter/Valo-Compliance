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

/** Proposed candidates, not formal TPL IDs; deduplication against missing inventory is pending. */
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
  ["Conflict of interest declaration", "Disclose interests; does not certify absence of conflicts."],
  ["Whistleblowing intake form", "Record a confidential concern with explicit handling limitations."],
  ["Training attendance and competency record", "Record training and assessment supplied by the business."],
].map(([title, rationale], index) => ({
  id: `CAND-${String(index + 1).padStart(2, "0")}`,
  title, rationale, release: "R2", status: "proposed",
  distinctness: "Pending comparison with the 27-document inventory",
  countsAsPublished: false,
}));

export const catalogueSummary = {
  baselineIdentified: baselineTemplates.length,
  baselineGuidedTarget: 12,
  baselineFreeTarget: 12,
  baselinePremiumTarget: 28,
  baselineAiTarget: 4,
  coordinatingTeamIdentifiedTotal: 61,
  independentlyMappedTotal: 40,
  additionalProposed: additionalCandidates.length,
  finalDistinctTotal: null,
  published: 0,
  note: "61 is a coordinating-team report, not a verified local mapping. Missing inventory prevents final deduplication. NGO SCUML aliases broader SCUML and is never counted twice.",
};
