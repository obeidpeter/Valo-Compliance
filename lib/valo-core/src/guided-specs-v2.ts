import type { GuidedField, GuidedTemplateId } from "./guided";
import { guidedFieldIssue, printedCalendarDate } from "./guided-runtime-v1";
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
  /** Changes to v1's tables, each with its reason: columns the form does not ask, and fewer rows
   * than v1 allows, where the template's wording prints a block or more for each row. */
  tables?: Readonly<
    Record<
      string,
      {
        droppedColumns?: Readonly<Record<string, string>>;
        maxRows?: { rows: number; why: string };
      }
    >
  >;
  blanks?: readonly string[];
  calculated?: GuidedSpecV2["calculated"];
  keepsNothing?: GuidedSpecV2["keepsNothing"];
  derived?: GuidedSpecV2["derived"];
};
export type GuidedChangesV2 = {
  added: { id: string; why: string }[];
  /** v1's questions the form does not ask; a table's column is named `table.column`. */
  dropped: { id: string; why: string }[];
  /** v1's tables that take fewer rows in the form. */
  rows: { table: string; maxRows: number; why: string }[];
};

function fromV1(templateId: GuidedTemplateId, plan: Plan) {
  const v1 = GUIDED_SPECS_V1[templateId];
  const byId = new Map(v1.fields.map((f) => [f.id, f]));
  const fields: GuidedFieldV2[] = [];
  const changes: GuidedChangesV2 = {
    added: [],
    dropped: Object.entries(plan.dropped ?? {}).map(([id, why]) => ({ id, why })),
    rows: [],
  };
  // A form that changes none of v1's tables asks them as v1 does, by reference.
  const tables = !plan.tables
    ? v1.tables
    : v1.tables.map((table) => {
        const change = plan.tables?.[table.id];
        if (!change) return table;
        for (const [column, why] of Object.entries(change.droppedColumns ?? {})) {
          if (!table.columns.some((c) => c.id === column))
            throw Error(`V2_COLUMN_UNKNOWN:${table.id}.${column}`);
          changes.dropped.push({ id: `${table.id}.${column}`, why });
        }
        if (change.maxRows) {
          if (change.maxRows.rows < table.minRows || change.maxRows.rows >= table.maxRows)
            throw Error(`V2_ROWS_NOT_FEWER:${table.id}`);
          changes.rows.push({ table: table.id, maxRows: change.maxRows.rows, why: change.maxRows.why });
        }
        return {
          ...table,
          columns: table.columns.filter((c) => !change.droppedColumns?.[c.id]),
          maxRows: change.maxRows?.rows ?? table.maxRows,
        };
      });
  for (const id of Object.keys(plan.tables ?? {}))
    if (!v1.tables.some((t) => t.id === id)) throw Error(`V2_TABLE_UNKNOWN:${id}`);
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
    tables,
    blanks: plan.blanks ?? [],
    ...(plan.calculated ? { calculated: plan.calculated } : {}),
    ...(plan.keepsNothing ? { keepsNothing: plan.keepsNothing } : {}),
    ...(plan.derived ? { derived: plan.derived } : {}),
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
function unitOf(templateId: GuidedTemplateId, row: Readonly<Record<string, string>>, table = "items") {
  const columns = GUIDED_SPECS_V1[templateId].tables.find((t) => t.id === table)!.columns;
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

/** An optional question for one line of a template's wording that v1 does not ask for. */
const lineQuestion = (
  id: string,
  label: string,
  line: string,
  type: "text" | "long_text" | "date" = "long_text",
) => ({
  added: { id, label, type, required: false, tokens: [id] },
  why: `The template prints "${line}" and v1 asks nothing for it.`,
});

const quotation = fromV1("TPL-02", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    { v1: "validUntil", join: { tokens: ["validUntil"] } },
    { v1: "scope", join: { tokens: ["scope"] } },
    { v1: "exclusions", join: { tokens: ["exclusions"] } },
    { v1: "taxMode", join: { clause: true } },
    { v1: "taxAmountKobo", join: { tokens: ["taxAmountKobo"] } },
    { v1: "taxLabel", join: { tokens: ["taxLabel"] } },
    { v1: "taxBasis", join: { tokens: ["taxBasis"] } },
    { v1: "discountMode", join: { clause: true } },
    { v1: "discountKobo" },
    { v1: "acceptance", join: { tokens: ["acceptance"] } },
    lineQuestion(
      "customerInputs",
      "Information, material or approval needed from the customer, if any",
      "Information, material or approval needed from the customer: [ ]",
    ),
    lineQuestion(
      "assumptions",
      "Other stated assumptions or dependencies, if any",
      "Other stated assumptions or dependencies: [ ]",
    ),
    lineQuestion(
      "paymentArrangement",
      "Proposed payment arrangement, if any",
      "Proposed payment arrangement, if supplied: [ ]",
    ),
  ],
  dropped: {
    notes:
      "The quotation's wording has no place for further notes. A note the business wants on it goes in the document's own note, which prints with it.",
  },
  calculated: pricedCalculations("TPL-02"),
  keepsNothing: [
    { question: "taxMode", option: "none" },
    { question: "discountMode", option: "none" },
  ],
});

const receipt = fromV1("TPL-03", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    { v1: "paymentDate", join: { tokens: ["paymentDate"] } },
    { v1: "receivedKobo", join: { tokens: ["receivedKobo"] } },
    { v1: "paymentMethod", join: { tokens: ["paymentMethod"] } },
    { v1: "paymentReference", join: { tokens: ["paymentReference"] } },
    { v1: "purpose", join: { tokens: ["purpose"] } },
    {
      added: {
        id: "relatedReference",
        label: "Related invoice or order reference, if any",
        type: "text",
        required: false,
        tokens: ["relatedReference"],
      },
      why: 'The template prints "Related invoice or order, if any: [Reference]" and v1 asks nothing for it.',
    },
    { v1: "acknowledgement" },
    { v1: "notes", join: { tokens: ["notes"] } },
    {
      added: {
        id: "recordedBy",
        label: "Name and role of the person who recorded the payment, if any",
        type: "text",
        required: false,
        tokens: ["recordedBy"],
      },
      why: 'The template prints "Recorded by: [Actual name/role, if supplied]" and v1 asks nothing for it.',
    },
  ],
  dropped: {
    recipientAddress:
      "The receipt's wording names the payer and gives no place for the payer's address, so the form does not ask for it.",
  },
});

const purchaseOrder = fromV1("TPL-04", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    lineQuestion(
      "purchasingContact",
      "Purchasing contact: the person, phone or email the supplier should use, if any",
      "Purchasing contact: [ ]",
      "text",
    ),
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    lineQuestion(
      "relatedQuotation",
      "Related quotation reference, if any",
      "Related quotation: [If supplied]",
      "text",
    ),
    { v1: "deliveryLocation", join: { tokens: ["deliveryLocation"] } },
    lineQuestion(
      "receivingContact",
      "Receiving or service contact, if any",
      "Receiving or service contact: [ ]",
      "text",
    ),
    { v1: "deliveryDate", join: { tokens: ["deliveryDate"] } },
    lineQuestion(
      "specificationNotes",
      "Packaging, specification or scope notes, if any",
      "Packaging, specification or scope notes supplied by buyer: [ ]",
    ),
    { v1: "taxMode", join: { clause: true } },
    { v1: "taxAmountKobo", join: { tokens: ["taxAmountKobo"] } },
    { v1: "taxLabel", join: { tokens: ["taxLabel"] } },
    { v1: "taxBasis", join: { tokens: ["taxBasis"] } },
    { v1: "discountMode", join: { clause: true } },
    { v1: "discountKobo" },
    { v1: "paymentTerms", join: { tokens: ["paymentTerms"] } },
    { v1: "authority", join: { tokens: ["authority"] } },
    lineQuestion(
      "authorisationDate",
      "Date the order was authorised, if recorded",
      "Authorisation date: [ ]",
      "date",
    ),
    { v1: "supplierResponse", join: { tokens: ["supplierResponse"] } },
    lineQuestion(
      "changeNote",
      "Change from an earlier version of this order, if any",
      "Change from earlier version, if any: [ ]",
    ),
  ],
  calculated: pricedCalculations("TPL-04"),
  keepsNothing: [
    { question: "taxMode", option: "none" },
    { question: "discountMode", option: "none" },
  ],
});

const deliveryNote = fromV1("TPL-05", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "destination", join: { tokens: ["destination"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    lineQuestion(
      "relatedOrder",
      "Related order or invoice reference, if any",
      "Related order/invoice: [If supplied]",
      "text",
    ),
    { v1: "deliveryStatus", join: { tokens: ["deliveryStatus"], clause: true } },
    { v1: "dispatchDate", join: { tokens: ["dispatchDate"] } },
    { v1: "receivedDate", join: { tokens: ["receivedDate"] } },
    { v1: "partialDetails", join: { tokens: ["partialDetails"] } },
    lineQuestion(
      "batchReferences",
      "Batch or serial references, if any",
      "Batch/serial references, if supplied: [ ]",
      "text",
    ),
    lineQuestion("otherNotes", "Other delivery notes, if any", "Other delivery notes: [ ]"),
    lineQuestion(
      "handedOverBy",
      "Name and role of the person who handed the goods over, if recorded",
      "Handed over by: [Actual name/role, or not recorded]",
      "text",
    ),
    { v1: "acknowledger", join: { tokens: ["acknowledger"] } },
    { v1: "acknowledgement", join: { tokens: ["acknowledgement"] } },
    lineQuestion(
      "acknowledgementDate",
      "Date of the acknowledgement, if recorded",
      "Acknowledgement date/time: [If recorded]",
      "date",
    ),
    lineQuestion("outstandingAction", "Outstanding action, if any", "Outstanding action: [ ]"),
    lineQuestion(
      "followUp",
      "Person responsible and follow-up date, if agreed",
      "Person responsible and user-chosen follow-up date, if agreed: [ ]",
      "text",
    ),
  ],
  tables: {
    deliveryItems: {
      droppedColumns: {
        condition:
          "The delivery note records condition and differences for the delivery as a whole, as the form asks of a part delivery, and has no place for each item's condition.",
      },
    },
  },
  calculated: {
    "calc.itemUnit": (_data, row) => (row ? unitOf("TPL-05", row, "deliveryItems") : null),
  },
  keepsNothing: [
    { question: "deliveryStatus", option: "planned" },
    { question: "deliveryStatus", option: "unconfirmed" },
  ],
});

/** A column of one of v1's tables, by id. */
const columnOf = (templateId: GuidedTemplateId, table: string, column: string) =>
  GUIDED_SPECS_V1[templateId].tables.find((t) => t.id === table)?.columns.find((c) => c.id === column);

const minutes = fromV1("TPL-08", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "meetingTitle", join: { tokens: ["meetingTitle"] } },
    lineQuestion("meetingReference", "Meeting reference, if any", "Meeting reference: [ ]", "text"),
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    lineQuestion("meetingTime", "Time and timezone, if recorded", "Time and timezone: [If recorded]", "text"),
    { v1: "location", join: { tokens: ["location"] } },
    { v1: "chair", join: { tokens: ["chair"] } },
    { v1: "minuteTaker", join: { tokens: ["minuteTaker"] } },
    lineQuestion(
      "apologies",
      "Apologies, or those invited but absent, if any",
      "Apologies or invited but absent: [Separate supplied list, if any]",
    ),
    { v1: "recordStatus", join: { tokens: ["recordStatus"], clause: true } },
    { v1: "confirmation", join: { tokens: ["confirmation"] } },
    lineQuestion("unresolvedQuestions", "Unresolved questions, if any", "Unresolved questions: [ ]"),
    { v1: "nextMeeting", join: { tokens: ["nextMeeting"] } },
    lineQuestion(
      "supportingRecords",
      "Supporting-record references, if any",
      "Supporting-record references: [ ]",
      "text",
    ),
    lineQuestion(
      "circulatedTo",
      "When and to whom the minutes were circulated, if they were",
      "Circulated on/to: [Only if actually circulated]",
      "text",
    ),
    lineQuestion(
      "corrections",
      "Corrections requested or made, if any",
      "Corrections requested or made: [ ]",
    ),
    lineQuestion("versionNote", "Version or change note, if any", "Version/change note: [ ]", "text"),
  ],
  dropped: {
    meetingType:
      "The minutes' wording does not print the kind of meeting: the template is for an ordinary business meeting, and its closing note says it does not certify statutory governance procedure, quorum or approval.",
    boardAssumptions:
      "The template is for an ordinary business meeting and has no place for board governance assumptions; its closing note says it does not certify statutory governance procedure, quorum or approval.",
  },
  tables: {
    decisions: {
      maxRows: {
        rows: 20,
        why: "Each topic prints a heading, its discussion and its outcome, so the form takes up to 20 topics, which keeps the longest minutes within what a document holds.",
      },
    },
  },
  calculated: {
    "calc.attendee": (_data, row) => {
      const name = valid(columnOf("TPL-08", "attendees", "name"), row?.name);
      if (!name) return null;
      const role = valid(columnOf("TPL-08", "attendees", "role"), row?.role);
      return role ? `${name} (${role})` : name;
    },
    "calc.actionDate": (_data, row) => {
      const date = valid(columnOf("TPL-08", "actions", "dueDate"), row?.dueDate);
      // The draft's own words for an action with no date agreed.
      return date ? printedCalendarDate(date) : "not agreed";
    },
  },
  keepsNothing: [
    { question: "recordStatus", option: "draft" },
    { question: "recordStatus", option: "circulated" },
    { question: "recordStatus", option: "corrected" },
  ],
});

/** A payment reminder's answer to one of v1's questions, when given and valid. */
const reminderAnswer = (field: string, data: GuidedDataV2) =>
  valid(
    GUIDED_SPECS_V1["TPL-12"].fields.find((f) => f.id === field),
    data.values[field],
  );
/**
 * A payment reminder's confirmed allocated payments: none, or every listed one when each is given and
 * valid. Null while they are unresolved, or when a payment reference repeats: the draft counts the
 * same transaction once.
 */
function reminderPayments(data: GuidedDataV2): bigint | null {
  if (data.values.paymentsKnown === "none") return 0n;
  if (data.values.paymentsKnown !== "listed") return null;
  const rows = data.tables.payments ?? [];
  const references = new Set<string>();
  let total = 0n;
  for (const row of rows) {
    const reference = valid(columnOf("TPL-12", "payments", "reference"), row.reference);
    const amount = valid(columnOf("TPL-12", "payments", "amountKobo"), row.amountKobo);
    if (!reference || amount === null || references.has(reference.toLowerCase())) return null;
    references.add(reference.toLowerCase());
    total += BigInt(amount);
  }
  return rows.length ? total : null;
}

const reminder = fromV1("TPL-12", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    {
      added: {
        id: "invoiceReference",
        label: "Invoice reference",
        type: "text",
        required: true,
        tokens: ["invoiceReference"],
      },
      why: 'The letter names the invoice it follows up, "invoice [invoice reference]", and v1 asks for the reference only within its description of the goods or work.',
    },
    { v1: "invoiceIssueDate", join: { tokens: ["invoiceIssueDate"] } },
    { v1: "billingBasis", join: { tokens: ["billingBasis"] } },
    { v1: "invoiceDueDate", join: { tokens: ["invoiceDueDate"] } },
    { v1: "balanceDate", join: { tokens: ["balanceDate"] } },
    { v1: "invoiceAmountKobo", join: { tokens: ["invoiceAmountKobo"] } },
    { v1: "paymentsKnown" },
    {
      added: {
        id: "creditsKobo",
        label: "Confirmed credits or other agreed reductions in whole kobo, 0 when there are none",
        type: "money_kobo",
        required: true,
        tokens: ["creditsKobo"],
      },
      why: 'The letter states "confirmed credits or reductions of [currency and amount]", and its balance counts them, as the draft\'s formula does; v1 asks nothing for them.',
    },
    {
      added: {
        id: "disputeKind",
        label: "Is there a dispute or an existing payment arrangement to mention?",
        type: "select",
        required: true,
        clause: true,
        options: [
          { value: "none", label: "Neither" },
          { value: "dispute", label: "A dispute still being discussed" },
          { value: "arrangement", label: "An existing payment arrangement" },
        ],
      },
      why: "The draft gives a paragraph for a dispute and another for an existing arrangement, to be put in only where relevant; v1 asks for the facts of either in one answer but not which applies.",
    },
    { v1: "dispute", join: { tokens: ["dispute"] } },
    {
      added: {
        id: "disputedKobo",
        label: "Amount identified as disputed in whole kobo, if known",
        type: "money_kobo",
        required: false,
        tokens: ["disputedKobo"],
      },
      why: 'The dispute paragraph states "The amount currently identified as disputed is [currency and amount, if known]" and v1 asks nothing for it.',
    },
    {
      added: {
        id: "disputeQuestion",
        label: "What the customer is asked to help resolve, if anything",
        type: "text",
        required: false,
        tokens: ["disputeQuestion"],
      },
      why: 'The dispute paragraph asks "Please help us resolve [specific question]" and v1 asks nothing for it.',
    },
    { v1: "replyContact", join: { tokens: ["replyContact"] } },
    { v1: "paymentInstructions", join: { tokens: ["paymentInstructions"] } },
    {
      added: {
        id: "senderName",
        label: "Name of the person sending the letter",
        type: "text",
        required: true,
        tokens: ["senderName"],
      },
      why: "The letter is signed with the sender's name, and v1 asks nothing for it.",
    },
    lineQuestion("senderRole", "The sender's role, if any", "[Role, if supplied]", "text"),
  ],
  dropped: {
    documentNumber:
      "The letter has no reference of its own: it names the invoice it follows up, which the form asks for.",
  },
  calculated: {
    "calc.payments": (data) => {
      const payments = reminderPayments(data);
      return payments === null ? null : formatKobo(payments);
    },
    "calc.balance": (data) => {
      const invoice = reminderAnswer("invoiceAmountKobo", data);
      const payments = reminderPayments(data);
      const credits = valid(
        reminder.spec.fields.find((f) => f.id === "creditsKobo"),
        data.values.creditsKobo,
      );
      if (invoice === null || payments === null || credits === null) return null;
      const balance = BigInt(invoice) - payments - BigInt(credits);
      // A reminder states an amount still owed. At zero or less the draft offers an account statement,
      // or a possible excess payment to reconcile, instead: no balance prints, and the letter is not
      // complete.
      return balance > 0n ? formatKobo(balance) : null;
    },
  },
  derived: {
    // The draft compares the established due date with the letter's own date.
    timing: {
      options: ["passed", "today", "ahead"],
      of: (data) => {
        const due = reminderAnswer("invoiceDueDate", data),
          letter = reminderAnswer("issueDate", data);
        if (!due || !letter) return null;
        return due < letter ? "passed" : due === letter ? "today" : "ahead";
      },
    },
  },
  keepsNothing: [{ question: "disputeKind", option: "none" }],
});

/**
 * The offer letter (TPL-17), a premium form. The employer's name and address head the letter as the
 * draft's one placeholder for them, and the candidate's print above the greeting; the proposed terms
 * print one to a line, since each can be longer than a table cell holds.
 */
const offerLetter = fromV1("TPL-17", {
  questions: [
    { v1: "issuerName", join: { tokens: ["employer", "issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["employer"] } },
    { v1: "recipientName", join: { tokens: ["candidate", "recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["candidate"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    { v1: "issueDate", join: { tokens: ["issueDate"] } },
    { v1: "role", join: { tokens: ["role"] } },
    { v1: "reportsTo", join: { tokens: ["reportsTo"] } },
    { v1: "duties", join: { tokens: ["duties"] } },
    { v1: "workplace", join: { tokens: ["workplace"] } },
    { v1: "startDate", join: { tokens: ["startDate"] } },
    { v1: "termType", join: { clause: true } },
    { v1: "endDate", join: { tokens: ["endDate"] } },
    { v1: "terminationTerms", join: { tokens: ["terminationTerms"] } },
    { v1: "grossPayKobo", join: { tokens: ["grossPayKobo"] } },
    { v1: "payPeriod", join: { tokens: ["payPeriod"] } },
    { v1: "payBasis", join: { tokens: ["payBasis"] } },
    {
      added: {
        id: "allowances",
        label: "Additional allowances or variable pay, or none offered",
        type: "long_text",
        required: true,
        tokens: ["allowances"],
      },
      why: 'The letter prints "Additional allowances or variable pay: [Specific terms or none offered]" and v1 asks nothing for it.',
    },
    { v1: "hours", join: { tokens: ["hours"] } },
    { v1: "leaveTerms", join: { tokens: ["leaveTerms"] } },
    { v1: "benefits", join: { tokens: ["benefits"] } },
    { v1: "probation", join: { clause: true } },
    { v1: "probationTerms", join: { tokens: ["probationTerms"] } },
    { v1: "contractReference", join: { tokens: ["contractReference"] } },
    { v1: "conditions", join: { clause: true } },
    { v1: "conditionDetails", join: { tokens: ["conditionDetails"] } },
    { v1: "responseDate", join: { tokens: ["responseDate"] } },
    { v1: "responseMethod", join: { tokens: ["responseMethod"] } },
    { v1: "representative", join: { tokens: ["representative"] } },
    {
      added: {
        id: "firstDayContact",
        label: "Proposed first-day contact",
        type: "text",
        required: true,
        tokens: ["firstDayContact"],
      },
      why: 'The letter prints "Your proposed first-day contact is [ ]" and v1 asks nothing for it.',
    },
    {
      added: {
        id: "joiningArrangements",
        label: "Practical joining arrangements",
        type: "long_text",
        required: true,
        tokens: ["joiningArrangements"],
      },
      why: 'The letter prints "the practical joining arrangements are [ ]" and v1 asks nothing for it.',
    },
    { v1: "responseStatus", join: { tokens: ["responseStatus"] } },
  ],
  dropped: {
    policies:
      "The letter names the employment contract and schedules it is accompanied by, which v1 asks as the contract reference; the policies the contract incorporates are listed in the contract itself.",
    legalChecks:
      "The letter has no place for the business's own check of the legal scope and of mandatory terms still unresolved: it asks the candidate to say if anything is missing or inconsistent, and the employment contract it is accompanied by holds the terms.",
  },
  // Completed by hand once the candidate responds, as the draft's heading says.
  blanks: ["responseReference", "outstandingMatter", "startConfirmed"],
});

/**
 * The employment contract (TPL-16), a premium form. Each answer prints once, in the clause that names
 * it; Schedule A keeps the terms the clauses send to it (the leave and the notice), and Schedule B the
 * documents incorporated. One contact answers the employee's pay, absence, leave and equipment
 * questions, where the draft names a contact for each.
 */
const employmentContract = fromV1("TPL-16", {
  questions: [
    { v1: "issuerName", join: { tokens: ["issuerName"] } },
    { v1: "issuerAddress", join: { tokens: ["issuerAddress"] } },
    { v1: "recipientName", join: { tokens: ["recipientName"] } },
    { v1: "recipientAddress", join: { tokens: ["recipientAddress"] } },
    { v1: "documentNumber", join: { tokens: ["documentNumber"] } },
    lineQuestion("contractVersion", "Contract version, if any", "Version: [ ]", "text"),
    // The place before the date: Schedule A prints them in that order.
    {
      added: {
        id: "engagementPlace",
        label: "Place where the employment is engaged: town and State or FCT",
        type: "text",
        required: true,
        tokens: ["engagement"],
      },
      why: 'Schedule A prints "Engagement place/date: [ ]", which the agreement says identifies its Nigerian employment context, and v1 asks for no place.',
    },
    { v1: "issueDate", join: { tokens: ["issueDate", "engagement"] } },
    { v1: "role", join: { tokens: ["role"] } },
    { v1: "reportsTo", join: { tokens: ["reportsTo"] } },
    { v1: "duties", join: { tokens: ["duties"] } },
    { v1: "workplace", join: { tokens: ["workplace"] } },
    lineQuestion(
      "qualifications",
      "Required qualifications or permissions for the role, and their status, if any",
      "Required qualifications or permissions for the role are [verified requirements and status]",
    ),
    { v1: "startDate", join: { tokens: ["startDate"] } },
    {
      added: {
        id: "earlierService",
        label: "Recognised earlier continuous service, or none confirmed",
        type: "text",
        required: true,
        tokens: ["earlierService"],
      },
      why: 'The contract prints "Recognised earlier continuous service, if any, is [date/basis or none confirmed]" and v1 asks nothing for it.',
    },
    { v1: "termType", join: { clause: true } },
    { v1: "endDate", join: { tokens: ["endDate"] } },
    { v1: "probation", join: { clause: true } },
    { v1: "probationTerms", join: { tokens: ["probationTerms"] } },
    { v1: "grossPayKobo", join: { tokens: ["grossPayKobo"] } },
    { v1: "payPeriod", join: { tokens: ["payPeriod"] } },
    { v1: "payBasis", join: { tokens: ["payBasis"] } },
    {
      added: {
        id: "allowances",
        label: "Additional allowances or variable pay, or none offered",
        type: "long_text",
        required: true,
        tokens: ["allowances"],
      },
      why: 'The contract prints "Separately identified allowances or variable pay are listed in Schedule A", Schedule A asks for them, and v1 asks nothing for them. The offer letter asks the same question.',
    },
    { v1: "hours", join: { tokens: ["hours"] } },
    {
      added: {
        id: "workContact",
        label: "Contact for the employee's pay, absence, leave and equipment questions",
        type: "text",
        required: true,
        tokens: ["workContact"],
      },
      why: "The contract names a contact for payroll queries, for absence, for leave and benefit questions and for reporting a loss of equipment or information, and v1 asks for none.",
    },
    { v1: "leaveTerms", join: { tokens: ["leaveTerms"] } },
    { v1: "benefits", join: { tokens: ["benefits"] } },
    { v1: "confidentialityTerms", join: { tokens: ["confidentialityTerms"] } },
    { v1: "grievanceTerms", join: { tokens: ["grievanceTerms"] } },
    { v1: "terminationTerms", join: { tokens: ["terminationTerms"] } },
    lineQuestion(
      "specialConditions",
      "Special conditions individually agreed and separately checked, if any",
      "Special conditions individually agreed and separately checked: [ ]",
    ),
    { v1: "policies", join: { tokens: ["policies"] } },
    { v1: "termsReviewed" },
  ],
  dropped: {
    legalChecks:
      "The contract has no place for the business's own check of the legal scope and of mandatory terms still unresolved. Its Nigerian employment context is the place of engagement in Schedule A, and the confirmation that no material term is knowingly left unresolved is still asked.",
  },
  // Completed by hand once the parties agree and sign, as the agreement record says.
  blanks: ["representativeAuthority", "signatureRecord", "copyProvided"],
  keepsNothing: [{ question: "probation", option: "no" }],
});

/** The v2 forms, by template. A template without one stays on its v1 form. */
export const GUIDED_SPECS_V2: Readonly<Partial<Record<GuidedTemplateId, GuidedSpecV2>>> = {
  "TPL-01": invoice.spec,
  "TPL-02": quotation.spec,
  "TPL-03": receipt.spec,
  "TPL-04": purchaseOrder.spec,
  "TPL-05": deliveryNote.spec,
  "TPL-08": minutes.spec,
  "TPL-12": reminder.spec,
  "TPL-16": employmentContract.spec,
  "TPL-17": offerLetter.spec,
};
/** What each v2 form adds to and leaves out of its v1 questions, with the reasons. */
export const GUIDED_CHANGES_V2: Readonly<Partial<Record<GuidedTemplateId, GuidedChangesV2>>> = {
  "TPL-01": invoice.changes,
  "TPL-02": quotation.changes,
  "TPL-03": receipt.changes,
  "TPL-04": purchaseOrder.changes,
  "TPL-05": deliveryNote.changes,
  "TPL-08": minutes.changes,
  "TPL-12": reminder.changes,
  "TPL-16": employmentContract.changes,
  "TPL-17": offerLetter.changes,
};
