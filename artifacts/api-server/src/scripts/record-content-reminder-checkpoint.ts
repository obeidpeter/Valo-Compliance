import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "../modules/publication";
import { reminderEmailConfiguration } from "../modules/tasks";
const root = publicationWorkspaceRoot(),
  from = resolve(root, "generated-artifacts/valo-completion"),
  to = resolve(root, "docs/valo/evidence");
await mkdir(to, { recursive: true });
const tests = async (file: string) => {
  const text = await readFile(resolve(from, file), "utf8");
  const count = (key: string) => {
    const found = text.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`));
    return found ? Number(found[1]) : null;
  };
  return {
    total: count("tests"),
    passed: count("pass"),
    failed: count("fail"),
    skipped: count("skipped"),
    sha256: sha256(text),
  };
};
const render = JSON.parse(await readFile(resolve(from, "template-samples/report.json"), "utf8"));
const plan = JSON.parse(await readFile(resolve(from, "operational-review-ready.json"), "utf8"));
const report = {
  executedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  source: "Actual retained execution outputs; no model-generated pass verdicts",
  api: await tests("api-tests.txt"),
  database: await tests("db-tests.txt"),
  templateSamples: {
    passed: render.passed,
    total: render.total,
    formats: ["docx", "pdf"],
    providerCalls: render.providerCalls,
    canonicalBodiesComplete: render.results.every((r: { passed: boolean }) => r.passed),
    published: false,
    limitation:
      "Draft reader extraction and page bounds only; not customer publication or Microsoft Word UI verification",
  },
  reviewPlan: plan,
  publication: { templates: 0, guidance: 0, rules: 0, newProviderCalls: 0 },
  requiredAcceptanceSuites: {
    rules80: "not accepted",
    customerAI60: "not accepted",
    editorial60: "not accepted",
  },
  email: {
    authorizedConnectionAttached: true,
    providerDeliveryProved: false,
    controlledTransportOnly: true,
    nativeConnectionReadiness: JSON.parse(
      await readFile(resolve(from, "resend-connection-readiness.json"), "utf8"),
    ),
    developmentSenderConfigured: reminderEmailConfiguration() !== null,
    automaticOutboxEnabled: process.env.VALO_EMAIL_OUTBOX_ENABLED === "development-test",
  },
  existingDevelopmentBaselineAdopted: false,
  productionMigrationApplied: false,
  productionRecoveryProved: false,
  r1Accepted: false,
  r2Unlocked: false,
  publicLaunchEnabled: false,
  livePaymentsEnabled: false,
};
for (const [source, target] of [
  ["api-tests.txt", "content-intake-api-tests.txt"],
  ["db-tests.txt", "content-intake-db-tests.txt"],
  ["template-samples/report.json", "r1-template-draft-reader-checks.json"],
  ["editorial-meter-development-migration.json", "editorial-meter-development-migration.json"],
  ["reminder-retry-development-migration.json", "reminder-retry-development-migration.json"],
  ["reminder-window-development-migration.json", "reminder-window-development-migration.json"],
  ["../valo-commerce/clean-migrations.json", "content-intake-clean-migrations.json"],
] as const)
  await copyFile(resolve(from, source), resolve(to, target));
await writeFile(
  resolve(to, "content-intake-reminder-checkpoint.json"),
  JSON.stringify(report, null, 2) + "\n",
);
