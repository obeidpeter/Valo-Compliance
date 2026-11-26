import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  GetManualLibraryRevisionResponse,
  ListOwnerPricesResponse,
  PreviewOwnerPriceResponse,
  RecordOwnerPriceResponse,
} from "@workspace/api-zod";
import { sha256 } from "@workspace/valo-core";
import { wordFromText } from "../modules/manual-library/files";
import { libraryAction, templateDetails } from "./template-details";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/**
 * The owner's price screen (docs/architecture/commercial-settings.md, slice 1; ADM-006) over HTTP:
 * only the recently verified development owner, from Valo's own pages, previews and records a
 * published premium template's price; recording needs the preview's checksum of exactly those terms;
 * and an order made at the earlier price keeps its amount and terms after the owner's next price.
 */
export async function exerciseOwnerPriceRoutes(call: Call, editor: string) {
  const {
    db,
    runInWorkspaceScope,
    valoOrders,
    valoPriceChanges,
    valoPrices,
    valoStaffAssignments: roles,
    valoStaffRoleChanges: audit,
  } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createOrder } = await import("../modules/commerce");
  const id = randomUUID(),
    owner = "synthetic-price-route-owner-" + id,
    system = "synthetic-price-route-system-" + id,
    assignment = randomUUID();
  await db.insert(roles).values(
    [
      { id: assignment, identityId: owner },
      { id: randomUUID(), identityId: system },
    ].map((row) => ({
      ...row,
      role: "system" as const,
      grantedBy: "synthetic operator",
      reason: "Synthetic price route test",
    })),
  );
  // The development owner is the identity the operator bootstrap granted (decision 0018).
  await db.insert(audit).values({
    id: randomUUID(),
    requestKey: randomUUID(),
    inputHash: sha256("synthetic"),
    actorId: "operator-bootstrap:synthetic",
    actorAssignmentId: assignment,
    assignmentId: assignment,
    targetIdentityId: owner,
    action: "grant",
    role: "system",
    reason: "Synthetic price owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    const itemId = randomUUID(),
      title = "Synthetic owner-priced agreement",
      licenceText = "Synthetic licence for one business's own use only.";
    const { bytes } = wordFromText("Synthetic owner-priced edition", "Only a buyer may read this sentence.");
    const saved = await call(
      "/admin/manual-library/" + itemId + "/drafts",
      {
        kind: "premium_template",
        title,
        body: "Public description of the synthetic owner-priced agreement.",
        industry: null,
        requestId: randomUUID(),
        baseVersion: 0,
        fileMode: "upload",
        upload: { format: "docx", base64: bytes.toString("base64") },
        ...templateDetails,
      },
      editor,
    );
    assert.equal(saved.status, 200);
    const edition = GetManualLibraryRevisionResponse.parse(await saved.json());
    const published = await call(
      "/admin/manual-library/" + itemId + "/actions",
      libraryAction("publish", edition),
      editor,
    );
    assert.equal(published.status, 200);

    const path = "/admin/owner-prices";
    const terms = (change: Record<string, string> = {}) => ({
      edition: edition.id,
      amount: "2500.00",
      licenceVersion: "synthetic-owner-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
      ...change,
    });
    const record = (body: object, who = owner) => call(path, body, who);
    const priced = async () =>
      ListOwnerPricesResponse.parse(await (await call(path, undefined, owner)).json()).items.find(
        (item) => item.edition === edition.id,
      );

    // Only the recently verified development owner reads, previews or records a price.
    for (const [who, headers] of [
      [editor, {}],
      [system, {}],
      [owner, { "x-test-mfa": "stale" }],
    ] as const) {
      assert.equal((await call(path, undefined, who, headers)).status, 403);
      assert.equal((await call(path + "/previews", terms(), who, headers)).status, 403);
    }
    const listed = await call(path, undefined, owner);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "private, no-store");
    assert.equal((await priced())?.title, title);
    assert.deepEqual((await priced())?.prices, []);

    // From another site a write is refused, and a malformed term is refused before anything is read.
    const hostile = await call(path + "/previews", terms(), owner, { origin: "https://hostile.invalid" });
    assert.equal(hostile.status, 403);
    assert.equal((await call(path + "/previews", terms({ amount: "2,500" }), owner)).status, 422);

    // A preview gives the exact terms and their checksum, and writes nothing.
    const previewed = await call(path + "/previews", terms(), owner);
    assert.equal(previewed.status, 200);
    const preview = PreviewOwnerPriceResponse.parse(await previewed.json());
    assert.equal(preview.title, title);
    assert.deepEqual(preview.terms, {
      edition: edition.id,
      amountKobo: 250000,
      licenceVersion: "synthetic-owner-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
    });
    assert.deepEqual(
      await db.select().from(valoPrices).where(eq(valoPrices.contentVersionId, edition.id)),
      [],
    );

    // Recording needs the checksum of exactly these terms, from the owner.
    const approval = { reference: "synthetic-owner-approval-1", confirm: preview.checksum };
    assert.equal((await record({ ...terms({ amount: "2500.01" }), ...approval })).status, 409);
    assert.equal((await record({ ...terms(), ...approval }, system)).status, 403);
    assert.deepEqual(
      await db.select().from(valoPrices).where(eq(valoPrices.contentVersionId, edition.id)),
      [],
    );
    const recorded = await record({ ...terms(), ...approval });
    assert.equal(recorded.status, 200);
    const first = RecordOwnerPriceResponse.parse(await recorded.json());
    assert.deepEqual(first.closed, []);
    const [row] = await db.select().from(valoPrices).where(eq(valoPrices.id, first.priceId));
    // The owner's own sign-in is the approval's author, not a typed name.
    assert.equal(
      row?.approvalReference,
      `synthetic-owner-approval-1 (approved by the development owner, ${owner})`,
    );
    assert.deepEqual(
      (await priced())?.prices.map((price) => price.priceId),
      [first.priceId],
    );

    // ADM-006: an order made at this price keeps its amount and terms after the owner's next price.
    const buyer = await resolveWorkspace("synthetic-owner-price-buyer-" + id);
    const order = await runInWorkspaceScope(buyer.workspaceId, () =>
      createOrder(buyer, {
        priceId: first.priceId,
        acceptedLicenceVersion: "synthetic-owner-1",
        requestKey: randomUUID(),
      }),
    );
    const nextTerms = terms({ amount: "3000.00", licenceVersion: "synthetic-owner-2" });
    const next = PreviewOwnerPriceResponse.parse(
      await (await call(path + "/previews", nextTerms, owner)).json(),
    );
    const secondResponse = await record({
      ...nextTerms,
      reference: "synthetic-owner-approval-2",
      confirm: next.checksum,
    });
    assert.equal(secondResponse.status, 200);
    const second = RecordOwnerPriceResponse.parse(await secondResponse.json());
    assert.deepEqual(second.closed, [{ priceId: first.priceId, amountKobo: 250000 }]);
    const [kept] = await db.select().from(valoOrders).where(eq(valoOrders.id, order.id));
    assert.equal(kept?.priceId, first.priceId);
    assert.equal(kept?.amountKobo, 250000);
    assert.deepEqual(kept?.line, {
      title,
      contentVersionId: edition.id,
      licenceVersion: "synthetic-owner-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
    });
    // The earlier price keeps its terms and closes when the next one starts, once; the log keeps both.
    const [closed] = await db.select().from(valoPrices).where(eq(valoPrices.id, first.priceId));
    assert.equal(closed?.amountKobo, 250000);
    assert.equal(closed?.licenceVersion, "synthetic-owner-1");
    assert.equal(+closed!.effectiveTo!, +second.from);
    const changes = await db
      .select({ action: valoPriceChanges.action })
      .from(valoPriceChanges)
      .where(eq(valoPriceChanges.priceId, first.priceId))
      .orderBy(asc(valoPriceChanges.changedAt), asc(valoPriceChanges.id));
    assert.deepEqual(
      changes.map((change) => change.action),
      ["created", "closed"],
    );
    assert.deepEqual(
      (await priced())?.prices.map((price) => price.priceId),
      [second.priceId],
    );
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
