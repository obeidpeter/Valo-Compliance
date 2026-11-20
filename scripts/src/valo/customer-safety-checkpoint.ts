import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const reports = [
  ["api", "review-api-tests.txt"],
  ["commerce", "review-commerce.txt"],
  ["refunds", "review-refund-tests.txt"],
  ["paymentHttp", "review-payment-http-tests.txt"],
  ["tasksAndReminders", "review-task-reminder-tests.txt"],
] as const;
const tests: Record<string, unknown> = {};
for (const [name, file] of reports) {
  const path = `generated-artifacts/valo-completion/${file}`,
    raw = await read(path);
  const count = (field: string) => {
    const value = raw.match(new RegExp(`ℹ ${field} (\\d+)`));
    assert.ok(value, `${name}: missing ${field}`);
    return Number(value[1]);
  };
  const result = {
    tests: count("tests"),
    passed: count("pass"),
    failed: count("fail"),
    skipped: count("skipped"),
  };
  assert.equal(result.failed, 0, name);
  assert.ok(raw.length < 200000, "Unexpected oversized raw report; inspect before retaining");
  const retained = `docs/valo/evidence/customer-safety-raw-${name}.txt`;
  await writeFile(new URL(retained, root), raw);
  tests[name] = {
    ...result,
    scope: "Engineering controls, not formal 80/60/60 acceptance",
    rawReport: retained,
    rawHash: hash(raw),
  };
}
const browserPath = "generated-artifacts/valo-customer-ux/browser.json",
  rawBrowser = await read(browserPath),
  browser = JSON.parse(rawBrowser);
assert.equal(browser.selection, "managed-identity-editor-safety");
assert.equal(browser.actualManagedIdentityUsed, true);
assert.equal(browser.cleanupErrors, 0);
assert.equal(browser.checks.length, 4);
assert.ok(browser.checks.every((item: { status: string }) => item.status === "pass"));
const diagnosticNames = [
  "review-editor-order-failure.json",
  "review-editor-canonical-fixture-failure.json",
  "review-editor-display-fixture-failure.json",
  "review-editor-apply-and-task-fixture-failure.json",
  "review-task-focus-trigger-failure.json",
  "review-task-native-focus-diagnostic.json",
  "review-hidden-switch-pointer-diagnostic.json",
];
const diagnostics = [];
for (const name of diagnosticNames) {
  const bytes = await read(`generated-artifacts/valo-completion/${name}`),
    value = JSON.parse(bytes);
  diagnostics.push({ name, rawHash: hash(bytes), checks: value.checks, cleanupErrors: value.cleanupErrors });
}
const diagnosticPath = "docs/valo/evidence/customer-safety-browser-iterations.json";
await writeFile(
  new URL(diagnosticPath, root),
  JSON.stringify(
    {
      scope: "Retained iteration diagnostics, not pinned code revisions or release acceptance",
      note: "Includes runner ordering/canonical fixture/input formatting/hidden-control/focus-trigger corrections and the pristine Apply-button defect. The exact final implementation is bound separately.",
      reports: diagnostics,
    },
    null,
    2,
  ) + "\n",
);
const paths = [
  "artifacts/valo/src/screens/document-editor.tsx",
  "artifacts/valo/src/components/financial-fields.tsx",
  "artifacts/valo/src/lib/use-unsaved-navigation.ts",
  "artifacts/valo/src/components/unsaved-navigation-dialog.tsx",
  "artifacts/valo/src/lib/api.ts",
  "artifacts/valo/src/screens/tasks.tsx",
  "artifacts/valo/src/screens/reminders.tsx",
  "artifacts/api-server/src/scripts/customer-experience-journey.ts",
  "artifacts/api-server/src/modules/commerce/valo-commerce.ts",
  "artifacts/api-server/src/modules/commerce/valo-commerce.integration.test.ts",
  "artifacts/api-server/src/modules/tasks/valo-tasks.ts",
  "artifacts/api-server/src/modules/tasks/valo-task-pages.integration.test.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-worker.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-delivery.integration.test.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-resend.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-resend.test.ts",
  "artifacts/api-server/src/modules/operations/valo-operations-queue.ts",
  "artifacts/api-server/src/modules/operations/valo-operations-queue.test.ts",
  "artifacts/api-server/src/workers/export-worker.ts",
  "artifacts/api-server/src/routes/valo-requirements.ts",
  "artifacts/api-server/package.json",
  "lib/api-spec/openapi.yaml",
];
const sources = await Promise.all(paths.map(async (path) => ({ path, sha256: hash(await read(path)) })));
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Synthetic development customer safety and recovery, not complete R1/R2 acceptance",
  baseSavedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  codeBinding: "Exact working-tree source hashes; these must match the saved implementation checkpoint",
  tests,
  browser: { ...browser, rawReport: browserPath, rawHash: hash(rawBrowser) },
  iterationDiagnostics: diagnosticPath,
  sources,
  controlledPaymentProvider: true,
  realPaystackCalls: 0,
  realEmailSends: 0,
  paidAiCalls: 0,
  limitations: [
    "The task corpus is a controlled 205-active-task database fixture, not 205 real customers.",
    "Receipt repair and reversal use controlled verified provider payloads, not actual merchant settlement.",
    "Four browser groups use a real managed synthetic identity and real application APIs/database; one PATCH is delayed and released unchanged to order the two-tab conflict.",
    "Type-specific twelve-editor integration is incomplete; shared guided field code remains scaffolding.",
    "Privacy fulfilment/erasure operations, verified delivery/bounce handling and rich-fact source-rule implementation remain incomplete.",
    "No new source-backed 80-rule, provider-quality 60-customer-AI or 60-editorial acceptance execution is claimed.",
    "No eligible publication, production restore, independent security review, beta, R1/R2 or launch acceptance is established.",
  ],
  r1Accepted: false,
  r2Accepted: false,
  publicLaunchEnabled: false,
  livePaymentsEnabled: false,
  acceptedRequirementIds: [],
};
const output = "docs/valo/evidence/customer-safety-reliability.json";
await writeFile(new URL(output, root), JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    { output, sha256: hash(await read(output)), tests, browserPassed: browser.checks.length },
    null,
    2,
  ),
);
