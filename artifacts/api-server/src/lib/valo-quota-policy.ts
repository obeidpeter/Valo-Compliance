import { createHmac } from "node:crypto";
import { setting } from "../platform/settings";

/**
 * Today's ceilings, one for each bucket a request is counted in. Each is the default of a setting of
 * its own (SEC-005: "Start with configurable ceilings"), so a value set for one replaces it; read a
 * ceiling with quotaLimit. Future cost-incurring operations remain disabled.
 */
export const quotaPolicy = {
  // Support requests from people who are not signed in: from one contact address, from one network
  // address, and from everyone together.
  "public-support": 3,
  "public-support-day": 20,
  "public-support-socket": 20,
  "public-support-socket-day": 100,
  "public-support-all": 100,
  "public-support-all-day": 1000,
  "anonymous-read": 60,
  "authenticated-read": 120,
  // Every page the web server renders, for all visitors together: each visitor's own reads count
  // against "anonymous-read", and this caps what forwarded addresses can add up to.
  "page-render-read": 600,
  "customer-ai": 5,
  "checkout-create": 10,
  // SEC-005's account limit on checkout, counted by the day apart from the minute's ceiling above.
  "checkout-create-day": 100,
  "export-create": 10,
  "profile-write": 20,
  "profile-write-day": 200,
  "document-write": 30,
  "document-write-day": 600,
  "support-write": 3,
  "support-write-day": 20,
  // A member of staff's support actions, counted apart from customers' support messages.
  "staff-support-write": 20,
  "staff-support-write-day": 200,
  "refund-create": 10,
  "refund-create-day": 50,
} as const;
export type QuotaBucket = keyof typeof quotaPolicy;

type Snake<S extends string> = S extends `${infer A}-${infer B}` ? `${A}_${Snake<B>}` : S;
/** The setting that sets a bucket's ceiling; each is registered in platform/settings.ts. */
export type LimitSettingName = `VALO_LIMIT_${Uppercase<Snake<QuotaBucket>>}`;
/** "anonymous-read" is set by VALO_LIMIT_ANONYMOUS_READ. */
export const limitSettingName = (bucket: QuotaBucket) =>
  `VALO_LIMIT_${bucket.toUpperCase().replaceAll("-", "_")}` as LimitSettingName;

/** The bounds consumeQuota already holds every ceiling to. */
export const QUOTA_LIMIT_BOUNDS = { min: 1, max: 10_000 } as const;

/**
 * The ceiling a request meets in a bucket: its setting's value, or today's ceiling when the setting is
 * unset or empty. A value that is not a whole number from 1 to 10,000, written plainly, is refused.
 */
export function quotaLimit(bucket: QuotaBucket): number {
  const name = limitSettingName(bucket);
  const raw = setting(name);
  if (raw === undefined || raw === "") return quotaPolicy[bucket];
  const value = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= QUOTA_LIMIT_BOUNDS.min && value <= QUOTA_LIMIT_BOUNDS.max))
    throw Object.assign(new Error(`RequestLimitSettingInvalid: ${name}`), {
      code: "REQUEST_LIMIT_SETTING_INVALID",
    });
  return value;
}

/**
 * Every ceiling as requests will meet it. The API and the worker read them all as they start, so a
 * value outside its bounds stops them before they serve or work.
 */
export function requestLimits(): Record<QuotaBucket, number> {
  return Object.fromEntries(
    (Object.keys(quotaPolicy) as QuotaBucket[]).map((bucket) => [bucket, quotaLimit(bucket)]),
  ) as Record<QuotaBucket, number>;
}

export type QuotaDecision = {
  allowed: boolean;
  used: number;
  retryAfter: number;
  resetAt: Date;
  limit: number;
};
export function quotaSubjectHash(
  secret: string | undefined,
  subjectKind: "ip" | "user",
  subject: string,
): string {
  if (!secret || secret.length < 32 || !subject) throw new Error("QuotaConfigurationUnavailable");
  return createHmac("sha256", secret).update(`valo:quota:v1:${subjectKind}:${subject}`).digest("hex");
}
