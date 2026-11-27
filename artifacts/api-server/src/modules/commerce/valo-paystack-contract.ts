import { assertRecoveryEffectsAllowed } from "../../platform/valo-recovery-effects";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ValoProblem } from "../../platform/valo-problem";
import { setting } from "../../platform/settings";

export type WebhookConfiguration =
  { mode: "timestamped"; secrets: string[] } | { mode: "legacy"; apiSecret: string };
/** The merchant's configured mode is explicit. A bad new signature never downgrades. */
export function authenticPaystackBody(
  raw: Buffer,
  header: string | undefined,
  config: WebhookConfiguration,
  now = Math.floor(Date.now() / 1000),
) {
  if (!Buffer.isBuffer(raw) || !header || header.length > 4096) return false;
  const compare = (expected: Buffer, hex: string) =>
    /^[a-f0-9]{128}$/.test(hex) && timingSafeEqual(expected, Buffer.from(hex, "hex"));
  if (config.mode === "legacy")
    return (
      config.apiSecret.startsWith("sk_test_") &&
      compare(createHmac("sha512", config.apiSecret).update(raw).digest(), header)
    );
  if (config.secrets.length === 0 || config.secrets.some((s) => !s.startsWith("whsec_"))) return false;
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim(),
      value = part.slice(at + 1).trim();
    if (name === "t") {
      if (timestamp !== undefined || !/^[0-9]{1,12}$/.test(value)) return false;
      timestamp = value;
    }
    if (name === "v1") {
      const match = /^whk_[A-Za-z0-9]+:([a-f0-9]{128})$/.exec(value);
      if (match) signatures.push(match[1]!);
    }
  }
  if (!timestamp || Math.abs(now - Number(timestamp)) > 300 || !signatures.length) return false;
  return config.secrets.some((secret) => {
    const expected = createHmac("sha512", secret)
      .update(timestamp + ".")
      .update(raw)
      .digest();
    return signatures.some((hex) => compare(expected, hex));
  });
}
export const verifiedTransaction = z.object({
  id: z
    .union([z.string().regex(/^\d{1,40}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .transform(String),
  domain: z.literal("test"),
  reference: z.string().min(1).max(150),
  status: z.enum([
    "abandoned",
    "failed",
    "ongoing",
    "pending",
    "processing",
    "queued",
    "reversed",
    "success",
  ]),
  amount: z.number().int().positive().max(2147483647),
  currency: z.literal("NGN"),
  metadata: z.object({ valoOrderId: z.string().uuid(), workspaceId: z.string().uuid() }),
});
export type VerifiedTransaction = z.infer<typeof verifiedTransaction>;
export function assertOrderMatch(
  order: { id: string; workspaceId: string; reference: string; amountKobo: number; currency: string },
  data: VerifiedTransaction,
) {
  if (
    data.reference !== order.reference ||
    data.amount !== order.amountKobo ||
    data.currency !== order.currency ||
    data.metadata.valoOrderId !== order.id ||
    data.metadata.workspaceId !== order.workspaceId
  )
    throw new ValoProblem(
      409,
      "The payment verification does not match this order. No purchase was granted; staff reconciliation is required.",
    );
}
/** What the provider's answer for an order's reference says differently from the order
 * (docs/architecture/reconciliation.md, slice 1). `settleVerifiedOrder` refuses each of them; the daily
 * check names them, so that finance reads which it is. */
export function orderDifferences(
  order: {
    id: string;
    workspaceId: string;
    reference: string;
    amountKobo: number;
    currency: string;
    status: string;
    providerTransactionId: string | null;
  },
  data: VerifiedTransaction,
) {
  return [
    ...(data.amount !== order.amountKobo || data.currency !== order.currency ? ["AMOUNT_DIFFERENCE"] : []),
    ...(data.reference !== order.reference ||
    data.metadata.valoOrderId !== order.id ||
    data.metadata.workspaceId !== order.workspaceId ||
    (order.providerTransactionId !== null && order.providerTransactionId !== data.id)
      ? ["TRANSACTION_DIFFERENCE"]
      : []),
    ...(order.status === "reversed" && data.status !== "reversed" ? ["REVERSAL_DIFFERENCE"] : []),
  ];
}
/**
 * The Paystack events Valo processes: one-time charges, refunds and disputes. Any other event,
 * such as a subscription, invoice, transfer or payment request, is stored as ignored and never
 * processed: R1 keeps recurring billing, wallets, split settlements and collections off (PAY-010).
 */
/**
 * A provider event that names nothing of Valo's: no reference, or a reference that no order or refund
 * request holds (docs/architecture/reconciliation.md, slice 3a). The event worker ends it at once for
 * finance, as it does any refusal, and names it `UNMATCHED_REFERENCE`.
 */
export class UnmatchedPaymentEvent extends ValoProblem {
  constructor(message: string) {
    super(409, message);
  }
}
/** Why the event worker left a provider event for finance (docs/architecture/reconciliation.md, slice 3a):
 * it names nothing of Valo's; what the provider says differs from Valo's record; or no answer that could
 * be used came, five times. Events from before slice 3 keep `SERVER_VERIFICATION_REQUIRED`, and an
 * erasure writes `PRIVACY_ERASURE_FINANCE_REVIEW`. */
export function paymentEventFinding(error: unknown) {
  if (error instanceof UnmatchedPaymentEvent) return "UNMATCHED_REFERENCE";
  if (error instanceof ValoProblem && error.status === 409) return "RECORD_DIFFERENCE";
  return "NO_ANSWER";
}
export function paystackEventFamily(event: string): "charge" | "refund" | "dispute" | undefined {
  if (event === "charge.success") return "charge";
  if (/^refund\.(pending|processing|needs-attention|failed|processed)$/.test(event)) return "refund";
  if (/^charge\.dispute\.(create|remind|resolve)$/.test(event)) return "dispute";
  return undefined;
}
export function sandboxPaymentsConfigured() {
  return (
    setting("NODE_ENV") === "development" &&
    !setting("REPLIT_DEPLOYMENT") &&
    setting("VALO_SANDBOX_CHECKOUT_ENABLED") === "true" &&
    Boolean(setting("PAYSTACK_SECRET_KEY")?.startsWith("sk_test_"))
  );
}
function testSecret() {
  if (
    setting("NODE_ENV") !== "development" ||
    setting("REPLIT_DEPLOYMENT") ||
    setting("VALO_SANDBOX_CHECKOUT_ENABLED") !== "true" ||
    !setting("PAYSTACK_SECRET_KEY")?.startsWith("sk_test_")
  )
    throw new ValoProblem(
      503,
      "Sandbox checkout needs a configured Paystack test merchant and explicit enablement. No charge or entitlement was created.",
    );
  return setting("PAYSTACK_SECRET_KEY");
}
/** Only the fixed provider host is reachable; discard all instrument/customer data. */
/** Paystack's API, the only address a Paystack request goes to. Tests that stand in for Paystack
 * match requests against it, so no other file names the address. */
export const PAYSTACK_API = "https://api.paystack.co";
export async function paystackRequest(
  path: string,
  body?: unknown,
  method: "GET" | "POST" | "PUT" = body ? "POST" : "GET",
): Promise<unknown> {
  assertRecoveryEffectsAllowed();
  const key = testSecret();
  let response: Response;
  try {
    response = await fetch(PAYSTACK_API + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ValoProblem(
      503,
      "Paystack did not respond. Keep this order and refresh its status before starting another payment.",
    );
  }
  if (!response.ok)
    throw new ValoProblem(503, "Paystack could not complete this request. No successful payment is assumed.");
  const result = (await response.json()) as { status?: unknown; data?: unknown };
  if (result.status !== true) throw new ValoProblem(503, "Paystack has not confirmed this request.");
  return result.data;
}
export const paystack = {
  async verify(reference: string) {
    return verifiedTransaction.parse(
      await paystackRequest("/transaction/verify/" + encodeURIComponent(reference)),
    );
  },
  async initialise(
    order: { reference: string; amountKobo: number; id: string; workspaceId: string },
    email: string,
    callbackUrl: string,
  ) {
    const data = await paystackRequest("/transaction/initialize", {
      reference: order.reference,
      amount: order.amountKobo,
      currency: "NGN",
      email,
      callback_url: callbackUrl,
      metadata: { valoOrderId: order.id, workspaceId: order.workspaceId },
    });
    const parsed = z.object({ authorization_url: z.string().url(), reference: z.string() }).parse(data);
    const url = new URL(parsed.authorization_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "checkout.paystack.com" ||
      url.username ||
      url.password ||
      parsed.reference !== order.reference
    )
      throw new ValoProblem(503, "The checkout response could not be validated.");
    return parsed.authorization_url;
  },
};
