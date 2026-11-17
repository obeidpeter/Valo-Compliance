import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { recordedBalance } from "@workspace/valo-core/money";
import { customerAIInput } from "../lib/valo-customer-ai-domain";
type Case = {
  caseID: string;
  task: string;
  suppliedFacts: {
    parties: { business: string; customer: string };
    invoiceReference: string;
    invoiceAmount: string;
    recordedPayments: { reference: string; amount: string }[];
    dueDate: string | null;
    asOfDate?: string;
  };
  userInput: string;
  expectedNumeric: {
    outstandingNGN?: string;
    amountDueOnSuppliedFactsNGN?: string;
    recordedPaymentsNGN?: string;
    excessToReconcileNGN?: string;
  };
};
export const reminderCandidates = (
  JSON.parse(
    readFileSync(new URL("../../../../docs/evaluation-candidates/customer-ai.json", import.meta.url), "utf8"),
  ) as { cases: Case[] }
).cases.filter((c) => /^CAI-CAND-REM-0[1-4]$/.test(c.caseID));
export function exactKobo(value: string) {
  if (!/^[0-9]{1,22}(?:\.[0-9]{1,2})?$/.test(value)) throw Error("UNSUPPORTED_DECIMAL_PRECISION");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(2, "0")).toString();
}
export function candidateReminder(c: Case) {
  const f = c.suppliedFacts,
    paymentRecord = {
      invoiceAmountKobo: exactKobo(f.invoiceAmount),
      payments: f.recordedPayments.map((p) => ({ reference: p.reference, amountKobo: exactKobo(p.amount) })),
    };
  return customerAIInput.parse({
    task: "payment_reminder",
    tone: "polite",
    issuerName: f.parties.business,
    recipientName: f.parties.customer,
    documentNumber: f.invoiceReference,
    issueDate: f.asOfDate ?? "",
    dueDate: f.dueDate ?? "",
    contextLines: [c.userInput],
    financialInput: {
      kind: "payment_reminder",
      lines: [],
      taxAmountKobo: null,
      taxLabel: "",
      discountKobo: null,
      amountDueKobo: recordedBalance(paymentRecord).amountDueKobo,
      paymentRecord,
    },
    processingConsent: true,
    idempotencyKey: randomUUID(),
  });
}
