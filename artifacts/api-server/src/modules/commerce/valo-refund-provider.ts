import { z } from "zod";
import { paystackRequest, sandboxPaymentsConfigured } from "./valo-paystack-contract";
import { ValoProblem } from "../../lib/valo-problem";
import { setting } from "../../platform/settings";
const providerId = z
  .union([z.string().regex(/^\d{1,40}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform(String);
export const providerRefund = z.object({
  id: providerId,
  reference: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  domain: z.literal("test"),
  amount: z.number().int().positive().max(2147483647),
  currency: z.literal("NGN"),
  transaction: z
    .union([providerId, z.object({ id: providerId, domain: z.literal("test").optional() })])
    .transform((v) => (typeof v === "string" ? v : v.id)),
  status: z.enum(["pending", "processing", "needs-attention", "failed", "processed"]),
});
export type RefundObservation = z.infer<typeof providerRefund>;
export type RefundProvider = {
  configured(): boolean;
  find(reference: string): Promise<unknown>;
  create(input: {
    reference: string;
    transaction: string;
    amount: number;
    currency: "NGN";
  }): Promise<unknown>;
};
export const refundProvider: RefundProvider = {
  configured: () => sandboxPaymentsConfigured() && setting("VALO_SANDBOX_REFUNDS_ENABLED") === "true",
  async find(reference) {
    const data = z
      .array(z.unknown())
      .max(2)
      .parse(await paystackRequest("/refund?reference=" + encodeURIComponent(reference)));
    if (data.length > 1)
      throw new ValoProblem(409, "Ambiguous provider refund reference. Finance reconciliation is required.");
    return data[0] ?? null;
  },
  async create(input) {
    try {
      return await paystackRequest("/refund", input);
    } catch (error) {
      // POST may have succeeded before a timeout or reference-conflict response.
      // Never generate a replacement reference or infer failure from HTTP status.
      const existing = await this.find(input.reference);
      if (existing) return existing;
      throw error;
    }
  },
};
export function assertRefundMatch(
  expected: { reference: string; amountKobo: number | null },
  transaction: string,
  raw: unknown,
) {
  const data = providerRefund.parse(raw);
  if (
    data.reference !== expected.reference ||
    data.amount !== expected.amountKobo ||
    data.transaction !== transaction
  )
    throw new ValoProblem(
      409,
      "Refund amount, transaction or reference mismatch. No completion was recorded.",
    );
  return data;
}
export const TEST_REFUND_POLICY_VERSION = "test-refund-v1";
export const TEST_REFUND_POLICY =
  "Development test policy only, not approved live commercial terms. Requested and uncertain amounts remain reserved. A confirmed partial refund keeps reuse unless a reversal or dispute suspends access; a confirmed full refund suspends future template reuse. Saved drafts, revisions and already downloaded files are never deleted. Provider processing is not proof of bank credit.";
export function refundBalance(
  paid: number,
  rows: { amountKobo: number | null; status: string; completedAt?: Date | null }[],
) {
  let reserved = 0,
    processed = 0;
  for (const row of rows) {
    if ((row.status === "rejected" || row.status === "failed") && !row.completedAt) continue;
    const amount = row.amountKobo ?? paid;
    reserved += amount;
    if (row.status === "processed" || row.completedAt) processed += amount;
  }
  return { refundableKobo: Math.max(0, paid - reserved), refundedKobo: processed };
}
