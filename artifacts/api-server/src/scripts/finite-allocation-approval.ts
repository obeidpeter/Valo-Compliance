import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import {
  allocationPackageId,
  approveFiniteAllocationPackage,
  listFiniteAllocationApprovals,
  MAX_PACKAGE_APPROVAL_HOURS,
  prepareFiniteAllocationPackage,
  finitePackagePreparers,
  practicalReviewLimitsFor,
  revokeFiniteAllocationPackage,
  validateAllocationPackage,
  type FiniteAllocationPackage,
} from "../modules/ai";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * Operator command, development only, for the owner's approval of a finite AI allocation. Running
 * `approve` authorizes spending up to the allocation's cap, so only the product owner runs it, or an
 * operator on their written instruction. Building or testing this command spends nothing.
 *
 *   tsx src/scripts/finite-allocation-approval.ts prepare <package.json> [--editorial-cases | --guide-pairs | --practical-guide-pairs | --reminder-inventory-pairs]
 *     Writes the current package to <package.json> and prints its id and limits. Writes nothing else.
 *     The package admits the template review pairs, or with --editorial-cases only the case-bound
 *     editorial cases' review pairs (decision 0015), or with --guide-pairs only the review pairs of
 *     guides that say what the law requires (decision 0017): each approval covers one kind of work.
 *     A guide package is written for reading only: `approve` refuses it, since the publisher
 *     releases a guide only after the owner's source check (decision 0018) and its reviews would
 *     release nothing.
 *   tsx src/scripts/finite-allocation-approval.ts status
 *     Lists every recorded package approval. Read-only.
 *   VALO_RECORD_OWNER_INFERENCE_APPROVAL=owner-approved-exact-finite-package \
 *   tsx src/scripts/finite-allocation-approval.ts approve <package.json> --confirm <package id> \
 *     --approved-by <who approved> --reference <where the approval is written> [--hours 24]
 *     Records the owner's approval of that exact package for at most 24 hours.
 *   tsx src/scripts/finite-allocation-approval.ts revoke --confirm <package id>
 *     Stops all new work under that package at once.
 *
 * Every mode needs NODE_ENV=development and refuses a deployment.
 */
const usage =
  "usage: finite-allocation-approval.ts prepare <package.json> [--editorial-cases | --guide-pairs | --practical-guide-pairs | --reminder-inventory-pairs] | status | approve <package.json> --confirm <id> --approved-by <name> --reference <text> [--hours n] | revoke --confirm <id>";
const [mode, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index < 0 ? undefined : rest[index + 1];
};
const nanoToUsd = (nano: string) => (Number(BigInt(nano) / 1_000_000n) / 1000).toFixed(2);
const limits = (pkg: FiniteAllocationPackage) => ({
  packageId: allocationPackageId(pkg),
  preparedAt: pkg.preparedAt,
  allocation: pkg.allocation.id,
  capUsd: nanoToUsd(pkg.allocation.capNanoUsd),
  laneAttemptLimits: pkg.laneAttemptLimits,
  contentIds: pkg.contentIds.length,
  namedContentSections: pkg.namedContentSections.length,
  corpusCases: Object.fromEntries(pkg.corpora.map((c) => [c.name, c.cases.length])),
  supportedPreparers: pkg.supportedPreparers,
  practicalReviewLimits: practicalReviewLimitsFor(pkg.supportedPreparers),
  holds: pkg.holds,
  longestApprovalHours: MAX_PACKAGE_APPROVAL_HOURS,
});
try {
  assertDevelopmentRuntime();
  if (mode === "prepare") {
    const [out, choice, ...more] = rest;
    if (
      !out ||
      out.startsWith("--") ||
      more.length ||
      (choice !== undefined &&
        choice !== "--editorial-cases" &&
        choice !== "--guide-pairs" &&
        choice !== "--practical-guide-pairs" &&
        choice !== "--reminder-inventory-pairs")
    )
      throw new Error(usage);
    const pkg = await prepareFiniteAllocationPackage(
      new Date(),
      choice === "--editorial-cases"
        ? finitePackagePreparers.editorialCases
        : choice === "--guide-pairs"
          ? finitePackagePreparers.guidePairs
          : choice === "--reminder-inventory-pairs"
            ? finitePackagePreparers.reminderInventoryPairs
            : choice === "--practical-guide-pairs"
              ? finitePackagePreparers.practicalPairs
              : finitePackagePreparers.templatePairs,
    );
    validateAllocationPackage(pkg);
    // `wx` never overwrites: a package the owner may already have read stays as it was.
    await writeFile(out, `${JSON.stringify(pkg, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ written: out, ...limits(pkg) }, null, 2)}\n`);
  } else if (mode === "status") {
    process.stdout.write(`${JSON.stringify(await listFiniteAllocationApprovals(pool), null, 2)}\n`);
  } else if (mode === "approve") {
    const file = rest[0],
      confirmPackageId = option("--confirm"),
      approvedBy = option("--approved-by"),
      reference = option("--reference"),
      hours = Number(option("--hours") ?? MAX_PACKAGE_APPROVAL_HOURS);
    if (!file || !confirmPackageId || !approvedBy || !reference) throw new Error(usage);
    if (process.env.VALO_RECORD_OWNER_INFERENCE_APPROVAL !== "owner-approved-exact-finite-package")
      throw new Error("OWNER_APPROVAL_ACKNOWLEDGEMENT_REQUIRED");
    const pkg = JSON.parse(await readFile(file, "utf8")) as FiniteAllocationPackage;
    const approval = await approveFiniteAllocationPackage(pool, pkg, {
      confirmPackageId,
      approvedBy,
      reference,
      hours,
    });
    process.stdout.write(`${JSON.stringify({ ...approval, ...limits(pkg) }, null, 2)}\n`);
  } else if (mode === "revoke") {
    const confirmPackageId = option("--confirm");
    if (!confirmPackageId) throw new Error(usage);
    process.stdout.write(
      `${JSON.stringify(await revokeFiniteAllocationPackage(pool, confirmPackageId), null, 2)}\n`,
    );
  } else throw new Error(usage);
} finally {
  await pool.end();
}
