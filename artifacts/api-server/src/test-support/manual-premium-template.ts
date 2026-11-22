import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GetManualLibraryRevisionResponse, GetReleasedTemplateResponse } from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

export async function exercisePremiumManualTemplate(call: Call, editor: string) {
  const { db, valoPrices, runInWorkspaceScope } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { commerceProducts, createOrder, settleVerifiedOrder } = await import("../modules/commerce");
  const itemId = randomUUID();
  const path = "/admin/manual-library/" + itemId;
  const { bytes } = wordFromText("Synthetic private edition", "Only the purchaser may read this sentence.");
  const data = {
    kind: "premium_template",
    title: "Service agreement",
    body: "Public description of the synthetic agreement.",
    industry: null,
    requestId: randomUUID(),
    baseVersion: 0,
    fileMode: "upload",
    upload: { format: "docx", base64: bytes.toString("base64") },
  };
  const draft = (value: unknown) => call(path + "/drafts", value, editor);
  const readRevision = async (response: Response) => {
    assert.equal(response.status, 200);
    return GetManualLibraryRevisionResponse.parse(await response.json());
  };
  const act = (action: string, revision: { version: number; digest: string }) =>
    call(path + "/actions", { action, version: revision.version, digest: revision.digest }, editor);
  assert.equal((await draft({ ...data, kind: "template" })).status, 422);
  assert.equal((await draft({ ...data, title: "Invoice" })).status, 422);
  assert.equal((await draft({ ...data, body: "" })).status, 422);
  assert.equal((await draft({ ...data, body: "x".repeat(601) })).status, 422);
  assert.equal((await draft({ ...data, fileMode: "text", upload: undefined })).status, 422);
  const first = await readRevision(await draft(data));
  assert.deepEqual(
    Buffer.from(await (await call(path + "/revisions/1/file", undefined, editor)).arrayBuffer()),
    bytes,
  );
  const account = await resolveWorkspace("synthetic-premium-reader-" + itemId);
  const reader = account.identityId,
    other = "synthetic-other-premium-reader-" + itemId;
  const download = (edition: string, identity: string) =>
    call("/workspace/manual-premium-templates/" + edition + "/download", undefined, identity);
  const priceId = randomUUID();
  await db.insert(valoPrices).values({
    id: priceId,
    contentVersionId: first.id,
    title: "Synthetic premium fixture",
    amountKobo: 10000,
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
    approvalReference: "LOCAL_TEST_ONLY",
    effectiveFrom: new Date(),
  });
  const productVisible = () =>
    runInWorkspaceScope(account.workspaceId, async () =>
      (await commerceProducts()).some((p) => p.id === priceId),
    );
  assert.equal(await productVisible(), false);
  await readRevision(await act("publish", first));
  const detail = GetReleasedTemplateResponse.parse(
    await (await call("/public/templates/manual-" + itemId)).json(),
  );
  assert.equal(detail.access, "premium");
  assert.deepEqual(detail.preview, [data.body]);
  assert.equal((await call("/public/resources/manual-" + itemId)).status, 404);
  assert.equal(
    (await call("/account/manual-templates/" + first.id + "/download", undefined, reader)).status,
    404,
  );
  assert.equal((await download(first.id, "")).status, 401);
  assert.equal((await download(first.id, reader)).status, 403);
  assert.equal(await productVisible(), true);
  const orderFor = (holder: typeof account) =>
    runInWorkspaceScope(holder.workspaceId, () =>
      createOrder(holder, {
        priceId,
        acceptedLicenceVersion: "fixture-1",
        requestKey: randomUUID(),
      }),
    );
  const order = await orderFor(account);
  assert.equal((await download(first.id, reader)).status, 403);
  const verified = {
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    domain: "test" as const,
    status: "success" as const,
    reference: order.reference,
    amount: order.amountKobo,
    currency: "NGN" as const,
    metadata: { valoOrderId: order.id, workspaceId: account.workspaceId },
  };
  await settleVerifiedOrder(order.id, verified);
  const file = await download(first.id, reader);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal((await download(first.id, other)).status, 403);
  await settleVerifiedOrder(order.id, { ...verified, status: "reversed" });
  assert.equal((await download(first.id, reader)).status, 403);
  // Keep a different workspace's genuine test entitlement active across replacement.
  const secondBuyer = await resolveWorkspace(other);
  const secondOrder = await orderFor(secondBuyer);
  await settleVerifiedOrder(secondOrder.id, {
    ...verified,
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    reference: secondOrder.reference,
    metadata: { valoOrderId: secondOrder.id, workspaceId: secondBuyer.workspaceId },
  });
  assert.equal((await download(first.id, other)).status, 200);
  const next = await readRevision(
    await draft({ ...data, requestId: randomUUID(), baseVersion: 1, fileMode: "keep", upload: undefined }),
  );
  await readRevision(await act("publish", next));
  assert.equal(await productVisible(), false);
  assert.equal((await download(first.id, reader)).status, 403);
  assert.equal((await download(next.id, reader)).status, 403);
  assert.equal((await download(first.id, other)).status, 403);
  assert.equal((await download(next.id, other)).status, 403);
  await readRevision(await act("withdraw", next));
  assert.equal((await call("/public/templates/manual-" + itemId)).status, 404);
}
