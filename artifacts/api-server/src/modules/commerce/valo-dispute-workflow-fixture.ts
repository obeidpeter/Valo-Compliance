/** Actual PostgreSQL fixtures owned solely by the isolated dispute test suite. */
import { randomUUID } from "node:crypto";
import {
  db,
  valoPrices,
  valoOrders,
  valoEntitlements,
  valoStaffAssignments,
  valoEvents,
} from "@workspace/db";
import { resolveWorkspace } from "../workspaces";
import { financeHeldFixture } from "./valo-finance-test-fixture";
import { type FinanceActor } from "./valo-refunds";
import { makeDisputeTransport } from "./valo-dispute-provider";
import { setting } from "../../platform/settings";
import { singleRow } from "../../platform/rows";
export async function disputeFixture() {
  if (
    setting("NODE_ENV") !== "development" ||
    setting("REPLIT_DEPLOYMENT") ||
    setting("VALO_RUN_DISPUTE_TESTS") !== "synthetic-development-only" ||
    setting("PAYSTACK_SECRET_KEY")
  )
    throw Error("OWNED_DISPUTE_FIXTURE_REQUIRED");
  const owner = await resolveWorkspace(`synthetic-dispute-${randomUUID()}`),
    other = await resolveWorkspace(`synthetic-dispute-${randomUUID()}`);
  const staff: FinanceActor = {
      identityId: `synthetic-dispute-finance-${randomUUID()}`,
      recentMfa: true,
      verifiedAt: Date.now(),
    },
    role = randomUUID();
  await db.insert(valoStaffAssignments).values({
    id: role,
    identityId: staff.identityId,
    role: "finance",
    grantedBy: "synthetic-fixture",
    reason: "Isolated dispute test only.",
  });
  const held = await financeHeldFixture(),
    priceId = randomUUID(),
    id = randomUUID();
  await db.insert(valoPrices).values({
    id: priceId,
    contentVersionId: held.id,
    title: "CONTROLLED DISPUTE — NOT FOR SALE",
    amountKobo: 10000,
    licenceVersion: "test-only",
    licenceText: "Synthetic fixture only.",
    taxTreatment: "No tax assertion",
    approvalReference: "NOT_APPROVAL",
    effectiveFrom: new Date(),
  });
  const transactionId = String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    providerId = String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16));
  const order = singleRow(
    await db
      .insert(valoOrders)
      .values({
        id,
        workspaceId: owner.workspaceId,
        requestedBy: owner.identityId,
        requestKey: randomUUID(),
        priceId,
        reference: `valo-test-${id}`,
        providerTransactionId: transactionId,
        amountKobo: 10000,
        status: "verified_success",
        line: {
          title: "Controlled dispute order",
          contentVersionId: held.id,
          licenceVersion: "test-only",
          licenceText: "Synthetic fixture",
          taxTreatment: "No tax assertion",
        },
      })
      .returning(),
  );
  await db
    .insert(valoEntitlements)
    .values({ id: randomUUID(), workspaceId: owner.workspaceId, orderId: id, contentVersionId: held.id });
  await db.insert(valoEvents).values({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    actorId: "synthetic:fixture",
    action: "payment.verified_success",
    entityId: id,
  });
  const canonical = {
    id: providerId,
    domain: "test" as const,
    status: "awaiting-merchant-feedback",
    resolution: null as string | null,
    refund_amount: null as number | null,
    category: "fraud",
    currency: "NGN",
    transaction: {
      id: transactionId,
      domain: "test",
      reference: order.reference,
      amount: 10000,
      currency: "NGN",
    },
  };
  let posts = 0,
    puts = 0,
    uploads = 0,
    gets = 0;
  const api = async (path: string, body?: unknown, method = "GET") => {
    if (method === "GET") {
      gets++;
      if (path.includes("upload_url")) {
        const day = new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d+Z$/, "Z");
        return {
          fileName: "controlled-receipt.pdf",
          signedUrl: `https://s3.eu-west-1.amazonaws.com/files.paystack.co/controlled.pdf?X-Amz-Date=${day}&X-Amz-Expires=600`,
        };
      }
      return { ...canonical, transaction: { ...canonical.transaction } };
    }
    if (method === "POST") {
      posts++;
      return { id: "8123", dispute: providerId };
    }
    puts++;
    const v = body as { resolution: string; refund_amount: number };
    canonical.status = "awaiting-bank-feedback";
    canonical.resolution = v.resolution;
    canonical.refund_amount = v.refund_amount;
    return {};
  };
  const upload: typeof fetch = async (_url, init) => {
    uploads++;
    if (new Headers(init?.headers).has("authorization")) throw Error("UPLOAD_AUTH_LEAK");
    return new Response(null, { status: 204 });
  };
  const provider = makeDisputeTransport(api, upload, () => true);
  return {
    owner,
    other,
    staff,
    role,
    order,
    providerId,
    canonical,
    provider,
    api,
    upload,
    counters: () => ({ posts, puts, uploads, gets }),
  };
}
