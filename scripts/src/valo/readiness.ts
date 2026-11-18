import { baselineTemplates, additionalCandidates, catalogueSummary } from "@workspace/valo-core";
import { readiness } from "@workspace/valo-records";
import { CI_EVIDENCE_REGISTER, evidenceByRequirement, readCitations, readTestRecords } from "./ci-evidence";
import { coverageReport, readAreaCoverage } from "./code-coverage";

// VALO_EVIDENCE_RESULTS_DIR names the test results CI's jobs recorded in this run (the evidence
// job sets it). Without it the register's citations are listed as not run. Evidence never
// changes a requirement's status: every requirement stays blocked until its acceptance evidence
// and approvals exist.
const resultsDirectory = process.env.VALO_EVIDENCE_RESULTS_DIR;
const records = resultsDirectory ? readTestRecords(resultsDirectory) : undefined;
const ciEvidence = evidenceByRequirement(readCitations(), records);
const results = [...ciEvidence.values()].flat() as { result: string }[];
const report = readiness();

process.stdout.write(
  JSON.stringify(
    {
      ...report,
      requirements: report.requirements.map((requirement) => ({
        ...requirement,
        evidence: [...requirement.evidence, ...(ciEvidence.get(requirement.id) ?? [])],
      })),
      ciEvidence: {
        register: CI_EVIDENCE_REGISTER,
        resultsFromThisRun: records !== undefined,
        citations: results.length,
        passed: results.filter((r) => r.result === "pass").length,
        failed: results.filter((r) => r.result === "fail").length,
        notRun: results.filter((r) => r.result === "not_run").length,
      },
      // NFR-011's coverage report from the database job of this run, when there is one.
      codeCoverage: resultsDirectory ? coverageReport(readAreaCoverage(resultsDirectory)) : null,
      catalogueSummary,
      baselineTemplates,
      additionalCandidates,
    },
    null,
    2,
  ) + "\n",
);
