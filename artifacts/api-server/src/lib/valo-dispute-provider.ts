import { createHash } from "node:crypto";
import { z } from "zod";
import { ValoProblem } from "./valo-problem";
import { verifiedDispute } from "./valo-dispute-schema";
import { paystackRequest, sandboxPaymentsConfigured } from "./valo-paystack-contract";
import { assertRecoveryEffectsAllowed } from "./valo-recovery-effects";

const providerId = z.string().regex(/^\d{1,40}$/);
const filename = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/);
export const disputeInformation = z
  .object({
    customer_email: z.string().email().max(254),
    customer_name: z.string().trim().min(1).max(150),
    customer_phone: z.string().trim().min(5).max(40),
    service_details: z.string().trim().min(10).max(2000),
    delivery_address: z.string().trim().min(1).max(500).optional(),
    delivery_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(v + "T00:00:00Z");
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
      })
      .optional(),
  })
  .strict();
export type DisputeContext = {
  providerId: string;
  transactionId: string;
  reference: string;
  amountKobo: number;
};
export type MerchantDecision = {
  resolution: "merchant-accepted" | "declined";
  amountKobo: number;
  message: string;
  uploadedFilename?: string;
  evidenceId?: string;
};
export type DisputeTransport = {
  configured(): boolean;
  fetch(context: DisputeContext): Promise<z.infer<typeof verifiedDispute>>;
  upload(
    context: DisputeContext,
    name: string,
    bytes: Buffer,
    beforePut?: (proof: { filename: string; checksum: string }) => Promise<void>,
  ): Promise<{ filename: string; checksum: string }>;
  evidence(
    context: DisputeContext,
    information: unknown,
    beforeSend?: () => Promise<void>,
  ): Promise<{ evidenceId: string }>;
  resolve(context: DisputeContext, input: MerchantDecision, beforeSend?: () => Promise<void>): Promise<void>;
};
export function matchDispute(context: DisputeContext, raw: unknown) {
  providerId.parse(context.providerId);
  providerId.parse(context.transactionId);
  const data = verifiedDispute.parse(raw);
  if (
    data.id !== context.providerId ||
    data.transaction.id !== context.transactionId ||
    data.transaction.reference !== context.reference ||
    data.transaction.amount !== context.amountKobo ||
    (data.refund_amount !== null && data.refund_amount > context.amountKobo)
  )
    throw new ValoProblem(409, "The canonical test dispute does not match the selected order.");
  return data;
}
export function resolutionPayload(input: MerchantDecision, paid: number) {
  const data = z
    .object({
      resolution: z.enum(["merchant-accepted", "declined"]),
      amountKobo: z.number().int().min(0).max(2147483647),
      message: z.string().trim().min(10).max(1500),
      uploadedFilename: filename.optional(),
      evidenceId: providerId.optional(),
    })
    .strict()
    .parse(input);
  if (
    data.amountKobo > paid ||
    (data.resolution === "merchant-accepted" && data.amountKobo === 0) ||
    (data.resolution === "declined" && (data.amountKobo !== 0 || !data.uploadedFilename))
  )
    throw new ValoProblem(
      422,
      "Accept a positive full/partial amount within the payment, or decline with uploaded evidence and zero refund.",
    );
  const evidence = data.evidenceId === undefined ? undefined : Number(data.evidenceId);
  if (evidence !== undefined && (!Number.isSafeInteger(evidence) || evidence < 0))
    throw new ValoProblem(422, "The provider evidence identifier is outside the supported integer range.");
  return {
    resolution: data.resolution,
    message: data.message,
    refund_amount: data.amountKobo,
    ...(data.uploadedFilename ? { uploaded_filename: data.uploadedFilename } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
  };
}
/** A deliberately narrow supported destination, taken from the official
 * reference. Unknown destinations hold; redirects cannot expand the allowlist. */
export function validateDisputeUpload(raw: string, now = Date.now()) {
  const u = new URL(raw),
    date = u.searchParams.get("X-Amz-Date"),
    seconds = u.searchParams.get("X-Amz-Expires");
  if (
    u.protocol !== "https:" ||
    u.hostname !== "s3.eu-west-1.amazonaws.com" ||
    u.port ||
    u.username ||
    u.password ||
    u.hash ||
    !u.pathname.startsWith("/files.paystack.co/") ||
    decodeURIComponent(u.pathname).includes("..") ||
    !date ||
    !/^\d{8}T\d{6}Z$/.test(date) ||
    !seconds ||
    !/^\d+$/.test(seconds)
  )
    throw new ValoProblem(503, "The provider upload destination cannot be validated.");
  const instant = Date.parse(
    date.slice(0, 4) +
      "-" +
      date.slice(4, 6) +
      "-" +
      date.slice(6, 8) +
      "T" +
      date.slice(9, 11) +
      ":" +
      date.slice(11, 13) +
      ":" +
      date.slice(13, 15) +
      "Z",
  );
  if (
    !Number.isFinite(instant) ||
    Number(seconds) < 1 ||
    Number(seconds) > 1800 ||
    instant > now + 60000 ||
    instant + Number(seconds) * 1000 <= now
  )
    throw new ValoProblem(
      409,
      "The provider upload destination is expired or outside its supported validity window.",
    );
  return u.href;
}
type Api = (path: string, body?: unknown, method?: "GET" | "POST" | "PUT") => Promise<unknown>;
export class DisputeMutationNotSent extends ValoProblem {}
async function beforeMutation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new DisputeMutationNotSent(
      e instanceof ValoProblem ? e.status : 503,
      "The dispute preflight did not permit a provider mutation. Read-only requests may have run.",
    );
  }
}
/** Controlled transports exercise this exact implementation. No provider
 * authorization header is ever passed to the separate object-upload client. */
export function makeDisputeTransport(
  api: Api,
  upload: typeof fetch = fetch,
  enabled = () => false,
  clock = Date.now,
): DisputeTransport {
  const check = () => {
    assertRecoveryEffectsAllowed();
    if (!enabled())
      throw new ValoProblem(503, "Merchant dispute execution is disabled. No provider action was sent.");
  };
  const read = async (c: DisputeContext) => {
    check();
    return matchDispute(c, await api("/dispute/" + providerId.parse(c.providerId)));
  };
  const actionable = async (c: DisputeContext) => {
    const d = await read(c);
    if (d.status !== "awaiting-merchant-feedback")
      throw new ValoProblem(
        409,
        "The canonical dispute is not awaiting merchant feedback. Reconcile without sending another decision.",
      );
    return d;
  };
  return {
    configured: enabled,
    fetch: read,
    async upload(c, name, bytes, beforePut) {
      await beforeMutation(async () => {
        check();
        filename.parse(name);
        if (
          !name.endsWith(".pdf") ||
          bytes.length < 20 ||
          bytes.length > 2 * 1024 * 1024 ||
          bytes.subarray(0, 5).toString() !== "%PDF-"
        )
          throw new ValoProblem(422, "Only a bounded server-generated purchase receipt PDF is supported.");
      });
      await beforeMutation(() => actionable(c));
      const data = await beforeMutation(async () =>
        z
          .object({ signedUrl: z.string().url(), fileName: filename })
          .parse(
            await api("/dispute/" + c.providerId + "/upload_url?upload_filename=" + encodeURIComponent(name)),
          ),
      );
      const target = await beforeMutation(async () => validateDisputeUpload(data.signedUrl, clock()));
      const proof = { filename: data.fileName, checksum: createHash("sha256").update(bytes).digest("hex") };
      if (beforePut) await beforeMutation(() => beforePut(proof));
      await beforeMutation(async () => check());
      const response = await upload(target, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: new Uint8Array(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        throw new ValoProblem(
          503,
          "The receipt upload was not acknowledged. Its outcome needs reconciliation.",
        );
      // Successful S3 PUT may have an empty body. Do not parse it as JSON.
      return proof;
    },
    async evidence(c, raw, beforeSend) {
      const data = await beforeMutation(async () => {
        check();
        return disputeInformation.parse(raw);
      });
      await beforeMutation(() => actionable(c));
      if (beforeSend) await beforeMutation(beforeSend);
      await beforeMutation(async () => check());
      const result = z
        .object({
          id: z.union([providerId, z.number().int().nonnegative().safe()]).transform(String),
          dispute: z.union([providerId, z.number().int().nonnegative().safe()]).transform(String),
        })
        .parse(await api("/dispute/" + c.providerId + "/evidence", data, "POST"));
      if (result.dispute !== c.providerId)
        throw new ValoProblem(409, "The evidence receipt belongs to a different dispute.");
      return { evidenceId: result.id };
    },
    async resolve(c, input, beforeSend) {
      const payload = await beforeMutation(async () => {
          check();
          return resolutionPayload(input, c.amountKobo);
        }),
        current = await beforeMutation(() => actionable(c));
      if (current.category === "fraud" && payload.resolution === "declined" && payload.evidence === undefined)
        throw new DisputeMutationNotSent(
          422,
          "This fraud claim also requires acknowledged structured evidence.",
        );
      if (!["general", "fraud"].includes(current.category ?? ""))
        throw new DisputeMutationNotSent(
          409,
          "The provider claim category is unknown. Hold the decision pending verified classification.",
        );
      // No automatic mutation retry, even on timeout. The durable caller records
      // intent first and reconciles a subsequent canonical GET.
      if (beforeSend) await beforeMutation(beforeSend);
      await beforeMutation(async () => check());
      await api("/dispute/" + c.providerId + "/resolve", payload, "PUT");
    },
  };
}
export const disputeTransport = makeDisputeTransport(
  paystackRequest,
  fetch,
  () => sandboxPaymentsConfigured() && process.env.VALO_SANDBOX_DISPUTES_ENABLED === "true",
);
