import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { financialBlocks, recordedBalance, type FinancialInput } from "@workspace/valo-core/money";
import { buildBusinessDraft } from "@workspace/valo-core/customer-document";
import {
  customerAIInput,
  customerPreview,
  customerProviderPayload,
  hashAI,
  missingCustomerFields,
} from "../modules/ai-lanes/valo-customer-ai-domain";
import { documentInput } from "./valo-validation";
import { reminderCandidates, candidateReminder, exactKobo } from "../scripts/reminder-candidate-inputs";
for (const c of reminderCandidates)
  test(`${c.caseID}: original supplied balance rubric executes against the real draft model`, () => {
    const input = candidateReminder(c),
      balance = recordedBalance(input.financialInput.paymentRecord!);
    assert.equal(
      balance.amountDueKobo,
      exactKobo(c.expectedNumeric.outstandingNGN ?? c.expectedNumeric.amountDueOnSuppliedFactsNGN!),
    );
    if (c.expectedNumeric.recordedPaymentsNGN)
      assert.equal(balance.recordedPaymentsKobo, exactKobo(c.expectedNumeric.recordedPaymentsNGN));
    if (c.expectedNumeric.excessToReconcileNGN)
      assert.equal(balance.excessToReconcileKobo, exactKobo(c.expectedNumeric.excessToReconcileNGN));
    const draft = buildBusinessDraft(input, null);
    assert.doesNotThrow(() => documentInput.parse(draft));
    for (const p of input.financialInput.paymentRecord!.payments)
      assert.ok(draft.content.blocks.some((b) => b.rows.some((row) => row[0]?.includes(p.reference))));
    if (c.caseID.endsWith("04")) {
      assert.ok(missingCustomerFields(input).includes("balanceReconciliation"));
      assert.match(draft.title, /Payment record enquiry/);
      assert.match(JSON.stringify(draft.content), /no refund authorised/);
    }
  });
test("references cannot be deducted twice, including whitespace/case aliases", () => {
  assert.throws(
    () =>
      recordedBalance({
        invoiceAmountKobo: "10000",
        payments: [
          { reference: "REF-1", amountKobo: "100" },
          { reference: " ref-1 ", amountKobo: "100" },
        ],
      }),
    /DUPLICATE_PAYMENT_REFERENCE/,
  );
});
test("payment arrays are bounded and sub-kobo inputs are never silently rounded", () => {
  assert.throws(() =>
    recordedBalance({
      invoiceAmountKobo: "1000",
      payments: Array.from({ length: 41 }, (_, i) => ({ reference: String(i), amountKobo: "1" })),
    }),
  );
  assert.throws(() => exactKobo("0.001"), /UNSUPPORTED_DECIMAL_PRECISION/);
  assert.throws(() => recordedBalance({ invoiceAmountKobo: "1.5", payments: [] }), /INVALID_INTEGER_KOBO/);
});
test("past original payment deadlines work for reminders but not invoices, quotations or proposals", () => {
  const input = candidateReminder(reminderCandidates[0]!);
  assert.ok(input.dueDate < input.issueDate);
  for (const task of ["invoice", "quotation", "business_proposal"] as const) {
    const other = {
      ...input,
      task,
      financialInput: { ...input.financialInput, kind: task, paymentRecord: undefined },
    };
    assert.equal(customerAIInput.safeParse(other).success, false);
    assert.equal(documentInput.safeParse(buildBusinessDraft(other, null)).success, false);
  }
});
test("client-altered balances and summary rows fail server validation", () => {
  const input = candidateReminder(reminderCandidates[0]!);
  assert.equal(
    customerAIInput.safeParse({ ...input, financialInput: { ...input.financialInput, amountDueKobo: "1" } })
      .success,
    false,
  );
  const draft = buildBusinessDraft(input, null);
  draft.content.blocks.at(-1)!.rows.at(-1)![1] = "₦0.01";
  assert.equal(documentInput.safeParse(draft).success, false);
});
test("payment references stay out of provider context even if repeated in selected notes", () => {
  const input = candidateReminder(reminderCandidates[0]!);
  input.contextLines = [
    `Discuss ${input.financialInput.paymentRecord!.payments[0]!.reference} without inventing facts.`,
  ];
  const payload = JSON.stringify(customerProviderPayload(input));
  assert.ok(!payload.includes(input.financialInput.paymentRecord!.payments[0]!.reference));
  assert.ok(!payload.includes("invoiceAmountKobo"));
  assert.ok(!payload.includes("recordedPayments"));
});
test("legacy manual amount-only reminders retain their exact model and derived table", () => {
  const legacy: FinancialInput = {
    kind: "payment_reminder",
    lines: [],
    taxAmountKobo: null,
    taxLabel: "",
    discountKobo: null,
    amountDueKobo: "25",
  };
  assert.deepEqual(financialBlocks(legacy), [
    {
      id: "financial-summary-v1",
      type: "table",
      text: "User-recorded outstanding amount, not verified payment evidence",
      rows: [
        ["Description", "Amount"],
        ["Amount recorded due", "₦0.25"],
      ],
    },
  ]);
  assert.equal("paymentRecord" in legacy, false);
});
test("zero-balance preflight remains an enquiry and retains missing-information disclosure", () => {
  const input = candidateReminder(reminderCandidates[3]!);
  const preview = customerPreview(randomUUID(), input, "needs_information", null, hashAI(input));
  assert.equal(preview.providerCalls, 0);
  assert.match(preview.title, /Payment record enquiry/);
  assert.ok(preview.missingFields.includes("balanceReconciliation"));
});
