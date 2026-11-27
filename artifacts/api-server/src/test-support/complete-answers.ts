import type { GuidedField } from "@workspace/valo-core/guided";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";

/**
 * Synthetic answers that complete a form, for tests of what a complete document is
 * (docs/architecture/finished-file.md).
 */
/** A valid answer to a question, of its type: a listed option that is a real fact, not "unknown". */
export const validAnswer = (field: GuidedField) =>
  field.type === "date"
    ? "2026-11-24"
    : field.type === "integer" || field.type === "quantity"
      ? "2"
      : field.type === "money_kobo"
        ? "150000"
        : field.type === "select"
          ? field.options!.find((option) => !/^(unknown|unanswered|not_applicable)$/i.test(option.value))!
              .value
          : field.type === "acknowledgement"
            ? "yes"
            : "Synthetic answer";

/** Every question of a form answered validly, and each table given its rows. */
export function everyAnswer<
  T extends { values: Record<string, string>; tables: Record<string, Record<string, string>[]> },
>(
  data: T,
  spec: {
    fields: readonly GuidedField[];
    tables: readonly { id: string; minRows: number; columns: readonly GuidedField[] }[];
  },
): T {
  return {
    ...data,
    values: Object.fromEntries(spec.fields.map((field) => [field.id, validAnswer(field)])),
    tables: Object.fromEntries(
      spec.tables.map((table) => [
        table.id,
        Array.from({ length: Math.max(table.minRows, 1) }, () =>
          Object.fromEntries(table.columns.map((column) => [column.id, validAnswer(column)])),
        ),
      ]),
    ),
  };
}

/** A payment reminder's balance prints only while something is still owed: here ₦5,000 less a payment
 * of ₦1,000, and no credit. Its letter is incomplete otherwise, which the answers above would make it. */
export const owing = (data: GuidedDataV2): GuidedDataV2 =>
  data.templateId !== "TPL-12"
    ? data
    : {
        ...data,
        values: { ...data.values, invoiceAmountKobo: "500000", creditsKobo: "0", disputedKobo: "0" },
        tables: { ...data.tables, payments: [{ reference: "SYN-PAY-1", amountKobo: "100000" }] },
      };
