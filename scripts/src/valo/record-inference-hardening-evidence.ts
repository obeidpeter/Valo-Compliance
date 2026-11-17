import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  out = join(root, "docs/valo/evidence/inference-hardening");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
await mkdir(out, { recursive: true });
const logs: Record<string, { path: string; sha256: string }> = {};
for (const [name, path] of Object.entries({
  entry: "/tmp/valo-inference-hardening-entry.txt",
  postgres: "/tmp/valo-inference-hardening-db.txt",
  types: "/tmp/valo-inference-hardening-types.txt",
  build: "/tmp/valo-inference-hardening-build.txt",
  exportIds: "/tmp/valo-export-exact-ids.txt",
  browser: "/tmp/valo-export-bounded-browser.txt",
})) {
  const bytes = await readFile(path, "utf8");
  await writeFile(join(out, name + ".txt"), bytes);
  logs[name] = { path: "docs/valo/evidence/inference-hardening/" + name + ".txt", sha256: hash(bytes) };
}
const history = JSON.parse(
  await readFile(
    join(
      root,
      "generated-artifacts/valo-completion/inference-budget/history-reconciliation-proposal-e0710bd0-1fb7-48dc-999d-ee8aa8c9a05c.json",
    ),
    "utf8",
  ),
);
const preparation = JSON.parse(
  await readFile(
    join(
      root,
      "generated-artifacts/valo-completion/finite-inference-proposal-9253e203-4fb4-44b5-824a-287638948f09.json",
    ),
    "utf8",
  ),
);
const proposal = preparation.proposals[0];
if (
  preparation.ownerApproved ||
  proposal.ownerApproved ||
  proposal.manifest.works.length !== 2 ||
  preparation.providerCalls !== 0
)
  throw Error("DISABLED_EXACT_PAIR_REQUIRED");
await writeFile(join(out, "disabled-next-review-manifest.json"), JSON.stringify(proposal, null, 2) + "\n");
const browser = JSON.parse(
  await readFile(
    join(root, "generated-artifacts/valo-completion/workspace-data-download-browser.json"),
    "utf8",
  ),
);
const evidence = {
  recordedAt: new Date().toISOString(),
  applicationCommit: "c6bca11d340ca9b34ca69a7160ba4146fd8357a2",
  newCode: [
    "Shared lazy SDK transport preserves outbound observation after admission and before SDK invocation.",
    "Role/corpus shapes enforced at both authority admission and real binding validation.",
    "Independent reviews require the same candidate, case, sources and immutable plan; prompts must differ.",
    "Read-only historical exposure projection retains unknown liabilities and source history.",
    "Exact export ID oracles and page JS-heap sampling added.",
  ],
  tests: {
    managedEntryAndPreparation: { passed: 39, failed: 0 },
    isolatedPostgresDispatch: { passed: 23, failed: 0 },
    nativePrivateExport: { passed: 10, failed: 0 },
    controlledBrowser: {
      passed: browser.passed,
      checks: browser.checks.length,
      exactExpectedIds: browser.exactExpectedIds,
      heapEvidence: browser.heapEvidence,
      resourceScope: browser.resourceScope,
    },
    typecheck: "passed",
    apiBuild: "passed",
  },
  history: {
    potentialChargeRecords: history.potentialChargeRecords,
    reportedUsageRecords: history.reportedUsageRecords,
    unknownOriginalRecords: history.unknownRecords,
    verifiedRetainedArtifacts: history.reconciliation.verifiedRetainedArtifacts,
    proposedReceiptResolutions: history.reconciliation.proposed.length,
    projectedExposure: history.projectedExposure,
    snapshotStillCurrent: history.snapshotStillCurrent,
    historyModified: history.historyModified,
    noRetainedRequestMetersFound: true,
    actualBillingVerified: false,
  },
  prepared: {
    manifestHash: proposal.manifestHash,
    packageId: proposal.packageId,
    expiresAt: proposal.expiresAt,
    attemptCount: 2,
    worstCaseReservationNanoUsd: proposal.worstCaseReservationNanoUsd,
    ownerApproved: false,
    providerCalls: 0,
    nativeCandidateVersion: 9,
    publicationAccepted: false,
  },
  authority: {
    enabled: false,
    ownerApproved: false,
    newProviderCalls: 0,
    ordinaryQuotasChanged: false,
    additionalAllocationCapNanoUsd: "30000000000",
    historicalChargesInsideAdditionalCap: false,
  },
  boundaries: [
    "The 23 PostgreSQL tests use controlled transport and a controlled binding hook; they are not provider-quality/content acceptance.",
    "Actual default customer entry uses the real corpus/source verifier with controlled ledger/SDK.",
    "Native prepared TPL-07 v9 passed current input/rights/mechanical/export readiness, not independent AI reviews or publication.",
    "Historical projection refines metadata read-only: no ledger state, old usage, account billing or authorization was rewritten.",
    "39/23/10 and browser checks are engineering evidence, not the formal 80/60/60 acceptance.",
    "No spending, quota increase, email, merchant action, public launch, R1/R2 acceptance or production proof.",
  ],
  logs,
};
const text = JSON.stringify(evidence, null, 2) + "\n";
await writeFile(join(root, "docs/valo/evidence/inference-hardening-development.json"), text);
console.log(
  JSON.stringify({
    sha256: hash(text),
    manifestHash: proposal.manifestHash,
    ownerApproved: false,
    providerCalls: 0,
  }),
);
