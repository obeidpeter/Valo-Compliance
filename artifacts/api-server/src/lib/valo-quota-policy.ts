import { createHmac } from "node:crypto";

/** Versioned initial ceilings; future cost-incurring operations remain disabled. */
export const quotaPolicy = {
  "public-support":3,"public-support-day":20,
  "anonymous-read": 60, "authenticated-read": 120,
  "customer-ai": 5, "checkout-create": 10, "export-create": 10,
  "profile-write":20,"profile-write-day":200,
  "document-write":30,"document-write-day":600,
  "support-write":3,"support-write-day":20,
} as const;
export type QuotaBucket = keyof typeof quotaPolicy;
export type QuotaDecision = {
  allowed: boolean; used: number; retryAfter: number; resetAt: Date; limit: number;
};
export function quotaSubjectHash(secret: string | undefined, subjectKind: "ip" | "user", subject: string): string {
  if (!secret || secret.length < 32 || !subject) throw new Error("QuotaConfigurationUnavailable");
  return createHmac("sha256", secret).update(`valo:quota:v1:${subjectKind}:${subject}`).digest("hex");
}
