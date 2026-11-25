import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { GetManualLibraryRevisionResponse } from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { libraryAction, templateDetails } from "./template-details";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;
type Kind = "template" | "premium_template" | "practical_guide";

/**
 * Holding, withdrawing and reporting staff-library entries, slice 1 (ADM-007): before a template's
 * published edition is withdrawn, its entry shows whom the withdrawal will tell, which are the workspaces
 * that bought the template and those that made documents from the edition. The withdrawal's notices then
 * reach exactly those workspaces, and the withdrawn edition says how many were told. A guide has no buyers
 * or documents, and shows no counts.
 */
export async function exerciseWithdrawalReach(call: Call, editor: string) {
  const { db, valoOrders, valoPrices, runInWorkspaceScope } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createReleasedTemplateDraft } = await import("../modules/catalogue");
  const { settleVerifiedOrder } = await import("../modules/commerce");
  const path = (itemId: string) => "/admin/manual-library/" + itemId;
  const revision = async (response: Response) => {
    const body: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return GetManualLibraryRevisionResponse.parse(body);
  };
  const open = async (itemId: string) => revision(await call(path(itemId), undefined, editor));
  const act = async (itemId: string, action: string, edition: Parameters<typeof libraryAction>[1]) =>
    revision(await call(path(itemId) + "/actions", libraryAction(action, edition), editor));
  const save = async (itemId: string, kind: Kind, title: string, baseVersion = 0) => {
    const file =
      kind === "premium_template" && baseVersion === 0
        ? {
            fileMode: "upload",
            upload: {
              format: "docx",
              base64: wordFromText(title, "Only its buyers may read this sentence.").bytes.toString("base64"),
            },
          }
        : { fileMode: baseVersion === 0 ? "text" : "keep" };
    return revision(
      await call(
        path(itemId) + "/drafts",
        {
          kind,
          title,
          industry: null,
          body: "Synthetic text of " + title + ", version " + (baseVersion + 1) + ".",
          requestId: randomUUID(),
          baseVersion,
          ...file,
          ...(kind === "practical_guide" ? {} : templateDetails),
        },
        editor,
      ),
    );
  };
  const notified = async (edition: string) =>
    (
      await db.execute<{ workspace_id: string; held: boolean; documents: number }>(
        sql`select workspace_id, held, documents from valo_edition_notices
             where route = 'library' and edition = ${edition} and kind = 'withdrawn' order by workspace_id`,
      )
    ).rows;
  const byWorkspace = <T extends { workspace_id: string }>(rows: T[]) =>
    rows.sort((a, b) => (a.workspace_id < b.workspace_id ? -1 : 1));
  const none = { workspaces: 0, bought: 0, documentWorkspaces: 0, documents: 0 };

  // A free template: no counts before it is published, and none to count once it is.
  const freeItem = randomUUID();
  const freeDraft = await save(freeItem, "template", "Synthetic reached register");
  assert.equal(freeDraft.reach, null);
  const free = await act(freeItem, "publish", freeDraft);
  assert.deepEqual(free.reach, { version: 1, ...none });
  assert.equal(free.told, null);
  // Two workspaces make documents from it, one of them twice: each is counted once, with its documents.
  const copier = await resolveWorkspace("synthetic-reach-copier-" + freeItem),
    other = await resolveWorkspace("synthetic-reach-other-" + freeItem);
  for (const holder of [copier, copier, other])
    await runInWorkspaceScope(holder.workspaceId, () => createReleasedTemplateDraft(holder, free.id));
  const reached = (await open(freeItem)).reach;
  assert.deepEqual(reached, { version: 1, workspaces: 2, bought: 0, documentWorkspaces: 2, documents: 3 });
  // The withdrawal tells exactly those workspaces, and the withdrawn edition says how many it told.
  const freeWithdrawn = await act(freeItem, "withdraw", free);
  assert.equal(freeWithdrawn.state, "withdrawn");
  assert.equal(freeWithdrawn.reach, null);
  assert.equal(freeWithdrawn.told, reached?.workspaces);
  assert.deepEqual(
    await notified(free.id),
    byWorkspace([
      { workspace_id: copier.workspaceId, held: false, documents: 2 },
      { workspace_id: other.workspaceId, held: false, documents: 1 },
    ]),
  );
  assert.equal((await open(freeItem)).told, 2);

  // A premium template one workspace bought, under a verified order.
  const premiumItem = randomUUID();
  const premium = await act(
    premiumItem,
    "publish",
    await save(premiumItem, "premium_template", "Synthetic reached agreement"),
  );
  assert.deepEqual(premium.reach, { version: 1, ...none });
  const price = {
    id: randomUUID(),
    contentVersionId: premium.id,
    title: "Synthetic reached fixture",
    amountKobo: 10000,
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
    approvalReference: "LOCAL_TEST_ONLY",
    effectiveFrom: new Date(Date.now() - 1000),
  };
  await db.insert(valoPrices).values(price);
  const buyer = await resolveWorkspace("synthetic-reach-buyer-" + premiumItem);
  const orderId = randomUUID();
  await db.insert(valoOrders).values({
    id: orderId,
    reference: "valo-test-" + orderId,
    workspaceId: buyer.workspaceId,
    requestedBy: buyer.identityId,
    priceId: price.id,
    requestKey: randomUUID(),
    amountKobo: price.amountKobo,
    currency: "NGN",
    line: {
      title: price.title,
      contentVersionId: premium.id,
      licenceVersion: price.licenceVersion,
      licenceText: price.licenceText,
      taxTreatment: price.taxTreatment,
    },
  });
  await settleVerifiedOrder(orderId, {
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    domain: "test",
    status: "success",
    reference: "valo-test-" + orderId,
    amount: price.amountKobo,
    currency: "NGN",
    metadata: { valoOrderId: orderId, workspaceId: buyer.workspaceId },
  });
  const bought = { workspaces: 1, bought: 1, documentWorkspaces: 0, documents: 0 };
  assert.deepEqual((await open(premiumItem)).reach, { version: 1, ...bought });
  // Its next edition reaches the buyer of the first too, as its notices tell holders of the template.
  const premiumSecond = await act(
    premiumItem,
    "publish",
    await save(premiumItem, "premium_template", "Synthetic reached agreement", 1),
  );
  assert.deepEqual(premiumSecond.reach, { version: 2, ...bought });
  const premiumWithdrawn = await act(premiumItem, "withdraw", premiumSecond);
  assert.equal(premiumWithdrawn.told, 1);
  assert.deepEqual(await notified(premiumSecond.id), [
    { workspace_id: buyer.workspaceId, held: true, documents: 0 },
  ]);

  // A guide has no buyers or documents: no counts while it is published, and none told when withdrawn.
  const guideItem = randomUUID();
  const guide = await act(
    guideItem,
    "publish",
    await save(guideItem, "practical_guide", "Synthetic reached guide"),
  );
  assert.equal(guide.reach, null);
  const guideWithdrawn = await act(guideItem, "withdraw", guide);
  assert.equal(guideWithdrawn.state, "withdrawn");
  assert.equal(guideWithdrawn.told, null);
}
