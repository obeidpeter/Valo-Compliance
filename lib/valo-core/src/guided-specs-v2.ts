import type { GuidedField, GuidedTemplateId } from "./guided";
import { guidedFieldIssue } from "./guided-runtime-v1";
import { GUIDED_SPECS_V1 } from "./guided-specs-v1";
import type { GuidedDataV2, GuidedFieldV2, GuidedSpecV2 } from "./guided-v2";
import { formatKobo, lineTotal } from "./money";

/**
 * The v2 forms (docs/architecture/forms-v2.md): each fills the form text of a released edition of its
 * template. Every question v2 keeps is v1's (`GUIDED_SPECS_V1`), taken by reference with its label,
 * help, options, type, requirement and condition unchanged; v2 adds only what joins it to the text.
 * A question v1 has and v2 does not ask is listed with its reason, and a new question with the slot
 * it serves, so the owner can review both (owner's point 1 in the design note).
 */
type Join = Pick<GuidedFieldV2, "tokens" | "clause" | "example">;
type Plan = {
  /** The questions in the order the form asks them: v1's by id, with what joins each to the text,
   * and new ones with the reason v1 has none. */
  questions: readonly ({ v1: string; join?: Join } | { added: GuidedFieldV2; why: string })[];
  /** v1's questions the form does not ask, each with its reason. */
  dropped?: Readonly<Record<string, string>>;
  blanks?: readonly string[];
  calculated?: GuidedSpecV2["calculated"];
  keepsNothing?: GuidedSpecV2["keepsNothing"];
};
export type GuidedChangesV2 = {
  added: { id: string; why: string }[];
  dropped: { id: string; why: string }[];
};

function fromV1(templateId: GuidedTemplateId, plan: Plan) {
  const v1 = GUIDED_SPECS_V1[templateId];
  const byId = new Map(v1.fields.map((f) => [f.id, f]));
  const fields: GuidedFieldV2[] = [];
  const changes: GuidedChangesV2 = {
    added: [],
    dropped: Object.entries(plan.dropped ?? {}).map(([id, why]) => ({ id, why })),
  };
  for (const question of plan.questions) {
    if ("added" in question) {
      if (byId.has(question.added.id)) throw Error(`V2_QUESTION_IS_V1:${question.added.id}`);
      fields.push(question.added);
      changes.added.push({ id: question.added.id, why: question.why });
      continue;
    }
    const field = byId.get(question.v1);
    if (!field || fields.some((f) => f.id === question.v1)) throw Error(`V2_QUESTION_UNKNOWN:${question.v1}`);
    fields.push({ ...field, ...question.join });
  }
  for (const field of v1.fields)
    if (!fields.some((f) => f.id === field.id) && !plan.dropped?.[field.id])
      throw Error(`V2_QUESTION_NEITHER_KEPT_NOR_DROPPED:${field.id}`);
  const spec: GuidedSpecV2 = {
    schemaVersion: 2,
    templateId,
    title: v1.title,
    fields,
    tables: v1.tables,
    blanks: plan.blanks ?? [],
    ...(plan.calculated ? { calculated: plan.calculated } : {}),
    ...(plan.keepsNothing ? { keepsNothing: plan.keepsNothing } : {}),
    ...(v1.dateOrder ? { dateOrder: v1.dateOrder } : {}),
  };
  return { spec, changes };
}

/** An answer given and valid by v1's own check, or null. */
const valid = (field: GuidedField | undefined, value: string | undefined) => {
  const answer = (value ?? "").trim();
  return field && answer && guidedFieldIssue(field, answer) === null ? answer : null;
};

/** The item lines of an invoice-like form, worked out only when every visible answer they need is
 * given and valid, with v1's arithmetic (`lineTotal`: each line rounded half-up to one kobo). */
function itemLines(templateId: GuidedTemplateId, data: GuidedDataV2) {
  const columns = GUIDED_SPECS_V1[templateId].tables.find((t) => t.id === "items")!.columns;
  const column = (id: string) => columns.find((c) => c.id === id);
  const rows = data.tables.items ?? [];
  if (!rows.length) return null;
  const lines: bigint[] = [];
  for (const row of rows) {
    const quantity = valid(column("quantity"), row.quantity),
      price = valid(column("unitPriceKobo"), row.unitPriceKobo);
    if (!quantity || !price || !valid(column("description"), row.description) || !unitOf(templateId, row))
      return null;
    lines.push(lineTotal(quantity, price));
  }
  return lines;
}
function unitOf(templateId: GuidedTemplateId, row: Readonly<Record<string, string>>) {
  const columns = GUIDED_SPECS_V1[templateId].tables.find((t) => t.id === "items")!.columns;
  const unit = columns.find((c) => c.id === "unit")!;
  const chosen = valid(unit, row.unit);
  if (!chosen) return null;
  if (chosen === "other")
    return valid(
      columns.find((c) => c.id === "otherUnit"),
      row.otherUnit,
    );
  return unit.options!.find((o) => o.value === chosen)!.label;
}
/** The amounts of an invoice-like form's summary, with v1's rules: a discount or tax amount only as
 * supplied, a discount never above the subtotal, and nothing while a choice is unanswered. */
function summary(templateId: GuidedTemplateId, data: GuidedDataV2) {
  const fields = GUIDED_SPECS_V1[templateId].fields;
  const field = (id: string) => fields.find((f) => f.id === id);
  const lines = itemLines(templateId, data);
  if (!lines) return null;
  const subtotal = lines.reduce((sum, line) => sum + line, 0n);
  const v = data.values;
  if (!["none", "supplied"].includes(v.discountMode ?? "") || !["none", "supplied"].includes(v.taxMode ?? ""))
    return { subtotal, total: null };
  const discount = v.discountMode === "supplied" ? valid(field("discountKobo"), v.discountKobo) : "0";
  const tax = v.taxMode === "supplied" ? valid(field("taxAmountKobo"), v.taxAmountKobo) : "0";
  if (discount === null || tax === null || BigInt(discount) > subtotal) return { subtotal, total: null };
  return { subtotal, total: subtotal - BigInt(discount) + BigInt(tax) };
}

/**
 * The amounts an invoice-like form works out, each from its own answers: its currency, each item
 * line's unit and amount, the subtotal, the discount as a deduction and the total. Every amount the
 * form takes is in kobo, printed in naira (`formatKobo`).
 */
function pricedCalculations(templateId: GuidedTemplateId): NonNullable<GuidedSpecV2["calculated"]> {
  return {
    "calc.currency": () => "NGN",
    "calc.unit": (_data, row) => (row ? unitOf(templateId, row) : null),
    "calc.lineAmount": (_data, row) => {
      const columns = GUIDED_SPECS_V1[templateId].tables.find((t) => t.id === "items")!.columns;
      const quantity = valid(
          columns.find((c) => c.id === "quantity"),
          row?.quantity,
        ),
        price = valid(
          columns.find((c) => c.id === "unitPriceKobo"),
          row?.unitPriceKobo,
        );
      return quantity && price ? formatKobo(lineTotal(quantity, price)) : null;
    },
    "calc.subtotal": (data) => {
      const amounts = summary(templateId, data);
      return amounts ? formatKobo(amounts.subtotal) : null;
    },
    "calc.discount": (data) => {
      const discount = valid(
        GUIDED_SPECS_V1[templateId].fields.find((f) => f.id === "discountKobo"),
        data.values.discountKobo,
      );
      return data.values.discountMode === "supplied" && discount ? `−${formatKobo(discount)}` : null;
    },
    "calc.total": (data) => {
      const total = summary(templateId, data)?.total;
      return total == null ? null : formatKobo(total);
    },
  };
}

const invoice = fromV1("TPL-01", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    {
      added: {
        id: "relatedReference",
        label: "Related order, quotation or project reference, if any",
        type: "text",
        required: false,
        tokens: ["relatedReference"],
      },
      why: 'The template prints "Related order, quotation or project: [Reference, if supplied]" and v1 asks nothing for it.',
    },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    { v1: "dueDate", join: { tokens: ["dueDate"] } },
    { v1: "billingBasis", join: { tokens: ["billingBasis"] } },
    { v1: "taxMode", join: { clause: true } },
    { v1: "taxAmountKobo", join: { tokens: ["taxAmountKobo"] } },
    { v1: "taxLabel", join: { tokens: ["taxLabel"] } },
    { v1: "taxBasis", join: { tokens: ["taxBasis"] } },
    { v1: "discountMode", join: { clause: true } },
    { v1: "discountKobo" },
    { v1: "paymentInstructions", join: { tokens: ["paymentInstructions"] } },
    { v1: "notes", join: { tokens: ["notes"] } },
  ],
  calculated: pricedCalculations("TPL-01"),
  keepsNothing: [
    { question: "taxMode", option: "none" },
    { question: "discountMode", option: "none" },
  ],
});

/** The v2 forms, by template. A template without one stays on its v1 form. */
export const GUIDED_SPECS_V2: Readonly<Partial<Record<GuidedTemplateId, GuidedSpecV2>>> = {
  "TPL-01": invoice.spec,
};
/** What each v2 form adds to and leaves out of its v1 questions, with the reasons. */
export const GUIDED_CHANGES_V2: Readonly<Partial<Record<GuidedTemplateId, GuidedChangesV2>>> = {
  "TPL-01": invoice.changes,
};
