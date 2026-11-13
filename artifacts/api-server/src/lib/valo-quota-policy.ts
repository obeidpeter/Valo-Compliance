import { createHmac } from "node:crypto";

/** Versioned initial ceilings; future cost-incurring operations remain disabled. */
export const quotaPolicy = {
  "anonymous-read": 60, "authenticated-read": 120,
  "customer-ai": 5, "checkout-create": 10, "export-create": 10,
} as const;
export type QuotaBucket = keyof typeof quotaPolicy;
export type QuotaDecision = {
  allowed: boolean; used: number; retryAfter: number; resetAt: Date; limit: number;
};
export function quotaSubjectHash(secret: string | undefined, subjectKind: "ip" | "user", subject: string): string {
  if (!secret || secret.length < 32 || !subject) throw new Error("QuotaConfigurationUnavailable");
  return createHmac("sha256", secret).update(`valo:quota:v1:${subjectKind}:${subject}`).digest("hex");
}
