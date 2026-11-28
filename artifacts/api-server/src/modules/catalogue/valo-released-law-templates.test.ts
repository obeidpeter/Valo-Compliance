import test from "node:test";
import assert from "node:assert/strict";

/**
 * When a published template that states the law is shown on the site (docs/architecture/reviewed-route.md,
 * part 4).
 *
 * Such a template answers to the policy for templates that state the law, as a guide answers to the
 * guidance policy: it is shown only while the policy it was released under is that policy as it stands
 * and approved, and while the provider's permission for its wording is current.
 *
 * Nothing here is published and no database is used. The "published" template is an object in memory:
 * TPL-31's bundle built from stand-in passages, under a synthetic amendment record and a test's supposed
 * approval of the policy, with two made-up reviews, which the real gate calls eligible. The owner has
 * approved no text of the policy. The database, the source check and the provider-permission check are
 * stand-ins; the rule itself and the gate are real.
 */
test("a published template that states the law is shown only while its own policy stands and its permission is current", async (t) => {
  const day = new Date("2026-11-27T10:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: +day });

  const { evaluatePublication, sha256 } = await import("@workspace/valo-core");
  const policyModule = await import("../publication/template-law-policy");
  const fixtures = await import("../publication/template-law-release.fixtures");
  const { withMadeUpReviews } = await import("../publication/guidance-release.fixtures");
  const guideDocument = await import("../publication/guidance-document");

  const policyFile = fixtures.templateLawPolicyFile();
  // The policy under a supposed approval of this very file, and as it stands: no text approved.
  const approved = await fixtures.supposedlyApprovedTemplateLawPolicy();
  const asItStands = (await policyModule.templateLawPolicy()).policy;
  assert.equal(policyModule.templateLawPolicyApprovedHash(), null);
  // And the policy after an edit that the owner, supposedly, approved anew.
  const edited = `${policyFile}\nA line added after the template was published.\n`;
  const approvedAfterEdit = (
    await policyModule.templateLawPolicy({
      approvedHash: sha256(edited),
      read: async (path) =>
        path === policyModule.TEMPLATE_LAW_POLICY_PATH
          ? edited
          : Promise.reject(Object.assign(Error("no file"), { code: "ENOENT" })),
    })
  ).policy;
  assert.equal(approved.ownerApproved, true);
  assert.equal(asItStands.ownerApproved, false);
  assert.equal(approvedAfterEdit.ownerApproved, true);
  assert.equal(new Set([approved.hash, asItStands.hash, approvedAfterEdit.hash]).size, 3);

  const read = new Date(+day - 3_600_000).toISOString();
  const assembled = await fixtures.assembledLawTemplate({
    now: day,
    policy: approved,
    records: fixtures.syntheticLawTemplateRecords(read),
  });
  const bundle = withMadeUpReviews(assembled.bundle);
  assert.deepEqual(evaluatePublication(bundle, day), { decision: "eligible", reasons: [] });
  assert.equal(policyModule.releasePolicyKind(bundle.candidate), "template_law");
  const template = {
    id: "00000000-0000-4000-8000-00000000c031",
    templateId: "TPL-31",
    version: 1,
    slug: "tpl-31",
    policyId: approved.version,
    candidateHash: bundle.candidate.hash,
    bundle,
    attestations: {},
    status: "published",
    reviewBy: new Date(bundle.candidate.reviewBy!),
  };

  // What the stand-ins answer; each case below changes one of them.
  const world = { templateLaw: approved, sourcesCurrent: true, permissionCurrent: true, policyReads: 0 };
  const tables = {
    valoContentVersions: {
      id: "content.id",
      policyId: "content.policy",
      status: "content.status",
      templateId: "content.template",
      version: "content.version",
    },
    valoPublicationPolicies: { id: "policy.id", hash: "policy.hash" },
  };
  const { isManualTemplate } = await import("../manual-library");
  t.mock.module(new URL("../manual-library/index.ts", import.meta.url).href, {
    namedExports: {
      isManualTemplate,
      releasedManualEntries: async () => [],
      freeLibraryEdition: async () => null,
    },
  });
  t.mock.module("@workspace/db", {
    namedExports: {
      ...tables,
      db: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: async () => [
                { content: template, policy: { id: approved.version, hash: approved.hash } },
              ],
            }),
            // Every version ever released, by its number: this template's alone, so none replaces it.
            where: async () => [
              { templateId: template.templateId, version: template.version, status: template.status },
            ],
          }),
        }),
      },
    },
  });
  t.mock.module(new URL("../publication/index.ts", import.meta.url).href, {
    namedExports: {
      developmentPublicationOnly: () => undefined,
      operationalPolicy: async () => ({
        policy: { hash: "the templates' policy, which no template that states the law answers to" },
      }),
      practicalGuideReleasePolicy: async () => {
        throw Error("Unexpected practical policy read for a template that states the law");
      },
      guidancePolicy: async () => {
        throw Error("Unexpected guidance policy read for a template that states the law");
      },
      releasePolicyKind: policyModule.releasePolicyKind,
      templateLawPolicy: async () => {
        world.policyReads++;
        return { policy: world.templateLaw };
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

  // Released under the supposedly approved policy, which still stands: shown.
  assert.deepEqual(await shown(), [template.id]);
  // The policy as it stands, with no text approved: not shown.
  world.templateLaw = asItStands;
  assert.deepEqual(await shown(), []);
  // The policy file edited and approved anew: released under the old text, so not shown until it is
  // released again.
  world.templateLaw = approvedAfterEdit;
  assert.deepEqual(await shown(), []);
  world.templateLaw = approved;
  assert.deepEqual(await shown(), [template.id]);

  // A source that is no longer current, or a provider permission that has lapsed: not shown.
  world.sourcesCurrent = false;
  assert.deepEqual(await shown(), []);
  world.sourcesCurrent = true;
  world.permissionCurrent = false;
  assert.deepEqual(await shown(), []);
  world.permissionCurrent = true;
  assert.deepEqual(await shown(), [template.id]);

  // After its review date, or once it is withdrawn, it is not shown whatever the policy.
  t.mock.timers.setTime(+template.reviewBy + 1);
  assert.deepEqual(await shown(), []);
  t.mock.timers.setTime(+day);
  template.status = "withdrawn";
  assert.deepEqual(await shown(), []);
  template.status = "published";
  assert.deepEqual(await shown(), [template.id]);
  assert.ok(world.policyReads > 0);
});
