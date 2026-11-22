import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * When a published guide is shown on the site.
 *
 * A template is shown only while the policy it was released under is the templates' policy as it
 * stands. A guide answers to the guidance policy in the same way: once the owner edits the policy
 * file, which ends the approval, or suspends publication, every guide leaves the site until it is
 * released again.
 *
 * Nothing here is published and no database is used. The "published" guide is an object in memory:
 * GUD-01's real bundle under the policy as the owner approved it, with two made-up reviews, which
 * the real gate calls eligible. The database, the source check and the provider-permission check are
 * stand-ins; the rule itself and the gate are real.
 */
test("a published guide is shown only while its policy stands, its sources are current and its permission is current", async (t) => {
  // The clock is fixed: the amendment records a guide's sources rest on are good for 30 days.
  const day = new Date("2026-11-22T08:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: +day });

  const { evaluatePublication, sha256 } = await import("@workspace/valo-core");
  const policyModule = await import("../publication/guidance-policy");
  const { publicationWorkspaceRoot } = await import("../publication/operational-policy");
  const { assembledGuide, withMadeUpReviews } = await import("../publication/guidance-release.fixtures");
  const guideDocument = await import("../publication/guidance-document");

  const policyFile = readFileSync(
    resolve(publicationWorkspaceRoot(), policyModule.GUIDANCE_POLICY_PATH),
    "utf8",
  );
  // The policy as it stands: the owner approved the file on 22 November 2026.
  const approved = (await policyModule.guidancePolicy()).policy;
  assert.equal(policyModule.guidancePolicyApprovedHash(), sha256(policyFile));
  // Two what-ifs: the same file with no approval recorded, and the policy after an edit that the
  // owner approved anew.
  const unapproved = (await policyModule.guidancePolicy({ approvedHash: null })).policy;
  const edited = `${policyFile}\nA line added after the guide was published.\n`;
  const approvedAfterEdit = (
    await policyModule.guidancePolicy({
      approvedHash: sha256(edited),
      read: async (path) =>
        path === policyModule.GUIDANCE_POLICY_PATH
          ? edited
          : Promise.reject(Object.assign(Error("no file"), { code: "ENOENT" })),
    })
  ).policy;
  // And the approved policy while the owner's restriction file suspends publication.
  const suspended = (
    await policyModule.guidancePolicy({
      approvedHash: sha256(policyFile),
      read: async (path) =>
        path === policyModule.GUIDANCE_POLICY_PATH
          ? policyFile
          : JSON.stringify({
              version: "supposed-for-a-test",
              reason: "Publication is suspended while a complaint is read (supposed for a test).",
              suspended: true,
            }),
    })
  ).policy;
  assert.equal(approved.ownerApproved, true);
  assert.equal(unapproved.ownerApproved, false);
  assert.equal(approvedAfterEdit.ownerApproved, true);
  assert.deepEqual(suspended.allowedClasses, []);
  assert.equal(new Set([approved.hash, unapproved.hash, approvedAfterEdit.hash, suspended.hash]).size, 4);

  const assembled = await assembledGuide("GUD-01", day, { policy: approved });
  const bundle = withMadeUpReviews(assembled.bundle);
  assert.deepEqual(evaluatePublication(bundle, day), { decision: "eligible", reasons: [] });
  const guide = {
    id: "00000000-0000-4000-8000-00000000d001",
    templateId: "GUD-01",
    version: 1,
    slug: "check-the-name-you-trade-under",
    policyId: approved.version,
    candidateHash: bundle.candidate.hash,
    bundle,
    attestations: {},
    status: "published",
    reviewBy: new Date(bundle.candidate.reviewBy!),
  };

  // What the stand-ins answer; each case below changes one of them.
  const world = { guidance: approved, sourcesCurrent: true, permissionCurrent: true, policyReads: 0 };
  const tables = {
    valoContentVersions: { id: "content.id", policyId: "content.policy", status: "content.status" },
    valoPublicationPolicies: { id: "policy.id", hash: "policy.hash" },
  };
  t.mock.module("@workspace/db", {
    namedExports: {
      ...tables,
      db: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: async () => [{ content: guide, policy: { id: approved.version, hash: approved.hash } }],
            }),
          }),
        }),
      },
    },
  });
  t.mock.module(new URL("../publication/index.ts", import.meta.url).href, {
    namedExports: {
      developmentPublicationOnly: () => undefined,
      operationalPolicy: async () => ({
        policy: { hash: "the templates' policy, which no guide answers to" },
      }),
      practicalGuideReleasePolicy: async () => {
        throw Error("Unexpected practical policy read for regulatory guidance");
      },
      guidancePolicy: async () => {
        world.policyReads++;
        return { policy: world.guidance };
      },
      currentOperationalPermission: async () => world.permissionCurrent,
      getPublicationArtifact: async () => Buffer.from(""),
      guidePageText: guideDocument.guidePageText,
      guideReferences: guideDocument.guideReferences,
    },
  });
  t.mock.module(new URL("../sources/index.ts", import.meta.url).href, {
    namedExports: {
      lockSourceState: async () => undefined,
      sourceTargetAllowed: async () => world.sourcesCurrent,
    },
  });
  t.mock.module(new URL("../workspaces/index.ts", import.meta.url).href, {
    namedExports: { authorizeWorkspaceWrite: async () => undefined },
  });
  t.mock.module(new URL("../documents/index.ts", import.meta.url).href, {
    namedExports: { createDocumentInTransaction: async () => "", getDocument: async () => ({}) },
  });

  const released = await import("./valo-released-content");
  const shown = async () => (await released.liveReleasedVersions()).map((row) => row.id);

  // Released under the approved policy, which still stands: shown, as a free guide with its own page.
  assert.deepEqual(await shown(), [guide.id]);
  const [listed] = released.projectReleasedCatalogue(await released.liveReleasedVersions());
  assert.equal(listed!.access, "free");
  assert.equal(listed!.type, "guidance");
  assert.equal(listed!.href, "/resources/check-the-name-you-trade-under");
  assert.equal(listed!.title, "Check the name you trade under");
  const [resource] = await released.releasedResources();
  assert.equal(resource!.title, "Check the name you trade under");
  assert.ok(resource!.sources.length > 0);
  // It is not among the templates, so no template path, price or purchase applies to it.
  assert.deepEqual(await released.liveOperationalVersions(), []);

  // The owner's approval does not stand (supposed for this test): not shown.
  world.guidance = unapproved;
  assert.deepEqual(await shown(), []);
  assert.deepEqual(await released.releasedResources(), []);
  // The policy file was edited and approved anew: the guide was released under the old text, so it
  // is not shown until it is released again.
  world.guidance = approvedAfterEdit;
  assert.deepEqual(await shown(), []);
  // The owner suspends publication in the restriction file: not shown while the suspension lasts,
  // and shown again once the file is as it was when the guide was released.
  world.guidance = suspended;
  assert.deepEqual(await shown(), []);
  world.guidance = approved;
  assert.deepEqual(await shown(), [guide.id]);

  // A source that is no longer current, or a provider permission that has lapsed: not shown.
  world.sourcesCurrent = false;
  assert.deepEqual(await shown(), []);
  world.sourcesCurrent = true;
  world.permissionCurrent = false;
  assert.deepEqual(await shown(), []);
  world.permissionCurrent = true;
  assert.deepEqual(await shown(), [guide.id]);

  // After its review date, or once it is withdrawn, it is not shown whatever the policy.
  t.mock.timers.setTime(+guide.reviewBy + 1);
  assert.deepEqual(await shown(), []);
  t.mock.timers.setTime(+day);
  guide.status = "withdrawn";
  assert.deepEqual(await shown(), []);
  guide.status = "published";
  assert.deepEqual(await shown(), [guide.id]);
  assert.ok(world.policyReads > 0);

  // The rule on its own.
  assert.equal(released.guidePolicyStands("a", { hash: "a", ownerApproved: true }), true);
  assert.equal(released.guidePolicyStands("a", { hash: "a", ownerApproved: false }), false);
  assert.equal(released.guidePolicyStands("a", { hash: "b", ownerApproved: true }), false);
});
