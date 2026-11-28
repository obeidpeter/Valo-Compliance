import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { GUIDANCE_POLICY_PATH, guidancePolicy } from "./guidance-policy";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import { practicalGuidePreparationPolicy, practicalGuideReleasePolicy } from "./practical-guide";
import { finalOperationalPublicationCheck } from "./publication-final-check";
import { releasePolicyKind, templateLawPolicy } from "./template-law-policy";
import { heldSourceBundle } from "../sources/valo-source-controls.fixtures";

test("the reminder and inventory release decision covers only their first reviewed versions and can be withdrawn", async () => {
  const root = publicationWorkspaceRoot();
  const original = process.cwd();
  const folder = await mkdtemp(join(tmpdir(), "valo-practical-release-decision-"));
  const decision = "docs/valo/policies/practical-reminder-inventory-release.md";
  const next = [
    { id: "GUIDE-C03", version: 1 },
    { id: "GUIDE-C04", version: 1 },
  ];
  try {
    for (const path of [
      "docs/specification/master-execution-prompt.txt",
      "docs/valo/policies/operational-publication-authority.md",
      "docs/valo/policies/practical-business-guides.md",
      "docs/valo/policies/practical-reminder-inventory-preparation.md",
    ]) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await copyFile(join(root, path), join(folder, path));
    }
    process.chdir(folder);
    const first = { id: "GUIDE-C01", version: 1 };
    const firstPolicy = await practicalGuidePreparationPolicy(first.id);
    assert.equal((await practicalGuideReleasePolicy(first))?.policy.hash, firstPolicy.policy.hash);
    for (const draft of next) assert.equal(await practicalGuideReleasePolicy(draft), null);
    await copyFile(join(root, decision), join(folder, decision));
    for (const draft of next) {
      const reviewed = await practicalGuidePreparationPolicy(draft.id);
      assert.notEqual(reviewed.policy.hash, firstPolicy.policy.hash);
      assert.equal((await practicalGuideReleasePolicy(draft))?.policy.hash, reviewed.policy.hash);
      assert.equal(await practicalGuideReleasePolicy({ ...draft, version: 2 }), null);
    }
    assert.equal(await practicalGuideReleasePolicy({ id: "GUIDE-C05", version: 1 }), null);
    await writeFile(join(folder, decision), "Controlled withdrawal in the isolated policy test.");
    for (const draft of next) assert.equal(await practicalGuideReleasePolicy(draft), null);
    assert.equal((await practicalGuideReleasePolicy(first))?.policy.hash, firstPolicy.policy.hash);
  } finally {
    process.chdir(original);
    await rm(folder, { recursive: true, force: true });
  }
});

// The fixture is a form here: the templates' policy governs a form, and the guidance policy a guide.
test("final check observes evidence expiry after earlier work and refuses backdating", async () => {
  const bundle = heldSourceBundle(new Date(), false),
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
        heldSourceBundle(new Date(), false),
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
test("final check holds a guide to the guidance policy, which the owner's restriction file also narrows", async () => {
  const guide = heldSourceBundle(new Date()),
    templates = await operationalPolicy(),
    guidance = await guidancePolicy();
  assert.equal(guide.candidate.contentClass, "sourced_guidance");
  // The templates' policy is not a guide's policy: its hash is refused as a changed policy.
  await assert.rejects(
    finalOperationalPublicationCheck(
      guide,
      templates.policy.hash,
      new Date("2099-01-01"),
      "2099-01-01T00:00:00Z",
    ),
    /POLICY_CHANGED_DURING_VALIDATION/,
  );
  // Under the guidance policy the time guard and the gate apply as they do to a form.
  await assert.rejects(
    finalOperationalPublicationCheck(guide, guidance.policy.hash, new Date(0), "2099-01-01T00:00:00Z"),
    /STALE_RELEASE/,
  );

  const original = process.cwd(),
    root = publicationWorkspaceRoot(),
    folder = await mkdtemp(join(tmpdir(), "valo-guidance-policy-final-"));
  try {
    for (const path of ["docs/specification/master-execution-prompt.txt", GUIDANCE_POLICY_PATH]) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await copyFile(join(root, path), join(folder, path));
    }
    process.chdir(folder);
    assert.equal((await guidancePolicy()).policy.hash, guidance.policy.hash);
    // The owner suspends publication after a guide's first checks: the guide's policy changes too.
    await writeFile(
      join(folder, "docs/valo/policies/operational-publication-restrictions.json"),
      JSON.stringify({
        version: "controlled-suspension",
        reason: "Owner suspension during a controlled isolated validation test",
        suspended: true,
      }),
    );
    const suspended = await guidancePolicy();
    assert.deepEqual(suspended.policy.allowedClasses, []);
    assert.notEqual(suspended.policy.hash, guidance.policy.hash);
    await assert.rejects(
      finalOperationalPublicationCheck(
        guide,
        guidance.policy.hash,
        new Date("2099-01-01"),
        "2099-01-01T00:00:00Z",
      ),
      /POLICY_CHANGED_DURING_VALIDATION/,
    );
    // Excluding the guides' class does the same, and excluding a form's class leaves guides alone.
    await writeFile(
      join(folder, "docs/valo/policies/operational-publication-restrictions.json"),
      JSON.stringify({
        version: "controlled-exclusion",
        reason: "Owner exclusion of guides during a controlled isolated validation test",
        excludedClasses: ["sourced_guidance"],
      }),
    );
    assert.deepEqual((await guidancePolicy()).policy.allowedClasses, []);
    await writeFile(
      join(folder, "docs/valo/policies/operational-publication-restrictions.json"),
      JSON.stringify({
        version: "controlled-forms-only",
        reason: "Owner exclusion of forms during a controlled isolated validation test",
        excludedClasses: ["general_template"],
      }),
    );
    assert.deepEqual((await guidancePolicy()).policy.allowedClasses, ["sourced_guidance"]);
  } finally {
    process.chdir(original);
    await rm(folder, { recursive: true, force: true });
  }
});
// A template that states the law answers to its own policy, never the templates' (docs/architecture/
// reviewed-route.md, part 4). The fixture is the form above, said to be prepared from the law.
test("final check holds a template that states the law to its own policy, not the templates'", async () => {
  const form = heldSourceBundle(new Date(), false);
  const lawTemplate = { ...form, candidate: { ...form.candidate, evidenceMode: "regulatory" as const } };
  assert.equal(releasePolicyKind(lawTemplate.candidate), "template_law");
  const templates = await operationalPolicy(),
    own = await templateLawPolicy();
  assert.notEqual(own.policy.hash, templates.policy.hash);
  // The templates' policy is not its policy: its hash is refused as a changed policy.
  await assert.rejects(
    finalOperationalPublicationCheck(
      lawTemplate,
      templates.policy.hash,
      new Date("2099-01-01"),
      "2099-01-01T00:00:00Z",
    ),
    /POLICY_CHANGED_DURING_VALIDATION/,
  );
  // Under its own policy the time guard applies as it does to a form.
  await assert.rejects(
    finalOperationalPublicationCheck(lawTemplate, own.policy.hash, new Date(0), "2099-01-01T00:00:00Z"),
    /STALE_RELEASE/,
  );
});
