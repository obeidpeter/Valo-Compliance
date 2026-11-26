import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The owner's commercial settings (docs/architecture/commercial-settings.md, slice 3; ADM-006). Each key
 * is listed here with its check and its default, which is the constant the code held before and stays
 * the value until the owner records one. A setting is versioned as a price is: its value never changes
 * in place, a new value closes the open one when it starts, once, and the change log keeps both
 * (migration commercial_setting_guards). Only the product owner decides a value, so only the development
 * owner records one, after a preview of the exact terms and their checksum.
 *
 * A higher drafting allowance lets more drafts be asked for in a day. Spending on the AI provider is
 * still bounded by the owner's approved inference budget (decision 0008), which these settings never
 * change.
 */
export const COMMERCIAL_SETTINGS = {
  drafting_workspace_daily: {
    title: "The drafting assistant's daily allowance for each workspace",
    unit: "drafts a day",
    defaultValue: 30,
    // Ten times today's allowance: a larger figure is far more likely a typing error.
    max: 300,
  },
  drafting_daily_in_all: {
    title: "The drafting assistant's daily allowance in all",
    unit: "drafts a day",
    defaultValue: 120,
    max: 1200,
  },
} as const;

export type CommercialSettingKey = keyof typeof COMMERCIAL_SETTINGS;
export const COMMERCIAL_SETTING_KEYS = Object.keys(COMMERCIAL_SETTINGS) as CommercialSettingKey[];

export type CommercialSettingTerms = {
  key: CommercialSettingKey;
  value: number;
  /** "now", or an ISO 8601 time with its offset. */
  from: string;
};

const oneLine = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && !/[\r\n\t]/.test(value);

const isKey = (key: string): key is CommercialSettingKey => COMMERCIAL_SETTING_KEYS.includes(key as never);

/** The terms as the owner gave them, checked. Nothing is read or written. */
export function commercialSettingTerms(input: {
  key: string | undefined;
  value: string | undefined;
  from?: string | undefined;
}): CommercialSettingTerms {
  const key = input.key ?? "";
  if (!isKey(key)) throw new ValoProblem(422, "Choose one of the settings listed.");
  const setting = COMMERCIAL_SETTINGS[key];
  const text = (input.value ?? "").trim();
  if (!/^\d{1,7}$/.test(text))
    throw new ValoProblem(422, `Write ${setting.unit} as a whole number, such as ${setting.defaultValue}.`);
  const value = Number(text);
  if (value > setting.max)
    throw new ValoProblem(
      422,
      `${setting.title} is at most ${setting.max} ${setting.unit}: a larger figure is more likely a typing error.`,
    );
  const from = (input.from ?? "now").trim();
  if (
    from !== "now" &&
    !(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(from) &&
      Number.isFinite(Date.parse(from))
    )
  )
    throw new ValoProblem(
      422,
      "Give the start as now, or as a time with its offset, such as 2026-12-01T00:00:00+01:00.",
    );
  return { key, value, from };
}

/** The checksum of exactly these terms, which recording them confirms. */
export function commercialSettingTermsId(terms: CommercialSettingTerms) {
  return createHash("sha256")
    .update(JSON.stringify(["valo-commercial-setting-v1", terms.key, terms.value, terms.from]))
    .digest("hex");
}

export type CommercialSettingApproval = { approvedBy: string; reference: string; confirm: string };

/**
 * Records a setting's value in the caller's transaction, and closes the setting's open value when the
 * new one starts. Refused unless `confirm` is the checksum of exactly these terms.
 */
export async function recordCommercialSettingIn(
  tx: Tx,
  terms: CommercialSettingTerms,
  approval: CommercialSettingApproval,
) {
  if (approval.confirm !== commercialSettingTermsId(terms))
    throw new ValoProblem(
      409,
      "The confirmation is not the checksum of these terms. Preview them again and confirm that.",
    );
  const approvedBy = approval.approvedBy.trim(),
    reference = approval.reference.trim();
  if (!oneLine(approvedBy, 2, 120)) throw new ValoProblem(422, "Name who approved the value, on one line.");
  if (!oneLine(reference, 3, 160))
    throw new ValoProblem(422, "Say where the approval is written, on one line.");
  const { valoCommercialSettings: s } = await import("@workspace/db");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"commercial-setting:" + terms.key}, 0))`,
  );
  const { rows } = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
  const now = new Date(rows[0]!.now);
  const from = terms.from === "now" ? now : new Date(terms.from);
  if (+from < +now)
    throw new ValoProblem(
      409,
      "This value would start in the past. Preview it again with now or a later start.",
    );
  // A value that starts now starts at the transaction's own time, as the database holds it: a copy read
  // back keeps only milliseconds, and closing a value a fraction before now() is refused.
  const start = terms.from === "now" ? sql`now()` : from;
  const open = await tx
    .select()
    .from(s)
    .where(and(eq(s.key, terms.key), or(isNull(s.effectiveTo), gt(s.effectiveTo, start))))
    .orderBy(asc(s.effectiveFrom), asc(s.id))
    .for("update");
  const scheduled = open.find((value) => +value.effectiveFrom >= +from);
  if (scheduled)
    throw new ValoProblem(
      409,
      `A value of this setting already starts at ${scheduled.effectiveFrom.toISOString()}. Start the new one after it.`,
    );
  const ending = open.find((value) => value.effectiveTo !== null);
  if (ending)
    throw new ValoProblem(
      409,
      `This setting's value already ends at ${ending.effectiveTo!.toISOString()}. Start the new one then or later.`,
    );
  for (const value of open) await tx.update(s).set({ effectiveTo: start }).where(eq(s.id, value.id));
  const settingId = randomUUID();
  const [recorded] = await tx
    .insert(s)
    .values({
      id: settingId,
      key: terms.key,
      value: terms.value,
      approvalReference: `${reference} (approved by ${approvedBy})`,
      effectiveFrom: start,
    })
    .returning({ effectiveFrom: s.effectiveFrom });
  return {
    settingId,
    key: terms.key,
    value: terms.value,
    from: recorded!.effectiveFrom,
    closed: open.map((value) => ({ settingId: value.id, value: value.value })),
  };
}

/** Each setting with its default and the values in effect or scheduled to start. Read-only. */
export async function commercialSettingStatus() {
  const { db: store, valoCommercialSettings: s } = await import("@workspace/db");
  const values = await store
    .select({
      settingId: s.id,
      key: s.key,
      value: s.value,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
    })
    .from(s)
    .where(or(isNull(s.effectiveTo), gt(s.effectiveTo, sql`now()`)))
    .orderBy(asc(s.key), asc(s.effectiveFrom), asc(s.id));
  return COMMERCIAL_SETTING_KEYS.map((key) => ({
    key,
    title: COMMERCIAL_SETTINGS[key].title,
    unit: COMMERCIAL_SETTINGS[key].unit,
    defaultValue: COMMERCIAL_SETTINGS[key].defaultValue,
    max: COMMERCIAL_SETTINGS[key].max,
    values: values.filter((value) => value.key === key).map(({ key: _key, ...value }) => value),
  }));
}

/**
 * A setting's value in effect now, in the caller's transaction: the value the owner recorded, or the
 * setting's default when none is in effect. A customer request reads it through the database function
 * `valo_commercial_setting`, the only way its scope may read a setting.
 */
export async function commercialSettingValue(tx: Pick<Tx, "execute">, key: CommercialSettingKey) {
  const { rows } = await tx.execute<{ value: unknown }>(
    sql`select public.valo_commercial_setting(${key}) as value`,
  );
  const value = rows[0]?.value ?? null;
  if (value === null) return COMMERCIAL_SETTINGS[key].defaultValue;
  // The table's check keeps every value a whole number, none below nought; anything else is refused.
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new ValoProblem(503, "A setting could not be read. Try again later.");
  return value;
}
