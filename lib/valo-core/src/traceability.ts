import { coordinatingRefinement } from "./coordinating.generated";
import { r1Transfer } from "./requirements-r1";
import { sourceRequirements, sourceGates, sourceUatPackages, sourceReleaseControls } from "./specification.generated";
import { partialExportEvidence } from "./export-evidence.generated";

export type Evidence = {
  kind: "implementation" | "test" | "source" | "approval";
  path: string;
  hash: string;
  result: "pass" | "fail" | "not_run";
};
export type Requirement = {
  id: string;
  title: string;
  release: "R1" | "R2" | "R2/R3";
  priority: "Must" | "Acceptance target";
  exactText: string;
  acceptance: string;
  implementationPaths: string[];
  evidence: Evidence[];
  blockers: string[];
  sourceExactText?: string;
  sourceLocator?: string;
  owner?: string;
  dependencies?: readonly string[];
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

const partialImplementations: Record<string, string[]> = {
  "WEB-001": ["artifacts/valo/src/screens/home.tsx", "artifacts/valo/src/components/site-shell.tsx"],
  "WEB-002": ["artifacts/valo/src/App.tsx", "artifacts/valo/src/screens/library.tsx", "artifacts/valo/src/screens/industries.tsx"],
  "DOC-001": ["lib/valo-core/src/catalogue.ts", "lib/valo-core/src/coverage.ts"],
  "DOC-002": ["artifacts/valo/src/screens/library.tsx"],
  "CMP-003": ["lib/valo-core/src/coverage.ts", "artifacts/valo/src/screens/industries.tsx"],
  "IAM-001": ["artifacts/valo/src/App.tsx", "artifacts/api-server/src/middlewares/valo-identity.ts"],
  "IAM-002": ["artifacts/api-server/src/middlewares/valo-identity.ts"],
  "IAM-003": ["artifacts/api-server/src/lib/valo-store.ts", "artifacts/api-server/src/lib/valo-store.integration.test.ts"],
  "SEC-003": ["artifacts/api-server/src/app.ts", "artifacts/api-server/src/middlewares/valo-identity.ts", "artifacts/api-server/src/lib/valo-http.test.ts"],
  "SEC-005": ["artifacts/api-server/src/middlewares/valo-quota.ts", "artifacts/api-server/src/lib/valo-quota.ts", "lib/db/src/schema/valo-rate-buckets.ts", "artifacts/api-server/src/lib/valo-quota.integration.test.ts"],
  "PRO-001": ["artifacts/valo/src/screens/profile.tsx", "artifacts/api-server/src/lib/valo-validation.ts"],
  "PRO-002": ["lib/db/src/schema/valo-profiles.ts", "artifacts/api-server/src/lib/valo-store.ts"],
  "PRO-003": ["lib/db/src/schema/valo-profiles.ts"],
  "EDT-002": ["lib/db/src/schema/valo-document-revisions.ts"],
  "EDT-003": ["artifacts/valo/src/screens/document-editor.tsx"],
  "EDT-004": ["artifacts/api-server/src/lib/valo-store.ts", "artifacts/valo/src/screens/document-editor.tsx"],
  "EDT-005": ["artifacts/api-server/src/lib/valo-validation.ts", "artifacts/valo/src/screens/document-editor.tsx"],
  "EDT-006": ["artifacts/api-server/src/lib/valo-render.ts", "artifacts/api-server/src/lib/valo-exports.integration.test.ts"],
  "EDT-007": ["artifacts/api-server/src/workers/export-worker.ts", "lib/db/src/schema/valo-exports.ts"],
  "EDT-008": ["artifacts/api-server/src/routes/valo-exports.ts", "artifacts/api-server/src/lib/valo-private-storage.ts"],
  "EDT-009": ["artifacts/api-server/src/lib/valo-render.ts", "artifacts/api-server/src/lib/valo-render.test.ts"],
  "SEC-001": ["artifacts/api-server/src/lib/valo-exports.ts", "artifacts/api-server/src/lib/valo-exports.integration.test.ts"],
  "SEC-004": ["artifacts/api-server/src/lib/valo-render.ts", "artifacts/api-server/src/lib/valo-render.test.ts"],
  "OPS-002": ["artifacts/api-server/src/workers/export-worker.ts"],
  "OPS-003": ["lib/db/drizzle/0002_fresh_alice.sql", "lib/db/drizzle/pg-boss-development.sql"],
  "OPS-007": ["docs/valo/part5-architecture-and-exports.md"],
  "WRK-001": ["artifacts/valo/src/screens/workspace.tsx"],
  "WRK-005": ["artifacts/valo/src/screens/workspace.tsx"],
  "WRK-006": ["artifacts/api-server/src/lib/valo-store.ts", "lib/db/src/schema/valo-support.ts"],
  "SRV-001": ["artifacts/valo/src/screens/services.tsx"],
  "SRV-002": ["artifacts/valo/src/components/ticket-form.tsx", "lib/db/src/schema/valo-support.ts"],
  "EDP-002": ["artifacts/api-server/src/editorial/source-capture.ts", "docs/valo/evidence/part6-source-retrieval.json", "artifacts/api-server/src/editorial/source-store.integration.test.ts"],
  "EDP-003": ["artifacts/api-server/src/editorial/pipeline.ts", "artifacts/api-server/src/editorial/pipeline-contract.ts", "docs/valo/evidence/p0-editorial-provider-proof.json"],
  "EDP-004": ["artifacts/api-server/src/editorial/model-adapter.ts", "artifacts/api-server/src/editorial/pipeline-proof.integration.test.ts", "docs/valo/evidence/p0-editorial-provider-proof.json"],
  "EDP-006": ["artifacts/api-server/src/editorial/pipeline-contract.ts", "artifacts/api-server/src/editorial/pipeline-contract.test.ts"],
  "EDP-012": ["artifacts/api-server/src/editorial/pipeline.ts", "artifacts/api-server/src/editorial/run-register.ts"],
  "EDP-009": ["artifacts/api-server/src/editorial/source-fetch.ts", "artifacts/api-server/src/editorial/source-storage.ts", "artifacts/api-server/src/editorial/source-controls.test.ts"],
  "ADM-003": ["artifacts/api-server/src/editorial/source-register.ts", "artifacts/valo/src/components/source-evidence.tsx"],
  "PRV-001": ["docs/registers/final-source-context.json", "docs/valo/part6-sources-and-retention.md"],
};

const initialTransfers: Requirement[] = [...editorial.map(([title, exactText, acceptance], index): Requirement => ({
  id: `EDP-${String(index + 1).padStart(3, "0")}`,
  title, release: "R1", priority: "Must", exactText, acceptance,
  implementationPaths: index < 9 || index === 11 ? ["lib/valo-core/src/publication.ts"] : [],
  evidence: [],
  blockers: ["Full workflow not implemented or verified"],
})), ...r1Transfer.map(([id, title, exactText, acceptance]): Requirement => ({
  id, title, exactText, acceptance, release: "R1", priority: "Must",
  implementationPaths: partialImplementations[id] ?? [], evidence: [],
  blockers: ["Full requirement acceptance not implemented or verified"],
}))];
// New baseline intake must not silently change any of the earlier quoted contracts.
for (const original of initialTransfers) {
  const source = sourceRequirements.find(r => r.id === original.id);
  if (!source || source.exactText !== original.exactText || source.acceptance !== original.acceptance)
    throw new Error(`Specification conflict requires explicit resolution: ${original.id}`);
}
export const requirements: Requirement[] = sourceRequirements.map(r => ({
  ...r, implementationPaths: partialImplementations[r.id] ??
    (r.id.startsWith("EDP-") ? ["lib/valo-core/src/publication.ts"] : []),
  evidence: partialExportEvidence.ids.includes(r.id) ? [partialExportEvidence.record] : [],
  blockers: ["Complete acceptance evidence and required operational approvals are not established"],
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
  ...coordinatingRefinement.conflicts.map(c=>({id:c.id,topic:c.topic,status:c.status,issue:c.source_conflict,
    resolution:c.resolution,blocks:c.status.startsWith("open")?["Applicable implementation/owner/evidence gate remains open"]:[]})),
  {id:"CON-GH-01",topic:"Repository identity, privacy and creation reports",status:"identity_confirmed_privacy_blocked",
    issue:"The coordinating report retracts creation claims; the authorised name check found an existing public repository. The owner confirmed that repository is intended for this build. Creation history, current private visibility and synchronisation remain separate unproved facts.",
    resolution:"Preserve local history. No duplicate creation, destructive overwrite, upload while public or unsupported protection/synchronisation claim. Visibility action requires explicit authorisation and read-back verification.",
    blocks:["Verified private visibility","Verified source synchronisation","Branch protection evidence"]},
  { id: "CON-001", topic: "Frontend architecture", status: "development_compatible",
    issue: "Selected artifact uses React/Vite; preferred architecture requires Next.js.",
    resolution: "The bootstrap was adapted to Next.js 15.5.29 without replacing the preferred stack. Strict workspace typechecking, Next production build and managed proxied development runtime passed. Production was not published or proven.", blocks: ["Production runtime, worker, storage and recovery compatibility proof"] },
  { id: "CON-002", topic: "Specification transfer", status: "resolved",
    issue: "Only 76 exact requirements were initially present in Replit.",
    resolution: "Read-only import of the coordinating team's complete extracted TRD, roadmap, master brief and 27/79 inventory baseline succeeded. All 127 exact requirements are matched to retained source text. Import hashes are retained; no implementation or publication acceptance follows from receipt.", blocks: [] },
  { id: "CON-003", topic: "Worker and queue migration proof", status: "development_partial",
    issue: "Development pg-boss construction and an actual separate worker were exercised; production publish omits required functions/grants. Least-privilege roles, in-flight crash recovery and deployment scale-down remain unproved.",
    resolution: "Pinned construction SQL is retained. Migrations are development-only and never run at web/worker startup. Production migration/deployment approval remains blocked.", blocks: ["P0 production compatibility"] },
  { id: "CON-004", topic: "Private storage isolation", status: "development_partial",
    issue: "Project-scoped private storage is not tenant isolation; authenticated application checks and cross-tenant negative tests are required.",
    resolution: "Real DOCX/PDF private-object round trips, anonymous denial and negative tenant tests passed with the native App Storage SDK. Signed-in delivery, deployed worker credentials, retention and independent security approval remain unproved.", blocks: ["Production private exports", "Evidence attachments"] },
  { id: "CON-005", topic: "Recovery and retention", status: "blocked",
    issue: "Native retention does not establish 35-day recovery. Separate database/object backup, retention and restore evidence are required without buying a plan.",
    resolution: null, blocks: ["P0 restore gate"] },
  { id: "CON-006", topic: "Launch and processor approvals", status: "blocked",
    issue: "No public-launch, live-commerce, recurring-billing or real-confidential-data approval exists. Processor geography and independent security/privacy/beta evidence remain required.",
    resolution: null, blocks: ["Public launch", "Live payments", "Real confidential customer data", "R2 until R1 gates pass"] },
  { id: "CON-007", topic: "Main-branch protection enforcement", status: "blocked",
    issue: "Previous reports of saved protection are not current proof. The latest repository-creation correction and exact-name conflict leave intended-repository identity, private visibility and enforcement unverified.",
    resolution: null, blocks: ["Enforced repository review and merge safeguards"] },
  { id: "CON-008", topic: "GitHub Actions workflow authorization", status: "resolved",
    issue: "Targeted workflow-file writes initially returned HTTP 404 while ordinary source writes succeeded.",
    resolution: "The user reconnected GitHub securely; the single retry succeeded with HTTP 201. Two successful source-bound GitHub Actions runs are retained in docs/valo/evidence/ci-activation.json. No required-check or protection settings were changed.",
    blocks: [] },
  { id: "CON-009", topic: "Repository visibility", status: "blocked",
    issue: "GitHub repository metadata reported private=false during this development batch, contrary to the owner's private-repository instruction.",
    resolution: "No visibility change or new application-source upload was performed. Continue retaining source in Replit; the owner must restore private visibility before synchronization can resume.",
    blocks: ["New application-source synchronization", "OPS-005 private repository prerequisite"] },
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
    gates: sourceGates.map((g, index) => ({
      id: g.id, phaseId: `P${index}`, gateId: g.id, plannedWindow: g.plannedWindow,
      status: index === 0 ? "not_passed" : "blocked",
      requiredEvidence: g.requiredEvidence, approvers: g.approvers,
      reason: "Required implementation evidence, preceding gates and operational approvals are not established.",
    })),
    uatPackages: sourceUatPackages.map(p => ({
      ...p, status: "blocked" as const, accepted: false, acceptanceEvidence: [],
      reason: "Full journey execution and required release evidence have not been recorded. Partial unit/integration checks do not complete a UAT pack.",
    })),
    releaseControls: sourceReleaseControls,
    requirements: requirements.map(r => ({ ...r, status: requirementStatus(r) })),
    conflicts,
  };
}
