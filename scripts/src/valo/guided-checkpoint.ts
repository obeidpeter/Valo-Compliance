import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../../", import.meta.url)));
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const sourceRevision = process.argv[2] ?? "uncommitted-worktree";
const paths = [
  "lib/valo-core/src/guided.ts",
  "lib/valo-core/src/guided-specs-v1.ts",
  "lib/valo-core/src/guided-runtime-v1.ts",
  "lib/valo-core/src/money.ts",
  "lib/valo-core/package.json",
  "artifacts/valo/src/components/guided-fields.tsx",
  "artifacts/valo/src/components/guided-draft-starter.tsx",
  "artifacts/valo/src/screens/workspace.tsx",
  "artifacts/valo/src/screens/document-editor.tsx",
  "artifacts/valo/src/lib/api.ts",
  "artifacts/api-server/src/lib/valo-validation.ts",
  "artifacts/api-server/src/lib/valo-store.ts",
  "artifacts/api-server/package.json",
  "artifacts/api-server/src/lib/valo-render.ts",
  "artifacts/api-server/src/lib/valo-revision-codec.ts",
  "artifacts/api-server/src/modules/exports/valo-exports.ts",
  "artifacts/api-server/src/platform/valo-private-storage.ts",
  "artifacts/api-server/src/lib/valo-guided.test.ts",
  "artifacts/api-server/src/lib/valo-guided-test-fixtures.ts",
  "artifacts/api-server/src/scripts/customer-guided-journeys.ts",
  "artifacts/api-server/src/scripts/customer-experience-journey.ts",
];
const sourceFiles = [];
for (const path of paths) {
  const bytes = await readFile(path);
  if (sourceRevision !== "uncommitted-worktree") {
    if (!/^[0-9a-f]{40}$/.test(sourceRevision)) throw Error("FULL_CODE_REVISION_REQUIRED");
    const saved = execFileSync("git", ["show", `${sourceRevision}:${path}`], { maxBuffer: 2_000_000 });
    if (sha(bytes) !== sha(saved)) throw Error(`SOURCE_REVISION_MISMATCH:${path}`);
  }
  sourceFiles.push({ path, sha256: sha(bytes) });
}
const browserBytes = await readFile("generated-artifacts/valo-customer-ux/browser-guided.json", "utf8");
const browser = JSON.parse(browserBytes);
if (
  browser.cleanupErrors !== 0 ||
  browser.checks.length !== 13 ||
  browser.checks.some((c: { status: string }) => c.status !== "pass") ||
  browser.guidedDetails?.length !== 12 ||
  browser.guidedDetails.some((r: { formats: unknown[] }) => r.formats.length !== 2)
)
  throw Error("ALL_THIRTEEN_REAL_GUIDED_GROUPS_AND_TWENTY_FOUR_PRIVATE_EXPORTS_REQUIRED");
const tests = await readFile("generated-artifacts/valo-completion/guided-render-tests-final.txt", "utf8");
if (!/tests 37/.test(tests) || !/pass 37/.test(tests) || !/fail 0/.test(tests))
  throw Error("GUIDED_CONTROLS_DID_NOT_PASS");
const typecheck = await readFile("generated-artifacts/valo-completion/guided-typecheck-final.txt", "utf8");
if (
  !typecheck.includes("artifacts/api-server typecheck: Done") ||
  !typecheck.includes("artifacts/valo typecheck: Done") ||
  typecheck.includes("error TS")
)
  throw Error("CURRENT_TYPECHECK_REQUIRED");
const broaderApi = await readFile("generated-artifacts/valo-completion/guided-full-api-tests.txt", "utf8");
if (
  !/tests 150/.test(broaderApi) ||
  !/pass 149/.test(broaderApi) ||
  !/skipped 1/.test(broaderApi) ||
  !/fail 0/.test(broaderApi)
)
  throw Error("BROADER_API_REGRESSION_DID_NOT_MATCH_ITS_ACTUAL_RESULT");
const initialBytes = await readFile(
  "generated-artifacts/valo-completion/guided-browser-initial-failure.json",
  "utf8",
);
const out = "docs/valo/evidence";
await mkdir(out, { recursive: true });
await writeFile(`${out}/guided-private-layouts.raw.txt`, tests);
await writeFile(`${out}/guided-broader-api.raw.txt`, broaderApi);
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  sourceRevision,
  sourceFiles,
  environment: "synthetic-development-only",
  engineeringControls: {
    records: 37,
    pass: 37,
    fail: 0,
    skip: 0,
    logPath: `${out}/guided-private-layouts.raw.txt`,
    sha256: sha(tests),
    scope:
      "Typed forms, incomplete raw preservation, conditional terms, actual 24 DOCX/PDF renders, tamper rejection, decimal arithmetic and frozen historical-codec fixtures. Not an editorial or customer-AI acceptance suite.",
  },
  typecheck: { result: "pass", log: typecheck, sha256: sha(typecheck) },
  broaderApi: {
    records: 150,
    pass: 149,
    fail: 0,
    skip: 1,
    logPath: `${out}/guided-broader-api.raw.txt`,
    sha256: sha(broaderApi),
    scope:
      "Existing API regression command now includes the guided tests. Overlaps the targeted 37-record command; do not add the two counts.",
  },
  browser: { ...browser, rawReportSha256: sha(browserBytes) },
  retainedInitialRun: {
    report: JSON.parse(initialBytes),
    sha256: sha(initialBytes),
    finding:
      "Harness requested a nonexistent individual-export status URL after the actual DOCX download. Corrected to the documented document-export listing; no application status endpoint or assertion was weakened.",
  },
  publication: {
    newEligibleTemplates: 0,
    newGuidance: 0,
    newRules: 0,
    catalogueMastersUsed: 0,
    reason:
      "Question-led personal business drafts do not clear source/rights/editorial publication gates or count as catalogue masters.",
  },
  acceptance: {
    R1Accepted: false,
    R2Accepted: false,
    sourceRule80Accepted: false,
    customerAI60Accepted: false,
    editorial60Accepted: false,
    publicLaunchEnabled: false,
    livePaymentsEnabled: false,
  },
  limits: [
    "No actual Microsoft Word/manual screen-reader or real-device session was performed.",
    "No catalogue template entitlement, eligible master publication, specialist review, new AI-provider quality run, PSP execution or email delivery was claimed.",
    "The private answer forms preserve user-supplied business facts and terms; they are not legal-validity or statutory-compliance determinations.",
    "Privacy fulfilment/erasure, publication/content floors, remaining acceptance and R2 are still incomplete; missing credentials are not the only remaining work.",
  ],
};
const path = `${out}/guided-private-layouts.json`;
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    path,
    sourceRevision,
    engineeringRecords: 37,
    browserGroups: 13,
    privateExports: 24,
    eligibleContent: 0,
  }),
);
