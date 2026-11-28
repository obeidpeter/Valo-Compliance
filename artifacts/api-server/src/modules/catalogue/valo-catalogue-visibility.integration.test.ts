import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import {
  db,
  valoContentVersions,
  valoManualRegulatoryChecks,
  valoPublicationPolicies,
  valoStaffAssignments,
  valoStaffRoleChanges,
} from "@workspace/db";
import { liveReleasedVersions, releasedCatalogue } from "./valo-released-content";
import type { CatalogueQuery } from "./valo-catalogue";
import { createDocument } from "../documents";
import { actOnManualRevision, holdManualEntry, saveManualDraft } from "../manual-library";
import { decideOwnerGuidance } from "../manual-guidance";
import { resolveWorkspace } from "../workspaces";
import { syntheticDocument } from "../../lib/valo-test-fixtures";
import { draftSynthetic } from "../../test-support/drafted-content";
import { templateDetails, withdrawalReason } from "../../test-support/template-details";

// WEB-003: public search, accepted when "unpublished content and customer drafts never appear".
// The versions here are candidates and held items, never published rows: nothing in a test may
// forge a release. A withdrawn version needs a published one first, so it is not made here.
test(
  "public search finds service pages but never unpublished versions or customer drafts",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 30000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const marker = `zebra${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const policy = { scope: "Synthetic search-visibility fixture", publicationAllowed: false };
    const policyId = `synthetic-search-${marker}`;
    await db.insert(valoPublicationPolicies).values({
      id: policyId,
      hash: hash(policy),
      policy,
      authority: { syntheticOnly: true, ownerApprovalClaimed: false },
    });
    const versions: string[] = [];
    for (const status of ["candidate", "held"] as const) {
      const bundle = { fixture: true, title: `Synthetic ${marker} ${status} template`, published: false };
      const [row] = await draftSynthetic((tx) =>
        tx
          .insert(valoContentVersions)
          .values({
            id: randomUUID(),
            templateId: `SYNTHETIC-SEARCH-${marker}-${status}`,
            version: 1,
            slug: `synthetic-${marker}-${status}`,
            policyId,
            candidateHash: hash(bundle),
            bundle,
            attestations: { checks: [] },
            reviewBy: new Date(Date.now() + 86_400_000),
          })
          .returning(),
      );
      if (status === "held")
        await db
          .update(valoContentVersions)
          .set({ status: "held", withdrawnReason: "Synthetic search fixture; no release evidence." })
          .where(eq(valoContentVersions.id, row!.id));
      versions.push(row!.id);
    }
    // A customer's own draft carries the same word.
    const actor = await resolveWorkspace(`synthetic-search-${randomUUID()}`);
    await createDocument(actor, { ...syntheticDocument, title: `Synthetic ${marker} customer draft` });

    assert.deepEqual(
      (await liveReleasedVersions()).filter((version) => versions.includes(version.id)),
      [],
    );
    const found = await releasedCatalogue({ q: marker });
    assert.deepEqual({ items: found.items, total: found.total }, { items: [], total: 0 });
    for (const type of ["template", "guidance", "article", "industry", "service"])
      assert.equal((await releasedCatalogue({ q: marker, type })).total, 0, type);

    // The same search finds the public service pages, so an empty result is not a broken search.
    const services = await releasedCatalogue({ q: "registration" });
    assert.ok(
      services.items.some((item) => item.id === "service:registration" && item.type === "service"),
      JSON.stringify(services.items.map((item) => item.id)),
    );
  },
);

// WEB-003, the staff library's part (docs/architecture/public-search.md). Each entry is drafted and
// released by the library's own functions, as a Content editor and the development owner use them:
// nothing is written as published by hand. Every entry is synthetic, carries a word of its own that
// nothing else has, and is withdrawn at the end.
test(
  "public search lists what the staff library has released under its type and its industry, in a visitor's words, and never a draft, an unsigned guide, a held, withdrawn or replaced version or a customer's document",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const marker = `quokka${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      first = `bilby${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      later = `numbat${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const editor = {
        identityId: `synthetic-search-editor-${marker}`,
        recentMfa: true,
        verifiedAt: Date.now(),
      },
      owner = { identityId: `synthetic-search-owner-${marker}`, recentMfa: true, verifiedAt: Date.now() };
    const ownerAssignment = randomUUID();
    await db.insert(valoStaffAssignments).values([
      {
        id: randomUUID(),
        identityId: editor.identityId,
        role: "content",
        grantedBy: "synthetic operator",
        reason: "Synthetic editor for the public search test",
      },
      {
        id: ownerAssignment,
        identityId: owner.identityId,
        role: "system",
        grantedBy: "synthetic operator",
        reason: "Synthetic owner for the public search test",
      },
    ]);
    await db.insert(valoStaffRoleChanges).values({
      id: randomUUID(),
      requestKey: randomUUID(),
      inputHash: sha256("synthetic"),
      actorId: "operator-bootstrap:synthetic",
      actorAssignmentId: ownerAssignment,
      assignmentId: ownerAssignment,
      targetIdentityId: owner.identityId,
      action: "grant",
      role: "system",
      reason: "Synthetic owner for the public search test",
      after: { active: true },
      targetVerifiedAt: new Date(),
    });
    const draft = (itemId: string, entry: Record<string, unknown>, baseVersion = 0) =>
      saveManualDraft(editor, itemId, {
        industry: null,
        body: "Synthetic text for the public search test.",
        fileMode: "text",
        baseVersion,
        requestId: randomUUID(),
        ...entry,
      });
    const exact = (revision: { version: number; digest: string }) => ({
      version: revision.version,
      digest: revision.digest,
    });
    const release = (itemId: string, revision: { version: number; digest: string }) =>
      actOnManualRevision(editor, itemId, { action: "publish", ...exact(revision) });
    // What a search lists. An item is marked "~" when it is only among the closest: no item has every
    // word of the search, and it has the most of them.
    const ids = async (query: CatalogueQuery) => {
      const found = await releasedCatalogue(query);
      assert.equal(found.total, found.items.length);
      return found.items.map((item) => `${found.closest ? "~" : ""}${item.type}:${item.id}`).sort();
    };
    const template = randomUUID(),
      guide = randomUUID(),
      unreleased = randomUUID(),
      article = randomUUID(),
      unsigned = randomUUID();
    const released: (() => Promise<unknown>)[] = [];
    try {
      // A template for every industry, a practical guide filed under one industry, and a draft guide
      // that is never released.
      const form = await draft(template, {
        kind: "template",
        title: `Synthetic ${marker} stock sheet`,
        ...templateDetails,
      });
      await release(template, form);
      released.push(() =>
        actOnManualRevision(editor, template, {
          action: "withdraw",
          ...exact(form),
          reason: withdrawalReason,
        }),
      );
      const checklist = await draft(guide, {
        kind: "practical_guide",
        title: `Synthetic ${marker} ${first} opening checklist`,
        industry: "restaurants-hospitality",
      });
      await release(guide, checklist);
      released.push(() =>
        actOnManualRevision(editor, guide, {
          action: "withdraw",
          ...exact(checklist),
          reason: withdrawalReason,
        }),
      );
      await draft(unreleased, { kind: "practical_guide", title: `Synthetic ${marker} unreleased guide` });
      // A regulatory article is released only on the owner's sign-off of a current check of its exact
      // text. A second one has its check and is left unsigned.
      const record = { appliesTo: "Synthetic businesses in the public search test." };
      const body = `An exact synthetic regulatory article. ${marker}`;
      const signedDraft = await draft(article, {
        kind: "regulatory_article",
        title: `Synthetic ${marker} filing rule`,
        body,
        ...record,
      });
      await draft(unsigned, {
        kind: "regulatory_article",
        title: `Synthetic ${marker} unsigned rule`,
        body,
        ...record,
      });
      const source = {
        title: "Synthetic official instrument",
        url: "https://example.invalid/instrument",
        locator: "Section 1",
        rawSha256: sha256("synthetic file"),
        retrievedAt: new Date().toISOString(),
        retrieval: "official_url" as const,
        validThrough: new Date(Date.now() + 86_400_000).toISOString(),
      };
      const [check] = await db
        .insert(valoManualRegulatoryChecks)
        .values({
          candidateId: "GUD-22",
          title: signedDraft.title,
          bodySha256: sha256(body),
          evidenceSha256: sha256(JSON.stringify([body, [], source])),
          checkedAt: new Date(),
          sources: [source],
          holds: [],
        })
        .returning({ id: valoManualRegulatoryChecks.id });
      const sign = (action: "publish" | "withdraw") =>
        decideOwnerGuidance(owner, article, {
          action,
          ...exact(signedDraft),
          checkId: action === "publish" ? check!.id : null,
          confirmed: true,
        });
      assert.deepEqual(await ids({ q: marker, type: "guidance" }), [], "not found before the owner signs it");
      await sign("publish");
      released.push(() => sign("withdraw"));
      // A customer's own document carries the same word.
      const customer = await resolveWorkspace(`synthetic-search-${randomUUID()}`);
      await createDocument(customer, {
        ...syntheticDocument,
        title: `Synthetic ${marker} customer document`,
      });

      // The three released entries, each under its own type and no other.
      const all = [`article:${checklist.id}`, `guidance:${signedDraft.id}`, `template:${form.id}`];
      assert.deepEqual(await ids({ q: marker }), all);
      assert.deepEqual(await ids({ q: marker, type: "all" }), all);
      assert.deepEqual(await ids({ q: marker, type: "template" }), [`template:${form.id}`]);
      assert.deepEqual(await ids({ q: marker, type: "article" }), [`article:${checklist.id}`]);
      assert.deepEqual(await ids({ q: marker, type: "guidance" }), [`guidance:${signedDraft.id}`]);
      for (const type of ["industry", "service"]) assert.deepEqual(await ids({ q: marker, type }), [], type);
      // The guide is filed under one industry; the other two are for every industry.
      assert.deepEqual(await ids({ q: marker, industry: "restaurants-hospitality" }), all);
      assert.deepEqual(await ids({ q: marker, industry: "agriculture" }), [
        `guidance:${signedDraft.id}`,
        `template:${form.id}`,
      ]);
      assert.deepEqual(await ids({ q: marker, industry: "restaurants-hospitality", type: "article" }), [
        `article:${checklist.id}`,
      ]);
      assert.deepEqual(await ids({ q: marker, industry: "agriculture", type: "article" }), []);
      // A visitor's own words: a plural, an everyday word for the industry, another word for the same thing.
      assert.deepEqual(await ids({ q: `${marker} checklists for hotels` }), [`article:${checklist.id}`]);
      assert.deepEqual(await ids({ q: `${marker} inventory sheets` }), [`template:${form.id}`]);
      assert.deepEqual(await ids({ q: `${marker} guide` }), [
        `article:${checklist.id}`,
        `guidance:${signedDraft.id}`,
      ]);
      // The search also finds an industry's page and a service category, which are never released entries.
      assert.ok(
        (await ids({ q: "hotel", type: "industry" })).includes("industry:industry:restaurants-hospitality"),
      );
      assert.ok((await ids({ q: "lawyer", type: "service" })).includes("service:service:legal"));

      // A later draft of the released guide: its new word finds nothing, and the released title is still found.
      const reworded = await draft(
        guide,
        {
          kind: "practical_guide",
          title: `Synthetic ${marker} ${later} closing checklist`,
          industry: "restaurants-hospitality",
        },
        checklist.version,
      );
      assert.deepEqual(await ids({ q: later }), []);
      assert.deepEqual(await ids({ q: `${marker} opening` }), [`article:${checklist.id}`]);
      // Held, the released guide leaves the search; with the hold lifted it is back.
      const why = "Synthetic: held while the public search test looks for it.";
      await holdManualEntry(editor, guide, { action: "hold", ...exact(checklist), reason: why });
      assert.deepEqual(await ids({ q: marker, type: "article" }), []);
      await holdManualEntry(editor, guide, { action: "lift", ...exact(checklist), reason: why });
      assert.deepEqual(await ids({ q: marker, type: "article" }), [`article:${checklist.id}`]);
      // The later draft is released: its words are found now, and the version it replaced is not.
      await actOnManualRevision(editor, guide, {
        action: "publish",
        ...exact(reworded),
        change: "Synthetic: the checklist is now for closing, not opening.",
      });
      released[1] = () =>
        actOnManualRevision(editor, guide, {
          action: "withdraw",
          ...exact(reworded),
          reason: withdrawalReason,
        });
      assert.deepEqual(await ids({ q: later }), [`article:${reworded.id}`]);
      assert.deepEqual(await ids({ q: first }), []);
      // Where no released entry has every word, the closest are released entries too: the draft that was
      // never released has both of these words, and the three that are listed have one.
      assert.deepEqual(await ids({ q: `${marker} unreleased` }), [
        `~article:${reworded.id}`,
        `~guidance:${signedDraft.id}`,
        `~template:${form.id}`,
      ]);
      // Withdrawn, the template and the signed article leave the search.
      await released[0]!();
      await released[2]!();
      assert.deepEqual(await ids({ q: marker }), [`article:${reworded.id}`]);
      await released[1]!();
      released.length = 0;
      assert.deepEqual(await ids({ q: marker }), []);
    } finally {
      // Whatever was still released when a check failed is withdrawn, so that no later test finds it.
      for (const withdraw of [...released].reverse())
        await withdraw().catch(() => {
          // Already withdrawn by the test itself, or never released.
        });
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(inArray(valoStaffAssignments.identityId, [editor.identityId, owner.identityId]));
    }
  },
);
