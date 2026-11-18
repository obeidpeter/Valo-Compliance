import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import { finalOperationalPublicationCheck } from "./publication-final-check";
import { heldSourceBundle } from "../../lib/valo-source-controls.fixtures";

test("final check observes evidence expiry after earlier work and refuses backdating", async () => {
  const bundle = heldSourceBundle(new Date()),
    policy = await operationalPolicy();
  // Held fixture is deliberately not a passing manifest. These assertions target
  // the time guard before the ordinary eligibility check; no release is created.
  await assert.rejects(
    finalOperationalPublicationCheck(bundle, policy.policy.hash, new Date(0), "2099-01-01T00:00:00Z"),
    /STALE_RELEASE/,
  );
  await assert.rejects(
    finalOperationalPublicationCheck(
      bundle,
      policy.policy.hash,
      new Date("2099-01-01"),
      "2000-01-01T00:00:00Z",
      new Date(0),
    ),
    /STALE_RELEASE/,
  );
});
test("final check re-reads actual narrowed owner policy after initial validation without changing default authority files", async () => {
  const original = process.cwd(),
    root = publicationWorkspaceRoot(),
    folder = await mkdtemp(join(tmpdir(), "valo-policy-final-"));
  try {
    for (const path of [
      "docs/specification/master-execution-prompt.txt",
      "docs/valo/policies/operational-publication-authority.md",
    ]) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await copyFile(join(root, path), join(folder, path));
    }
    process.chdir(folder);
    const before = await operationalPolicy();
    await writeFile(
      join(folder, "docs/valo/policies/operational-publication-restrictions.json"),
      JSON.stringify({
        version: "controlled-after-io",
        reason: "Owner scope narrowing during a controlled isolated validation test",
        excludedClasses: [before.policy.allowedClasses[0]!],
      }),
    );
    assert.notEqual((await operationalPolicy()).policy.hash, before.policy.hash);
    await assert.rejects(
      finalOperationalPublicationCheck(
        heldSourceBundle(new Date()),
        before.policy.hash,
        new Date("2099-01-01"),
        "2099-01-01T00:00:00Z",
      ),
      /POLICY_CHANGED_DURING_VALIDATION/,
    );
  } finally {
    process.chdir(original);
    await rm(folder, { recursive: true, force: true });
  }
});
