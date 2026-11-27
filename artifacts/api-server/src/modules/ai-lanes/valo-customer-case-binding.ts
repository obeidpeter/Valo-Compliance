import {
  hashAI,
  customerAIInput,
  missingCustomerFields,
  unsupportedCustomerInput,
} from "./valo-customer-ai-domain";
import {
  financialBlocks,
  lineTotal,
  percentageKobo,
  recordedBalance,
  type FinancialInput,
} from "@workspace/valo-core/money";
export type AuthoredCustomerCase = {
  caseID: string;
  task: string;
  category: string;
  userInput: string;
  suppliedFacts: Record<string, unknown>;
  expectedNumeric?: Record<string, string>;
};
type Line = {
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  currency?: string;
  unit?: string;
};
export function nairaKobo(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error("SOURCE_AMOUNT_NOT_DECIMAL_MONEY");
  const [w, f = ""] = value.split(".");
  return (BigInt(w!) * 100n + BigInt(f.padEnd(2, "0"))).toString();
}
export const customerFollowupVersion = "synthetic-customer-followup-v1";
/**
 * The facts of a case the app has no field for, given to it as a customer would give them
 * (docs/architecture/drafting-rubric.md). The corpus's execution requirements ask for each such fixture
 * change to be recorded: until v2 the binding left these out, or held the case on them.
 */
export const customerFixtureChanges = [
  "A line's unit goes in its description, as `Demo fabric (per metre)`.",
  "A brief's unit price, a customer's statement that they paid, a requested recipient, a customer's budget ceiling, a prospect's email address and a contingency percentage go in the customer's notes.",
  "A scope with no approved change, and a payment that is not authorised, are said in the customer's notes.",
] as const;
/** Follow-ups are supplied explicitly by the evaluator, never inferred user facts.
 * The original input/hash and preflight remain independent evidence. */
export function bindCustomerCase(c: AuthoredCustomerCase, followup: Record<string, string> = {}) {
  const f = c.suppliedFacts,
    p = f.parties as { business: string | null; customer: string | null } | undefined;
  const task =
    (
      { "payment-reminder": "payment_reminder", "business-proposal": "business_proposal" } as Record<
        string,
        string
      >
    )[c.task] ?? c.task;
  const issues: string[] = [],
    mapped = new Set<string>([
      "parties",
      "currency",
      "reference",
      "invoiceReference",
      "issueDate",
      "asOfDate",
      "dueDate",
      "lines",
      "baseLines",
      "optionalLines",
      "optionalSelected",
      "discountAmount",
      "deliveryAmount",
      "discountPercent",
      "tax",
      "taxTreatment",
      "invoiceAmount",
      "recordedPayments",
      "duplicateExplanation",
      "disputedAmount",
      "disputeReason",
      "requestedTotal",
      "authorisedAdjustment",
      "purpose",
      "deliverables",
      "timeline",
      "customerInputs",
      "phases",
      "baseBudget",
      "contingencyPercent",
      "contingencyApprovedForSpending",
      "packagePrice",
      "customerBudgetCeiling",
      "approvedDiscount",
      "scopeChangesApproved",
      "price",
      "newDraftInputs",
      "briefUnitPrice",
      "prospectEmail",
      "paymentAuthorisation",
    ]);
  const excludedFacts: string[] = [];
  // Harness-selected workspace/revision identities are checked by the native
  // evaluation journey. They are never extra document context for the model.
  for (const key of ["selectedWorkspace", "existingSavedRevision"])
    if (typeof f[key] === "string") {
      mapped.add(key);
      excludedFacts.push(key);
    }
  // Null/empty evidence is intentionally represented as uncertainty, not invented.
  const uncertainties: Record<string, string> = {
    deliveryDate: "Delivery date unconfirmed.",
    offerExpiry: "Offer expiry unspecified.",
    deliveryCommitment: "No delivery commitment supplied.",
    warranty: "No warranty supplied.",
    agreedInterestRate: "No agreed interest rate supplied.",
    releasedLegalSource: "No released legal basis supplied.",
    legalBasis: "No legal basis supplied.",
    startDate: "Start date not agreed.",
    customerInputDate: "Customer input date not agreed.",
    completionCommitment: "No completion commitment supplied.",
    experienceYears: "No years of experience supplied.",
    releasedComplianceEvidence: "No released compliance evidence supplied.",
    externalEvidenceProvided: "External evidence has not been supplied.",
  };
  const uncertaintyNotes: string[] = [];
  for (const [key, label] of Object.entries(uncertainties))
    if (key in f && (f[key] === null || f[key] === false)) {
      mapped.add(key);
      uncertaintyNotes.push(label);
    }
  if ("unrelatedStaffNote" in f) {
    mapped.add("unrelatedStaffNote");
    excludedFacts.push("unrelatedStaffNote");
  }
  for (const key of ["signature", "employeeDetails", "budget", "customerAddress", "exchangeRate"])
    if (key in f && f[key] === null) {
      mapped.add(key);
      uncertaintyNotes.push(`${key}: not supplied; not invented.`);
    }
  for (const key of ["verifiedClients", "accreditations"])
    if (Array.isArray(f[key]) && (f[key] as unknown[]).length === 0) {
      mapped.add(key);
      uncertaintyNotes.push(`${key}: none supplied.`);
    }
  if (f.paymentReceived === false) {
    mapped.add("paymentReceived");
    uncertaintyNotes.push(
      "Payment has not been received according to the supplied record. This is not a receipt.",
    );
  }
  if (typeof f.requestedTask === "string") {
    mapped.add("requestedTask");
    uncertaintyNotes.push(`Requested task: ${f.requestedTask}.`);
  }
  if (f.paymentReconciled === false) {
    mapped.add("paymentReconciled");
    mapped.add("customerStatement");
  }
  if (f.recipientConfirmedForInvoice === false) {
    mapped.add("recipientConfirmedForInvoice");
    mapped.add("invoiceCustomer");
    mapped.add("requestedRecipient");
  }
  const money = (key: string) => (typeof f[key] === "string" ? nairaKobo(f[key] as string) : undefined);
  const convert = (l: Line, index: number) => {
    if (l.quantity === null || l.unitPrice === null) {
      issues.push(`lines.${index}.${l.quantity === null ? "quantity" : "unitPrice"}`);
      return null;
    }
    return {
      description: l.unit ? `${l.description} (per ${l.unit})` : l.description,
      quantity: l.quantity,
      unitPriceKobo: nairaKobo(l.unitPrice),
      ...(l.currency ? { currency: l.currency } : {}),
    };
  };
  let sourceLines = (f.lines ?? f.baseLines ?? []) as Line[];
  if (task === "business_proposal" && f.newDraftInputs) {
    const details = f.newDraftInputs as { sessions: string; pricePerSession: string };
    sourceLines = [
      { description: "Sessions", quantity: details.sessions, unitPrice: details.pricePerSession },
    ];
  }
  if (Array.isArray(f.phases))
    sourceLines = (f.phases as { name: string; price: string }[]).map((x) => ({
      description: x.name,
      quantity: "1",
      unitPrice: x.price,
    }));
  const delivery = money("deliveryAmount");
  const financial: FinancialInput = {
    kind: task as FinancialInput["kind"],
    lines: sourceLines.map(convert).filter((x) => x !== null),
    taxAmountKobo: null,
    taxLabel: "",
    discountKobo: money("discountAmount") ?? null,
    amountDueKobo: null,
    ...(typeof f.currency === "string" ? { currency: f.currency } : {}),
    ...(delivery !== undefined ? { deliveryKobo: delivery } : {}),
  };
  if (typeof f.discountPercent === "string") financial.discountPercent = f.discountPercent;
  if (f.tax) {
    const tax = f.tax as { label: string; ratePercent: string; taxableBase: string };
    financial.taxPercent = tax.ratePercent;
    financial.taxBaseKobo = nairaKobo(tax.taxableBase);
    financial.taxLabel = tax.label;
  }
  if (Array.isArray(f.optionalLines))
    financial.optionalLines = (f.optionalLines as Line[])
      .map((l, n) => convert(l, n))
      .filter((x) => x !== null)
      .map((l) => ({ ...l, selected: f.optionalSelected === true }));
  if (typeof f.requestedTotal === "string") financial.requestedTotalKobo = nairaKobo(f.requestedTotal);
  if (task === "payment_reminder" && typeof f.invoiceAmount === "string") {
    financial.paymentRecord = {
      invoiceAmountKobo: nairaKobo(f.invoiceAmount),
      payments: ((f.recordedPayments ?? []) as { reference: string; amount: string }[]).map((x) => ({
        reference: x.reference,
        amountKobo: nairaKobo(x.amount),
      })),
      ...(f.duplicateExplanation === "Same transaction copied twice, not two payments"
        ? { duplicatesConfirmed: true }
        : {}),
    };
    financial.amountDueKobo = recordedBalance(financial.paymentRecord).amountDueKobo;
    if (typeof f.disputedAmount === "string") financial.disputedKobo = nairaKobo(f.disputedAmount);
  }
  if (task === "business_proposal") {
    financial.amountDueKobo = money("baseBudget") ?? money("price") ?? money("packagePrice") ?? null;
  }
  const contextLines: string[] = [...uncertaintyNotes];
  for (const key of ["purpose", "timeline", "customerNote", "prospectNote", "selectedDocumentMarker"]) {
    if (typeof f[key] === "string") contextLines.push(f[key] as string);
    if (["customerNote", "prospectNote", "selectedDocumentMarker"].includes(key)) mapped.add(key);
  }
  for (const key of ["deliverables", "customerInputs"])
    if (Array.isArray(f[key])) contextLines.push(...(f[key] as string[]));
  if (f.disputeReason)
    contextLines.push(
      `Disputed portion: ${String(f.disputeReason)}. Reconcile before demanding that portion.`,
    );
  if (f.optionalSelected === false)
    contextLines.push("Optional extras are not selected or included in the base total.");
  if (f.contingencyApprovedForSpending === false)
    contextLines.push("Optional contingency is a planning allowance, not approved expenditure.");
  // The facts the app has no field for, in the customer's notes (customerFixtureChanges).
  if (typeof f.contingencyPercent === "string")
    contextLines.push(`An optional contingency of ${f.contingencyPercent}% of the base budget is proposed.`);
  if (typeof f.briefUnitPrice === "string")
    contextLines.push(`The brief gives a unit price of NGN ${f.briefUnitPrice}.`);
  if (typeof f.customerStatement === "string" && f.paymentReconciled === false)
    contextLines.push(
      `The customer says: "${f.customerStatement}". No matching payment is in the supplied record.`,
    );
  if (typeof f.requestedRecipient === "string" && f.recipientConfirmedForInvoice === false)
    contextLines.push(
      `A send to ${f.requestedRecipient} is requested; that recipient is not confirmed for this invoice.`,
    );
  if (typeof f.customerBudgetCeiling === "string")
    contextLines.push(`The customer's budget ceiling is NGN ${f.customerBudgetCeiling}.`);
  if (f.scopeChangesApproved === false) contextLines.push("No change to the scope or price is approved.");
  if (typeof f.prospectEmail === "string")
    contextLines.push(`The prospect's email address is ${f.prospectEmail}.`);
  if (f.paymentAuthorisation === false) contextLines.push("No payment is authorised.");
  const input = {
    task,
    tone: "neutral",
    issuerName: p?.business ?? "",
    recipientName: p?.customer ?? "",
    documentNumber: (f.reference ?? f.invoiceReference ?? "") as string,
    issueDate: (f.issueDate ?? f.asOfDate ?? "") as string,
    dueDate: (f.dueDate ?? "") as string,
    contextLines,
    draftingInstruction: c.userInput,
    financialInput: financial,
    processingConsent: true,
    idempotencyKey: caseUUID({ case: c.caseID, hash: hashAI(c), followup }),
  };
  for (const key of Object.keys(followup))
    if (!["documentNumber", "issueDate", "dueDate"].includes(key))
      throw Error("FOLLOWUP_FIELD_NOT_SUPPORTED");
  Object.assign(input, followup);
  const parsed = customerAIInput.safeParse(input);
  if (!parsed.success) issues.push(...parsed.error.issues.map((e) => `validation:${e.path.join(".")}`));
  let blocks: ReturnType<typeof financialBlocks> = [];
  try {
    blocks = financialBlocks(financial);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : "financial_validation");
  }
  const valid = parsed.success ? parsed.data : null;
  let subtotalKobo: string | null = null;
  try {
    subtotalKobo = financial.lines
      .reduce((n, l) => n + lineTotal(l.quantity, l.unitPriceKobo), 0n)
      .toString();
  } catch {
    issues.push("line_total_unavailable");
  }
  return {
    version: "source-case-binding-v2",
    caseID: c.caseID,
    caseHash: hashAI(c),
    originalFactsHash: hashAI(f),
    followup: { version: customerFollowupVersion, synthetic: true, values: followup, hash: hashAI(followup) },
    input: valid,
    /** The input as the suite submits it, before the application's own checks; `input` is null when they refuse it. */
    submitted: input,
    inputHash: hashAI(input),
    issues,
    missing: valid ? missingCustomerFields(valid) : [],
    unsupported: valid ? unsupportedCustomerInput(valid) : false,
    blocks,
    unmappedFacts: Object.keys(f).filter((k) => !mapped.has(k)),
    excludedFacts,
    financial,
    subtotalKobo,
  };
}
export function caseUUID(value: unknown) {
  const h = hashAI(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function explicitBoundaryFollowup(c: AuthoredCustomerCase) {
  return {
    documentNumber: `SYNTHETIC-EVAL-${c.caseID}`,
    issueDate: "2026-11-13",
    ...(c.task === "payment-reminder" ? { dueDate: "2026-11-01" } : {}),
  };
}
export function expectedSourceNumbers(
  c: AuthoredCustomerCase,
  b: ReturnType<typeof bindCustomerCase>,
): { key: string; expected: string; actualKobo: string | null; pass: boolean }[] {
  if (b.subtotalKobo === null)
    return Object.entries(c.expectedNumeric ?? {}).map(([key, expected]) => ({
      key,
      expected,
      actualKobo: null,
      pass: false,
    }));
  const actual: Record<string, string> = {},
    f = c.suppliedFacts,
    fi = b.financial;
  const assign = (keys: string[], value: string) => {
    for (const k of keys) actual[k] = value;
  };
  assign(
    [
      "listedItemsSubtotalNGN",
      "subtotalNGN",
      "unadjustedLineTotalNGN",
      "serviceSubtotalNGN",
      "phaseSubtotalNGN",
      "budgetSubtotalNGN",
      "baseSubtotalNGN",
      "mathematicalSubtotalNGN",
      "mathematicalSubtotalKobo",
    ],
    b.subtotalKobo,
  );
  const discount = fi.discountPercent
    ? percentageKobo(b.subtotalKobo, fi.discountPercent)
    : (fi.discountKobo ?? "0");
  const tax = fi.taxPercent ? percentageKobo(fi.taxBaseKobo!, fi.taxPercent) : (fi.taxAmountKobo ?? "0");
  actual.discountNGN = discount;
  actual.syntheticTaxNGN = tax;
  const total = BigInt(b.subtotalKobo) - BigInt(discount) + BigInt(fi.deliveryKobo ?? "0");
  actual.amountBeforeUnspecifiedTaxNGN = total.toString();
  actual.totalNGN = (total + BigInt(tax)).toString();
  if (fi.requestedTotalKobo)
    actual.unexplainedDifferenceNGN = (BigInt(b.subtotalKobo) - BigInt(fi.requestedTotalKobo)).toString();
  if (fi.optionalLines) {
    const n = fi.optionalLines.reduce((s, l) => s + lineTotal(l.quantity, l.unitPriceKobo), 0n);
    actual.optionalExtrasNGN = n.toString();
    actual.conditionalCombinedNGN = (BigInt(b.subtotalKobo) + n).toString();
  }
  if (fi.paymentRecord) {
    const r = recordedBalance(fi.paymentRecord);
    assign(["recordedPaymentsNGN", "uniqueRecordedPaymentsNGN"], r.recordedPaymentsKobo);
    assign(["outstandingNGN", "amountDueOnSuppliedFactsNGN", "recordedBalanceNGN"], r.amountDueKobo);
    actual.netRecordedBalanceNGN = r.netRecordedBalanceKobo;
    actual.excessToReconcileNGN = r.excessToReconcileKobo;
    actual.disputedPortionNGN = fi.disputedKobo ?? "0";
    actual.balanceExcludingDisputedPortionNGN = (
      BigInt(r.amountDueKobo) - BigInt(fi.disputedKobo ?? "0")
    ).toString();
  }
  if (typeof f.baseBudget === "string") {
    actual.baseBudgetNGN = nairaKobo(f.baseBudget);
    if (typeof f.contingencyPercent === "string") {
      actual.optionalContingencyNGN = percentageKobo(actual.baseBudgetNGN, f.contingencyPercent);
      actual.conditionalPlanningCeilingNGN = (
        BigInt(actual.baseBudgetNGN) + BigInt(actual.optionalContingencyNGN)
      ).toString();
    }
  }
  if (typeof f.packagePrice === "string" && typeof f.customerBudgetCeiling === "string")
    actual.budgetGapNGN = (
      BigInt(nairaKobo(f.packagePrice)) - BigInt(nairaKobo(f.customerBudgetCeiling))
    ).toString();
  return Object.entries(c.expectedNumeric ?? {}).map(([key, value]) => ({
    key,
    expected: value,
    actualKobo: actual[key] ?? null,
    pass:
      actual[key] !== undefined &&
      actual[key] ===
        (key.endsWith("Kobo")
          ? value
          : value.startsWith("-")
            ? "-" + nairaKobo(value.slice(1))
            : nairaKobo(value)),
  }));
}
