import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { GetManualLibraryRevisionResponse, GetReleasedTemplateResponse } from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

/**
 * The price command (step 5 of the content and speed plan) against a premium template an editor
 * published through the staff library, with synthetic terms and a synthetic approval.
 */
export async function exercisePremiumPriceCommand(call: Call, editor: string) {
  const { db, valoPriceChanges, valoPrices } = await import("@workspace/db");
  const { premiumPriceStatus, premiumPriceTerms, premiumPriceTermsId, recordPremiumPrice } =
    await import("../modules/commerce");
  const itemId = randomUUID();
  const path = "/admin/manual-library/" + itemId;
  const { bytes } = wordFromText("Synthetic priced edition", "Only a buyer may read this sentence.");
  const title = "Synthetic priced agreement";
  const licenceText = "Synthetic licence for one business's own use only.";
  const saved = await call(
    path + "/drafts",
    {
      kind: "premium_template",
      title,
      body: "Public description of the synthetic priced agreement.",
      industry: null,
      requestId: randomUUID(),
      baseVersion: 0,
      fileMode: "upload",
      upload: { format: "docx", base64: bytes.toString("base64") },
    },
    editor,
  );
  assert.equal(saved.status, 200);
  const edition = GetManualLibraryRevisionResponse.parse(await saved.json());
  const terms = (change: Record<string, string> = {}) =>
    premiumPriceTerms({
      edition: edition.id,
      amount: "2500.00",
      licenceVersion: "synthetic-premium-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
      ...change,
    });
  const approval = (value: ReturnType<typeof terms>) => ({
    approvedBy: "Synthetic owner",
    reference: "synthetic-price-approval-1",
    confirm: premiumPriceTermsId(value),
  });
  const record = (value: ReturnType<typeof terms>) => recordPremiumPrice(value, approval(value));
  const offer = async () =>
    GetReleasedTemplateResponse.parse(await (await call("/public/templates/manual-" + itemId)).json()).offer;

  // A draft is not on sale, and neither is an edition the library does not hold.
  await assert.rejects(record(terms()), /Only a published premium template/);
  await assert.rejects(record(terms({ edition: randomUUID() })), /Only a published premium template/);
  const act = (action: "publish" | "withdraw") =>
    call(path + "/actions", { action, version: edition.version, digest: edition.digest }, editor);
  assert.equal((await act("publish")).status, 200);
  const listed = (await premiumPriceStatus()).find((entry) => entry.edition === edition.id);
  assert.equal(listed?.title, title);
  assert.deepEqual(listed?.prices, []);

  // The confirmation is the checksum of exactly these terms, and a price starts now or later.
  await assert.rejects(
    recordPremiumPrice(terms(), {
      ...approval(terms()),
      confirm: premiumPriceTermsId(terms({ amount: "2500.01" })),
    }),
    /checksum/,
  );
  await assert.rejects(record(terms({ from: "2026-01-01T00:00:00+01:00" })), /in the past/);
  assert.deepEqual(await offer(), undefined);

  const first = await record(terms());
  assert.deepEqual(first.closed, []);
  assert.deepEqual(await offer(), {
    id: first.priceId,
    title,
    amountKobo: 250000,
    currency: "NGN",
    licenceVersion: "synthetic-premium-1",
    licenceText,
    taxTreatment: "Synthetic tax treatment",
  });
  const [row] = await db.select().from(valoPrices).where(eq(valoPrices.id, first.priceId));
  assert.equal(row?.approvalReference, "synthetic-price-approval-1 (approved by Synthetic owner)");

  // A new price from now closes the open one at that moment, once, and the change log keeps both.
  const second = await record(terms({ amount: "3000.00", licenceVersion: "synthetic-premium-2" }));
  assert.deepEqual(second.closed, [{ priceId: first.priceId, amountKobo: 250000 }]);
  const [closed] = await db.select().from(valoPrices).where(eq(valoPrices.id, first.priceId));
  assert.equal(+closed!.effectiveTo!, +second.from);
  assert.equal((await offer())?.id, second.priceId);
  const changes = await db
    .select({ action: valoPriceChanges.action })
    .from(valoPriceChanges)
    .where(eq(valoPriceChanges.priceId, first.priceId))
    .orderBy(asc(valoPriceChanges.changedAt), asc(valoPriceChanges.id));
  assert.deepEqual(
    changes.map((change) => change.action),
    ["created", "closed"],
  );

  // A price set to start later leaves the current one on sale until then, and nothing starts before it.
  const later = await record(
    terms({ amount: "3500.00", from: new Date(Date.now() + 86_400_000).toISOString() }),
  );
  assert.deepEqual(later.closed, [{ priceId: second.priceId, amountKobo: 300000 }]);
  assert.equal((await offer())?.id, second.priceId);
  await assert.rejects(record(terms({ amount: "4000.00" })), /already starts at/);
  const status = (await premiumPriceStatus()).find((entry) => entry.edition === edition.id);
  assert.deepEqual(
    status?.prices.map((price) => price.priceId),
    [second.priceId, later.priceId],
  );

  // A withdrawn edition is not priced.
  assert.equal((await act("withdraw")).status, 200);
  await assert.rejects(
    record(terms({ amount: "4500.00", from: new Date(Date.now() + 2 * 86_400_000).toISOString() })),
    /Only a published premium template/,
  );
}
