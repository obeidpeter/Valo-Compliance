import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../../../", import.meta.url)));
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const sourceRevision = process.argv[2] ?? "uncommitted-worktree";
const paths = [
  "artifacts/api-server/src/lib/valo-privacy.ts",
  "artifacts/api-server/src/lib/valo-privacy-state.ts",
  "artifacts/api-server/src/lib/valo-privacy-processing.ts",
  "artifacts/api-server/src/lib/valo-privacy-state.test.ts",
  "artifacts/api-server/src/lib/valo-customer-access.ts",
  "artifacts/api-server/src/lib/valo-store.ts",
  "artifacts/api-server/src/routes/valo-customer-access.ts",
  "artifacts/api-server/src/scripts/privacy-case-proof.ts",
  "artifacts/api-server/src/scripts/customer-experience-journey.ts",
  "artifacts/api-server/src/scripts/apply-refund-lifecycle.ts",
  "artifacts/api-server/package.json",
  "artifacts/valo/src/components/privacy-cases.tsx",
  "artifacts/valo/src/screens/privacy-operations.tsx",
  "artifacts/valo/src/screens/account.tsx",
  "artifacts/valo/src/screens/staff.tsx",
  "artifacts/valo/src/App.tsx",
  "lib/db/src/schema/valo-privacy.ts",
  "lib/db/src/schema/valo-support.ts",
  "lib/db/src/schema/valo-customer-access.ts",
  "lib/db/src/schema/index.ts",
  "lib/db/drizzle/0017_privacy_cases.sql",
  "lib/db/drizzle/meta/_journal.json",
  "lib/api-spec/openapi.yaml",
];
const sourceFiles = [];
for (const path of paths) {
  const bytes = await readFile(path);
  if (sourceRevision !== "uncommitted-worktree") {
    if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw Error("FULL_SOURCE_REVISION_REQUIRED");
    if (
      sha(execFileSync("git", ["show", `${sourceRevision}:${path}`], { maxBuffer: 2_000_000 })) !== sha(bytes)
    )
      throw Error("SOURCE_MISMATCH:" + path);
  }
  sourceFiles.push({ path, sha256: sha(bytes) });
}
const read = async (name: string) => readFile("generated-artifacts/valo-completion/" + name, "utf8");
const native = JSON.parse(await read("privacy-case-proof.json"));
if (
  native.passed !== 10 ||
  native.failed !== 0 ||
  native.cleanupErrors !== 0 ||
  native.completePrivacyFulfilment !== false
)
  throw Error("ACTUAL_NATIVE_CHECKS_REQUIRED");
const browserText = await readFile(
    "generated-artifacts/valo-customer-ux/browser-support-details.json",
    "utf8",
  ),
  browser = JSON.parse(browserText);
if (
  browser.checks.length !== 4 ||
  browser.checks.some((c: { status: string }) => c.status !== "pass") ||
  browser.cleanupErrors !== 0
)
  throw Error("ACTUAL_FOUR_BROWSER_GROUPS_REQUIRED");
const tests = await read("privacy-broader-api.raw.txt"),
  pure = await read("privacy-state.raw.txt"),
  typecheck = await read("privacy-typecheck.txt");
if (
  !/tests 154/.test(tests) ||
  !/pass 153/.test(tests) ||
  !/fail 0/.test(tests) ||
  !/skipped 1/.test(tests) ||
  !/tests 4/.test(pure) ||
  !/pass 4/.test(pure) ||
  !/fail 0/.test(pure)
)
  throw Error("ACTUAL_REGRESSION_RESULTS_REQUIRED");
if (
  typecheck.includes("error TS") ||
  !typecheck.includes("artifacts/api-server typecheck: Done") ||
  !typecheck.includes("artifacts/valo typecheck: Done")
)
  throw Error("PASSING_TYPECHECK_REQUIRED");
const migration = JSON.parse(await read("0017_privacy_cases-development-migration.json"));
if (
  !migration.applied ||
  migration.productionApplied ||
  migration.sqlHash !== sha(await readFile("lib/db/drizzle/0017_privacy_cases.sql"))
)
  throw Error("EXACT_DEVELOPMENT_MIGRATION_RECEIPT_REQUIRED");
const dir = "docs/valo/evidence";
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/privacy-cases-api.raw.txt`, tests);
await writeFile(`${dir}/privacy-cases-state.raw.txt`, pure);
const report = {
  schemaVersion: 1,
  sourceRevision,
  sourceFiles,
  checkedAt: new Date().toISOString(),
  environment: "synthetic-development-only",
  native,
  browser: { ...browser, rawReportSha256: sha(browserText) },
  migration,
  regression: {
    records: 154,
    passed: 153,
    failed: 0,
    skipped: 1,
    logPath: `${dir}/privacy-cases-api.raw.txt`,
    sha256: sha(tests),
  },
  stateControls: {
    records: 4,
    passed: 4,
    failed: 0,
    logPath: `${dir}/privacy-cases-state.raw.txt`,
    sha256: sha(pure),
    overlapsRegression: true,
  },
  typecheck: { result: "pass", log: typecheck, sha256: sha(typecheck) },
  working: [
    "Atomic idempotent requests with durable support limits; explicit owner verification and cancellation.",
    "Tenant-scoped processing history, version conflicts, keyed state/audit integrity and private prepared results.",
    "Separate privacy-role/fresh-MFA-gated assignment and staff operations; real role/MFA authentication remains unproved.",
    "Actual named-section JSON preparation and actual current-profile revision outcomes, both explicitly partial.",
  ],
  notImplemented: [
    "Resumable erasure and application/provider deletion.",
    "Operational deletion tombstones and restore reapplication; a table alone is not a working process.",
    "Coordinated provider-wide export/correction and approved retention/hold handling.",
  ],
  boundaries: {
    completePrivacyFulfilment: false,
    realPrivilegedClerkSession: false,
    realProviderErasure: false,
    emailSent: false,
    paymentProviderExecuted: false,
    newEligiblePublications: 0,
    R1Accepted: false,
    R2Accepted: false,
    sourceRule80Accepted: false,
    customerAI60Accepted: false,
    editorial60Accepted: false,
    livePaymentsEnabled: false,
    publicLaunchEnabled: false,
  },
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(`${dir}/privacy-cases-checkpoint.json`, bytes);
console.log(
  JSON.stringify({
    sourceRevision,
    reportSha256: sha(bytes),
    nativePassed: 10,
    browserGroupsPassed: 4,
    completePrivacyFulfilment: false,
  }),
);
