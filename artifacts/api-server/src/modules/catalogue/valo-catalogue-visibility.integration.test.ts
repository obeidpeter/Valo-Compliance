import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db, valoContentVersions, valoPublicationPolicies } from "@workspace/db";
import { liveReleasedVersions, releasedCatalogue } from "./valo-released-content";
import { createDocument } from "../documents";
import { resolveWorkspace } from "../workspaces";
import { syntheticDocument } from "../../lib/valo-test-fixtures";
import { draftSynthetic } from "../../test-support/drafted-content";

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
