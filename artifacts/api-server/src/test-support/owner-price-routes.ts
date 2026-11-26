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
 * Slice 2: a price that carries is recorded for each next edition as a Content editor releases it,
 * with the same terms and approval reference, and the price in effect then closes; one that does not
 * carry leaves the new edition unpriced.
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
    const terms = (change: Record<string, string | boolean> = {}) => ({
      edition: edition.id,
      amount: "2500.00",
      licenceVersion: "synthetic-owner-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
      carries: false,
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
      carries: false,
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

    // Slice 2: a price carried to the template's next edition. A Content editor releases the next one.
    const pricesOf = async (wanted: string) =>
      ListOwnerPricesResponse.parse(await (await call(path, undefined, owner)).json()).items.find(
        (item) => item.edition === wanted,
      )?.prices;
    const release = async (baseVersion: number) => {
      const next = await call(
        "/admin/manual-library/" + itemId + "/drafts",
        {
          kind: "premium_template",
          title,
          body: "Public description of the synthetic owner-priced agreement.",
          industry: null,
          requestId: randomUUID(),
          baseVersion,
          fileMode: "keep",
          ...templateDetails,
        },
        editor,
      );
      assert.equal(next.status, 200);
      const revision = GetManualLibraryRevisionResponse.parse(await next.json());
      const done = await call(
        "/admin/manual-library/" + itemId + "/actions",
        libraryAction("publish", revision),
        editor,
      );
      assert.equal(done.status, 200);
      return revision.id;
    };
    // The price on sale does not carry, so the next edition has none until the owner records one.
    const v2 = await release(1);
    assert.deepEqual(await pricesOf(v2), []);
    // The owner's choice is part of the terms: the same terms that do not carry have another checksum.
    const carryTerms = terms({
      edition: v2,
      amount: "3500.00",
      licenceVersion: "synthetic-owner-3",
      carries: true,
    });
    const carryPreview = PreviewOwnerPriceResponse.parse(
      await (await call(path + "/previews", carryTerms, owner)).json(),
    );
    assert.equal(carryPreview.terms.carries, true);
    const notCarrying = PreviewOwnerPriceResponse.parse(
      await (await call(path + "/previews", { ...carryTerms, carries: false }, owner)).json(),
    );
    assert.notEqual(notCarrying.checksum, carryPreview.checksum);
    assert.equal(
      (
        await record({
          ...carryTerms,
          reference: "synthetic-owner-approval-3",
          confirm: notCarrying.checksum,
        })
      ).status,
      409,
    );
    const carryingResponse = await record({
      ...carryTerms,
      reference: "synthetic-owner-approval-3",
      confirm: carryPreview.checksum,
    });
    assert.equal(carryingResponse.status, 200);
    const carrying = RecordOwnerPriceResponse.parse(await carryingResponse.json());
    const carryBuyer = await resolveWorkspace("synthetic-owner-price-carry-buyer-" + id);
    const carryOrder = await runInWorkspaceScope(carryBuyer.workspaceId, () =>
      createOrder(carryBuyer, {
        priceId: carrying.priceId,
        acceptedLicenceVersion: "synthetic-owner-3",
        requestKey: randomUUID(),
      }),
    );
    // The next release records the price for its edition, carried from the one on sale, which closes then.
    const v3 = await release(2);
    const carried = (await pricesOf(v3)) ?? [];
    assert.deepEqual(
      carried.map((price) => [
        price.amountKobo,
        price.licenceVersion,
        price.taxTreatment,
        price.carriesToLaterEditions,
        price.carriedFrom,
      ]),
      [[350000, "synthetic-owner-3", "Synthetic tax treatment", true, carrying.priceId]],
    );
    const [carriedRow] = await db.select().from(valoPrices).where(eq(valoPrices.id, carried[0]!.priceId));
    assert.equal(carriedRow?.licenceText, licenceText);
    // The owner's approval is carried as it was written; carriedFrom names the price it came from.
    const approvedBy = `synthetic-owner-approval-3 (approved by the development owner, ${owner})`;
    assert.equal(carriedRow?.approvalReference, approvedBy);
    const [ended] = await db.select().from(valoPrices).where(eq(valoPrices.id, carrying.priceId));
    assert.equal(ended?.approvalReference, approvedBy);
    assert.equal(+ended!.effectiveTo!, +carriedRow!.effectiveFrom);
    // ADM-006: the order made at the earlier edition's price keeps its price, amount, licence and edition.
    const [keptCarry] = await db.select().from(valoOrders).where(eq(valoOrders.id, carryOrder.id));
    assert.deepEqual(
      [
        keptCarry?.priceId,
        keptCarry?.amountKobo,
        keptCarry?.line.licenceVersion,
        keptCarry?.line.contentVersionId,
      ],
      [carrying.priceId, 350000, "synthetic-owner-3", v2],
    );
    // A later release carries the copy, never the original again, and the change log keeps each one.
    const v4 = await release(3);
    const carriedAgain = (await pricesOf(v4)) ?? [];
    assert.deepEqual(
      carriedAgain.map((price) => price.carriedFrom),
      [carried[0]!.priceId],
    );
    const [againRow] = await db.select().from(valoPrices).where(eq(valoPrices.id, carriedAgain[0]!.priceId));
    assert.equal(againRow?.approvalReference, approvedBy);
    const logged = await db
      .select({ action: valoPriceChanges.action })
      .from(valoPriceChanges)
      .where(eq(valoPriceChanges.priceId, carried[0]!.priceId))
      .orderBy(asc(valoPriceChanges.changedAt), asc(valoPriceChanges.id));
    assert.deepEqual(
      logged.map((change) => change.action),
      ["created", "closed"],
    );
    // A price the owner schedules for the edition on sale carries from its own start, and the price on
    // sale until then carries with the end it already has. Neither is closed again.
    const onSale = carriedAgain[0]!;
    const startsLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const scheduledTerms = terms({
      edition: v4,
      amount: "4000.00",
      licenceVersion: "synthetic-owner-4",
      from: startsLater.toISOString(),
      carries: true,
    });
    const scheduledPreview = PreviewOwnerPriceResponse.parse(
      await (await call(path + "/previews", scheduledTerms, owner)).json(),
    );
    const scheduledResponse = await record({
      ...scheduledTerms,
      reference: "synthetic-owner-approval-4",
      confirm: scheduledPreview.checksum,
    });
    assert.equal(scheduledResponse.status, 200);
    const scheduled = RecordOwnerPriceResponse.parse(await scheduledResponse.json());
    assert.deepEqual(scheduled.closed, [{ priceId: onSale.priceId, amountKobo: 350000 }]);
    const v5 = await release(4);
    const fifth = (await pricesOf(v5)) ?? [];
    assert.deepEqual(
      fifth.map((price) => [price.amountKobo, price.carriedFrom, price.effectiveTo && +price.effectiveTo]),
      [
        [350000, onSale.priceId, +startsLater],
        [400000, scheduled.priceId, null],
      ],
    );
    assert.equal(+fifth[1]!.effectiveFrom, +startsLater);
    const [stillEnding] = await db.select().from(valoPrices).where(eq(valoPrices.id, onSale.priceId));
    assert.equal(+stillEnding!.effectiveTo!, +startsLater);
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
