import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { digest } from "@workspace/valo-core";
import { evaluateBusinessNameCandidate } from "@workspace/valo-core/checker-business-name";
import { evaluateSourceCandidateOffline, remainingSourceCandidateIds } from "@workspace/valo-core/checker-source-candidates";
import { bindBusinessNameCandidate } from "../editorial/business-name-candidate-binding";
import { bindRemainingSourceCandidates } from "../editorial/source-candidate-bindings";

const { binding, provenance, corpus } = bindBusinessNameCandidate();
const families = bindRemainingSourceCandidates();
const challengePath="docs/valo/source-checker-challenges-v1.json";
const workspaceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
const challengeBytes=readFileSync(resolve(workspaceRoot,challengePath));
const challenge=JSON.parse(challengeBytes.toString("utf8"));
if(challenge.formalPipelineProviderReceipt!==false||challenge.acceptedOracleReplacement!==false||
  challenge.originalCorpusPath!=="docs/evaluation-candidates/checker.json")
  throw Error("Preparation cannot masquerade as a provider receipt or accepted oracle");
const independentPreparation={path:challengePath,sha256:createHash("sha256").update(challengeBytes).digest("hex"),
  version:challenge.version,formalPipelineProviderReceipt:false,acceptedOracleReplacement:false,
  originalCorpusSha256:createHash("sha256").update(readFileSync(resolve(workspaceRoot,challenge.originalCorpusPath))).digest("hex")};
if(independentPreparation.originalCorpusSha256!==challenge.originalCorpusSha256)
  throw Error("Original corpus changed; preserve it and version any proposed adaptation separately");
const results = corpus.cases.map(c => {
  const isCama = c.sourceCandidateID === "CAND-CAMA-814-BUSINESS-NAME";
  const family = families[c.sourceCandidateID];
  if (!isCama && !family)
    return { caseId: c.caseID, executed: false, status: "unimplemented_source_family",
      inputHash: digest(c.facts), publicationEligibility: false };
  const actualBinding = isCama ? binding : family!.binding;
  const evaluate = () => isCama
    ? evaluateBusinessNameCandidate(c.facts, c.assessmentDate, actualBinding)
    : evaluateSourceCandidateOffline(c.sourceCandidateID as typeof remainingSourceCandidateIds[number],
      c.facts, c.assessmentDate, actualBinding);
  const actual = evaluate();
  const repeated = evaluate();
  const expected = (c as typeof c & {
    expectedOutcomeCandidate: { customerLabelCandidate: string };
  }).expectedOutcomeCandidate.customerLabelCandidate;
  const checks = {
    authoredLabelMatched: actual.label === expected,
    exactInputPreserved: actual.inputHash === digest(c.facts),
    reproducibleResult: actual.resultHash === repeated.resultHash,
    exactCandidateAndSourcesBound: actual.bindingHash === actualBinding.bindingHash,
    noCustomerEligibility: actual.eligibleForCustomerUse === false && actual.releasedManifestId === null,
    noCustomerTaskOrStatutorySchedule: actual.createRegistrationTask === false &&
      actual.automaticReminder === false && actual.automaticStatutoryDeadline === null,
    explicitLocalCoverageGap: actual.stateAndLocalCoverage === "not_evaluated" && actual.gaps.length === 2,
    unknownsNotExemptions: !actual.missingFacts.length ||
      ["More information needed", "May apply"].includes(actual.label),
  };
  return { caseId: c.caseID, executed: true, status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    expectedLabel: expected, actual, checks,
    independentPreparationFindings:challenge.findings.filter((f:{caseIds?:string[];caseFamily?:string})=>
      f.caseIds?.includes(c.caseID)||(f.caseFamily&&c.caseID.startsWith("CHK-CAND-CAMA-"))) };
});
const executed = results.filter(r => r.executed);
const failures = executed.filter(r => r.status === "failed");
const controlsPath = process.argv.find(a => a.startsWith("--retain-controls="))?.slice("--retain-controls=".length);
let engineeringControls: { path: string; sha256: string; tapRecords: number; acceptedLegalCases: number } | null = null;
if (controlsPath) {
  const bytes = readFileSync(resolve(controlsPath));
  const text = bytes.toString("utf8");
  const total = Number(text.match(/(?:ℹ|#)\s+tests\s+(\d+)/u)?.[1]);
  const passes = Number(text.match(/(?:ℹ|#)\s+pass\s+(\d+)/u)?.[1]);
  const failed = Number(text.match(/(?:ℹ|#)\s+fail\s+(\d+)/u)?.[1]);
  const ids = new Set(text.match(/CHK-CAND-(?:CAMA|NDPA|NTAA|NAFDAC)-\d{3}/gu));
  if (!total || passes !== total || failed !== 0 || ids.size !== 80)
    throw new Error("Actual passing controls for all 80 authored input IDs must be retained");
  const retainedPath=relative(workspaceRoot,resolve(controlsPath));
  if(!retainedPath.startsWith("docs/valo/evidence/"))
    throw Error("Persist controls under docs/valo/evidence before binding; historical receipts are never overwritten");
  engineeringControls = { path: retainedPath,
    sha256: createHash("sha256").update(bytes).digest("hex"), tapRecords: total, acceptedLegalCases: 0 };
}
const harnessFiles = [
  import.meta.url,
  new URL("../editorial/business-name-candidate-binding.ts", import.meta.url).href,
  new URL("../editorial/source-candidate-bindings.ts", import.meta.url).href,
  new URL("../editorial/business-name-candidate-evaluation.test.ts", import.meta.url).href,
  new URL("../editorial/source-candidate-evaluation.test.ts", import.meta.url).href,
  new URL("../editorial/source-review-clarifications.test.ts", import.meta.url).href,
].map(url => ({ path: relative(fileURLToPath(new URL("../../../../", import.meta.url)), fileURLToPath(url)),
  hash: createHash("sha256").update(readFileSync(new URL(url))).digest("hex") }));
const report = {
  schemaVersion: "source-checker-candidate-run-v1",
  generatedAt: new Date().toISOString(),
  baseSavedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  codeBinding: "Exact source/algorithm/corpus file hashes below bind this working-tree run; base commit alone is not the new code revision.",
  ...provenance, bindingHash: binding.bindingHash,
  additionalFamilyBindings: families,
  harnessFiles, engineeringControls, independentPreparation,
  summary: { authoredCases: corpus.cases.length, executed: executed.length,
    passed: executed.length - failures.length, failed: failures.length,
    unexecuted: results.length - executed.length,
    formal80CaseAcceptance: false, independentChallengeExecuted: false,
    independentPreparationRecorded:true,formalPipelineOracleChallengeReceipt:false,
    customerAi60Acceptance: false, editorial60Acceptance: false,
    realProviderCalls: 0, publishedRules: 0 },
  limitations: [
    "Original expected labels are unchanged. Source-supported disagreements remain failures against that original oracle, not silently corrected passes.",
    "Source/algorithm bindings identify exactly which raw bytes or retained passages were reverified; no blanket new-retrieval claim is made.",
    "Matching authored candidate labels is not independent expected-outcome challenge or legal accuracy certification.",
    "This isolated run never creates eligible manifests, customer assessments, tasks or reminders.",
  ],
  results,
};
const output = process.argv.find(a => a.startsWith("--output="))?.slice("--output=".length);
if (!output) throw new Error("An explicit --output path is required to retain actual results");
const path = resolve(output);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report.summary, report: path,
  sha256: createHash("sha256").update(JSON.stringify(report, null, 2) + "\n").digest("hex") }, null, 2));
// The incomplete 80-case suite must not produce a green completion signal.
process.exitCode = failures.length ? 1 : results.length !== executed.length ? 2 : 0;
