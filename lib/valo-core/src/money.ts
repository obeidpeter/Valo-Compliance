/** Pure, browser-safe integer arithmetic shared by guided inputs and server validation. */
export type FinancialInput = {
  kind: "invoice" | "quotation" | "payment_reminder" | "business_proposal";
  lines: { description: string; quantity: string; unitPriceKobo: string; currency?: string }[];
  taxAmountKobo: string | null;
  taxLabel: string;
  discountKobo: string | null;
  amountDueKobo: string | null;
  deliveryKobo?: string;
  discountPercent?: string;
  taxPercent?: string;
  taxBaseKobo?: string;
  currency?: string;
  requestedTotalKobo?: string;
  disputedKobo?: string;
  optionalLines?: {
    description: string;
    quantity: string;
    unitPriceKobo: string;
    selected: boolean;
    currency?: string;
  }[];
  paymentRecord?: {
    invoiceAmountKobo: string;
    payments: { reference: string; amountKobo: string }[];
    duplicatesConfirmed?: boolean;
  };
};
/**
 * A value as parsed input gives it: an absent optional property may also be present as undefined,
 * as Zod's optional fields are. Functions take this for what they read; the types they return stay
 * exact, so a document they build matches the API contract.
 */
export type Parsed<T> = T extends readonly (infer U)[]
  ? Parsed<U>[]
  : T extends object
    ? { [K in keyof T]: Parsed<T[K]> | ({} extends Pick<T, K> ? undefined : never) }
    : T;
export type FinancialBlock = { id: string; type: "table"; text: string; rows: string[][] };
function amount(s: string) {
  if (!/^[0-9]{1,24}$/.test(s)) throw Error("INVALID_INTEGER_KOBO");
  return BigInt(s);
}
/** User-entered records only; this neither verifies payments nor authorises refunds. */
export function recordedBalance(record: NonNullable<Parsed<FinancialInput>["paymentRecord"]>) {
  if (record.payments.length > 40) throw Error("TOO_MANY_PAYMENT_RECORDS");
  const invoice = amount(record.invoiceAmountKobo),
    references = new Map<string, string>();
  let paid = 0n;
  let duplicatesReconciled = 0;
  for (const payment of record.payments) {
    const reference = payment.reference.trim().toLowerCase();
    if (!reference || reference.length > 80) throw Error("PAYMENT_REFERENCE_REQUIRED");
    const value = amount(payment.amountKobo);
    if (references.has(reference)) {
      if (record.duplicatesConfirmed !== true || references.get(reference) !== value.toString())
        throw Error("DUPLICATE_PAYMENT_REFERENCE");
      duplicatesReconciled++;
      continue;
    }
    references.set(reference, value.toString());
    paid += value;
  }
  const net = invoice - paid;
  return {
    invoiceKobo: invoice.toString(),
    recordedPaymentsKobo: paid.toString(),
    netRecordedBalanceKobo: net.toString(),
    amountDueKobo: (net > 0n ? net : 0n).toString(),
    excessToReconcileKobo: (net < 0n ? -net : 0n).toString(),
    duplicatesReconciled,
  };
}
/** User-specified arithmetic only. This does not select a statutory rate. */
export function percentageKobo(base: string, percent: string) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(percent)) throw Error("INVALID_PERCENTAGE");
  const [w, f = ""] = percent.split("."),
    n = BigInt(w + f),
    d = 100n * 10n ** BigInt(f.length);
  if (n > 100n * 10n ** BigInt(f.length)) throw Error("PERCENTAGE_EXCEEDS_100");
  return ((amount(base) * n + d / 2n) / d).toString();
}
export function formatKobo(kobo: string | bigint) {
  const n = typeof kobo === "bigint" ? kobo : amount(kobo);
  if (n < 0n) throw Error("NEGATIVE_MONEY");
  return `₦${(n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(n % 100n).toString().padStart(2, "0")}`;
}
export function lineTotal(quantity: string, unitPriceKobo: string) {
  if (!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$/.test(quantity)) throw Error("INVALID_QUANTITY");
  const [whole, fraction = ""] = quantity.split("."),
    numerator = BigInt(whole + fraction),
    denominator = 10n ** BigInt(fraction.length);
  if (numerator <= 0n) throw Error("QUANTITY_MUST_BE_POSITIVE");
  // Each positive line is rounded half-up to the nearest kobo, once.
  return (amount(unitPriceKobo) * numerator + denominator / 2n) / denominator;
}
export function financialBlocks(input: Parsed<FinancialInput>): FinancialBlock[] {
  if (
    (input.currency ?? "NGN") !== "NGN" ||
    [...input.lines, ...(input.optionalLines ?? [])].some(
      (l) => (l.currency ?? input.currency ?? "NGN") !== "NGN",
    )
  )
    throw Error("CURRENCY_RECONCILIATION_REQUIRED");
  if (input.disputedKobo !== undefined && input.kind !== "payment_reminder")
    throw Error("DISPUTE_REQUIRES_REMINDER");
  if (input.paymentRecord && input.kind !== "payment_reminder")
    throw Error("PAYMENT_RECORD_REQUIRES_REMINDER");
  if (input.kind === "payment_reminder") {
    if (input.paymentRecord) {
      const balance = recordedBalance(input.paymentRecord);
      if (input.amountDueKobo === null || amount(input.amountDueKobo) !== BigInt(balance.amountDueKobo))
        throw Error("OUTSTANDING_BALANCE_MISMATCH");
      const rows = [
        ["Description", "Amount"],
        ["Original invoice amount recorded", formatKobo(balance.invoiceKobo)],
        ...input.paymentRecord.payments.map((p) => [
          `Payment recorded: ${p.reference} (not verified)`,
          formatKobo(p.amountKobo),
        ]),
        ["Total payments recorded (not verified)", formatKobo(BigInt(balance.recordedPaymentsKobo))],
      ];
      if (balance.duplicatesReconciled)
        rows.push(["Confirmed copied payment entries counted once", String(balance.duplicatesReconciled)]);
      if (input.disputedKobo !== undefined) {
        const disputed = amount(input.disputedKobo),
          due = BigInt(balance.amountDueKobo);
        if (disputed > due) throw Error("DISPUTE_EXCEEDS_RECORDED_BALANCE");
        rows.push(
          ["Disputed portion — reconcile, not waived", formatKobo(disputed)],
          ["Recorded balance excluding disputed portion", formatKobo(due - disputed)],
        );
      }
      if (balance.excessToReconcileKobo !== "0")
        rows.push([
          "Excess recorded — reconcile; no refund authorised",
          formatKobo(BigInt(balance.excessToReconcileKobo)),
        ]);
      rows.push(["Amount recorded due", formatKobo(balance.amountDueKobo)]);
      return [
        {
          id: "financial-summary-v1",
          type: "table",
          text: "Calculated solely from your records. Confirm discrepancies with the customer; this is not verified payment evidence.",
          rows,
        },
      ];
    }
    if (input.amountDueKobo === null) return [];
    return [
      {
        id: "financial-summary-v1",
        type: "table",
        text: "User-recorded outstanding amount, not verified payment evidence",
        rows: [
          ["Description", "Amount"],
          ["Amount recorded due", formatKobo(input.amountDueKobo)],
        ],
      },
    ];
  }
  if (input.lines.length === 0) {
    if (input.kind === "business_proposal" && input.amountDueKobo !== null)
      return [
        {
          id: "financial-summary-v1",
          type: "table",
          text: "Proposed budget supplied by the business",
          rows: [
            ["Description", "Amount"],
            ["Proposed budget", formatKobo(input.amountDueKobo)],
          ],
        },
      ];
    return [];
  }
  let subtotal = 0n;
  const selected = [...input.lines, ...(input.optionalLines ?? []).filter((l) => l.selected)];
  const rows = [
    ["Description", "Quantity", "Unit price", "Line total"],
    ...selected.map((line) => {
      const total = lineTotal(line.quantity, line.unitPriceKobo);
      subtotal += total;
      return [line.description, line.quantity, formatKobo(line.unitPriceKobo), formatKobo(total)];
    }),
  ];
  const percentageDiscount =
    input.discountPercent === undefined ? null : percentageKobo(subtotal.toString(), input.discountPercent);
  if (
    percentageDiscount !== null &&
    input.discountKobo !== null &&
    amount(percentageDiscount) !== amount(input.discountKobo)
  )
    throw Error("CONFLICTING_DISCOUNT_INPUTS");
  const discount =
    percentageDiscount !== null
      ? amount(percentageDiscount)
      : input.discountKobo === null
        ? 0n
        : amount(input.discountKobo);
  if (input.taxPercent !== undefined && input.taxBaseKobo === undefined)
    throw Error("USER_TAX_BASE_REQUIRED");
  const percentageTax =
    input.taxPercent === undefined ? null : percentageKobo(input.taxBaseKobo!, input.taxPercent);
  if (
    percentageTax !== null &&
    input.taxAmountKobo !== null &&
    amount(percentageTax) !== amount(input.taxAmountKobo)
  )
    throw Error("CONFLICTING_TAX_INPUTS");
  const tax =
    percentageTax !== null
      ? amount(percentageTax)
      : input.taxAmountKobo === null
        ? 0n
        : amount(input.taxAmountKobo);
  const delivery = input.deliveryKobo === undefined ? 0n : amount(input.deliveryKobo);
  if (discount > subtotal) throw Error("DISCOUNT_EXCEEDS_SUBTOTAL");
  const summary = [
    ["Description", "Amount"],
    ["Subtotal", formatKobo(subtotal)],
  ];
  if (input.discountKobo !== null || percentageDiscount !== null)
    summary.push(["Discount supplied by issuer", formatKobo(discount)]);
  if (input.deliveryKobo !== undefined) summary.push(["Delivery supplied by issuer", formatKobo(delivery)]);
  if (input.taxAmountKobo !== null || percentageTax !== null)
    summary.push([input.taxLabel.trim() || "Additional amount supplied by issuer", formatKobo(tax)]);
  const total = subtotal - discount + tax + delivery;
  if (input.requestedTotalKobo !== undefined && amount(input.requestedTotalKobo) !== total)
    throw Error("UNEXPLAINED_TOTAL_MISMATCH");
  summary.push(["Draft total from supplied amounts", formatKobo(total)]);
  for (const extra of (input.optionalLines ?? []).filter((l) => !l.selected))
    summary.push([
      `Optional, not selected: ${extra.description}`,
      formatKobo(lineTotal(extra.quantity, extra.unitPriceKobo)),
    ]);
  return [
    {
      id: "financial-items-v1",
      type: "table",
      text: "Supplied line items; each line rounded half-up to one kobo",
      rows,
    },
    {
      id: "financial-summary-v1",
      type: "table",
      text: "No statutory tax rate or exemption has been determined",
      rows: summary,
    },
  ];
}
export function synchronizeFinancialBlocks<
  T extends {
    financialInput?: Parsed<FinancialInput> | undefined;
    blocks: { id: string; type: string; text: string; rows: string[][] }[];
  },
>(content: T): T {
  if (!content.financialInput) return content;
  return {
    ...content,
    blocks: [
      ...content.blocks.filter((b) => !["financial-items-v1", "financial-summary-v1"].includes(b.id)),
      ...financialBlocks(content.financialInput),
    ],
  };
}
