export type Evidence = {
  kind: "implementation" | "test" | "source" | "approval";
  path: string;
  hash: string;
  result: "pass" | "fail" | "not_run";
};
export type Requirement = {
  id: string;
  title: string;
  release: "R1" | "R2";
  priority: "Must";
  exactText: string;
  acceptance: string;
  implementationPaths: string[];
  evidence: Evidence[];
  blockers: string[];
};

const editorial: [string, string, string][] = [
  ["Permitted publication scope", "The product owner sets allowed content classes, jurisdictions, risk levels and blocked activities once at policy level. AI can publish general templates and sourced guidance within that policy. Bespoke legal opinions, guarantees and professional certification are excluded.", "publication needs no human signature per item, but cannot expand its own scope."],
  ["Evidence collection", "Retrieve authoritative instruments and current official guidance; retain actual text, title, issuing body, passage, jurisdiction, effective period, retrieval date and hash. News, search snippets and model memory are discovery aids only.", "failed retrieval, unclear amendments or missing operative provisions hold affected claims rather than generating substitutes."],
  ["AI drafting", "Draft from the approved evidence bundle and content schema. Map every material legal claim, deadline, rate and applicability condition to a supporting passage; distinguish source statements from interpretation and optional practice. Record missing evidence, assumptions, provenance and template rights.", "invented citations, business facts and rights assertions fail validation."],
  ["Separate AI checks", "Run a factual/source check and a separate challenge for scope, omissions, exceptions and misleading certainty, apart from drafting. Reviewers receive the source bundle and candidate, not each other’s verdict. Log model, prompt and run IDs; another model is optional.", "unexplained disagreement holds release. Model agreement is not independent professional validation."],
  ["Enhanced checks", "For tax, employment, privacy, governance, contracts and regulated-sector content, check controlling text, amendments, effective dates, exceptions and jurisdiction. Contract templates must expose party/use assumptions and unresolved clauses.", "a material uncertainty holds the whole template or inseparable rule; detachable unsupported claims may be removed and the complete item rechecked."],
  ["Mechanical validation", "Validate schemas, source locators, dates, scope, numeric extraction, rights records, required fields and disclosures. Run deterministic arithmetic and rule fixtures; render both export formats.", "every mandatory check passes on the exact candidate version. A model’s confidence or pass verdict cannot override a failed deterministic check."],
  ["Publication manifest", "Bind evidence, separate reviews, risk/scope, rights and test results to immutable content, source, model/prompt and policy versions. The publisher rechecks hashes, status and freshness atomically at release.", "edits, expired evidence, failed tests or a changed policy invalidate eligibility and return the item to review; no per-item human approval is required."],
  ["Transparent public status", "Show “AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist”, source-check date, scope and material limitations on detail pages and exports. Distinguish business drafts from general guidance.", "no “lawyer approved”, “professionally verified”, “guaranteed compliant” or equivalent claim without actual supporting review."],
  ["Least privilege automation", "Drafters/reviewers cannot publish or alter policy. A bounded publisher service may release only eligible manifests; it cannot access private customer drafts, change prices, send filings or move money. Retrieval uses allowlisted official sources and isolates downloaded text as untrusted data.", "injection, forged manifests and direct publish attempts fail and are logged."],
  ["Editorial evaluation", "Maintain 60 editorial cases separate from 60 customer AI cases and 80 rule scenarios. Include fake/misquoted citations, conflicting dates, missing text, omitted exceptions, wrong jurisdiction, unsafe clauses, injection and stale sources. Expected publish/hold outcomes need source excerpts or deterministic failure conditions.", "zero critical false publications and at least 95% overall; no claim of a legal-accuracy percentage."],
  ["Monitoring and correction", "Check sources daily and re-review high-impact content monthly, other content quarterly, or immediately after material change/error. Suspend affected rules, stop new statutory reminders, flag old assessments/tasks and re-run all gates. Log the change and notify affected users when material.", "withdrawal reaches search, caches, downloads and checker; past customer files are never silently rewritten."],
  ["Holds and accountability", "Missing evidence, conflicting reviews or provider failure leaves an item held; elapsed time never clears it. Retry with new evidence/configuration or narrow and recheck scope; otherwise keep it unavailable and show an official route. The content owner monitors queues, rights and corrections; specialist review is optional when later available, not a launch dependency.", "owners cannot waive a failed mandatory gate."],
];

export const requirements: Requirement[] = editorial.map(([title, exactText, acceptance], index) => ({
  id: `EDP-${String(index + 1).padStart(3, "0")}`,
  title, release: "R1", priority: "Must", exactText, acceptance,
  implementationPaths: index < 9 || index === 11 ? ["lib/valo-core/src/publication.ts"] : [],
  evidence: [],
  blockers: ["Full workflow not implemented or verified"],
}));

/** Never accept a requirement merely because a file or an agent verdict exists. */
export function requirementStatus(requirement: Requirement) {
  if (requirement.blockers.length) return "blocked";
  const implementation = requirement.evidence.some(e =>
    e.kind === "implementation" && e.result === "pass" && /^[a-f0-9]{64}$/.test(e.hash));
  const tests = requirement.evidence.filter(e => e.kind === "test");
  if (implementation && tests.length && tests.every(e =>
    e.result === "pass" && /^[a-f0-9]{64}$/.test(e.hash))) return "verified";
  return requirement.implementationPaths.length ? "in_progress" : "not_started";
}

export const conflicts = [
  { id: "CON-001", topic: "Frontend architecture", status: "owner_decision_required",
    issue: "Selected artifact uses React/Vite; preferred architecture requires Next.js.",
    resolution: null, blocks: ["Application shell"] },
  { id: "CON-002", topic: "Original specifications unavailable", status: "blocked",
    issue: "No three Word attachments or bounded remaining requirements are present. Only 12 exact formal IDs are supplied locally; expected total is 127.",
    resolution: null, blocks: ["Complete formal traceability", "P0–P5 exact gate criteria", "Inventory deduplication"] },
  { id: "CON-003", topic: "Worker and queue migration proof", status: "unmeasured",
    issue: "Always-on worker is documented, not demonstrated. Publish omits some database objects/grants. pg-boss migration and least-privilege worker access need measured proof.",
    resolution: null, blocks: ["P0 production compatibility"] },
  { id: "CON-004", topic: "Private storage isolation", status: "unmeasured",
    issue: "Project-scoped private storage is not tenant isolation; authenticated application checks and cross-tenant negative tests are required.",
    resolution: null, blocks: ["Private exports", "Evidence attachments"] },
  { id: "CON-005", topic: "Recovery and retention", status: "blocked",
    issue: "Native retention does not establish 35-day recovery. Separate database/object backup, retention and restore evidence are required without buying a plan.",
    resolution: null, blocks: ["P0 restore gate"] },
  { id: "CON-006", topic: "Launch and processor approvals", status: "blocked",
    issue: "No public-launch, live-commerce, recurring-billing or real-confidential-data approval exists. Processor geography and independent security/privacy/beta evidence remain required.",
    resolution: null, blocks: ["Public launch", "Live payments", "Real confidential customer data", "R2 until R1 gates pass"] },
];

export function readiness() {
  return {
    brand: "Valo", project: "Valo Compliance",
    expectedFormalRequirements: 127, receivedFormalRequirements: requirements.length,
    missingFormalRequirements: 127 - requirements.length,
    requirementFamilies: ["WEB", "IAM", "PRO", "DOC", "EDT", "AI", "CMP", "RUL", "WRK", "SRV", "PAY", "ADM", "EDP", "OPS", "SEC", "PRV", "NFR"],
    r1Accepted: false, r2Unlocked: false, r3Excluded: true,
    publicLaunchEnabled: false, livePaymentsEnabled: false,
    recurringBillingEnabled: false, confidentialCustomerDataEnabled: false,
    suites: [
      { id: "rules", requiredCases: 80, executedCases: 0, accepted: false },
      { id: "customer-ai", requiredCases: 60, executedCases: 0, accepted: false },
      { id: "editorial", requiredCases: 60, executedCases: 0, accepted: false },
    ],
    gates: [
      { id: "P0", status: "not_passed", reason: "Identity, tenant persistence, private dual exports, restore and end-to-end editorial proof not completed." },
      ...["P1", "P2", "P3", "P4", "P5"].map(id => ({
        id, status: "blocked", reason: "Await original roadmap gate criteria and preceding gate evidence.",
      })),
    ],
    requirements: requirements.map(r => ({ ...r, status: requirementStatus(r) })),
    conflicts,
  };
}
