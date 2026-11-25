import { createHash } from "node:crypto";
import { CreateCustomerAIDraftBody, CreateCustomerAIDraftResponse } from "@workspace/api-zod";
import { canonical } from "@workspace/valo-core";
import { buildBusinessDraft, type CustomerPlan } from "@workspace/valo-core/customer-document";
import { financialBlocks, recordedBalance } from "@workspace/valo-core/money";
import { calendarDate } from "../../lib/valo-validation";
import { z } from "zod";
export const customerPromptVersion = "customer-extractive-v3";
export const customerNoticeVersion = "customer-ai-development-notice-v2";
export const hashAI = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const customerAIInput = CreateCustomerAIDraftBody.strict().superRefine((i, ctx) => {
  if (
    i.contextLines.reduce((sum, line) => sum + line.length, 0) + (i.draftingInstruction?.length ?? 0) >
    20000
  )
    ctx.addIssue({
      code: "custom",
      path: ["draftingInstruction"],
      message: "Shorten the selected notes or instruction: their combined limit is 20,000 characters.",
    });
  if (!i.processingConsent)
    ctx.addIssue({
      code: "custom",
      path: ["processingConsent"],
      message: "Review and accept the AI processing notice, or use the independent manual editor.",
    });
  if (i.task !== i.financialInput.kind)
    ctx.addIssue({
      code: "custom",
      path: ["financialInput", "kind"],
      message: "The financial model must match the selected task.",
    });
  for (const field of ["issueDate", "dueDate"] as const)
    if (i[field] && !calendarDate(i[field]))
      ctx.addIssue({ code: "custom", path: [field], message: "Enter a real YYYY-MM-DD calendar date." });
  if (i.task !== "payment_reminder" && i.issueDate && i.dueDate && i.dueDate < i.issueDate)
    ctx.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "The due date cannot precede the issue date.",
    });
  try {
    financialBlocks(i.financialInput);
  } catch {
    ctx.addIssue({
      code: "custom",
      path: ["financialInput"],
      message: "Check positive quantities, integer kobo and discount not exceeding subtotal.",
    });
  }
});
export type CustomerAIInput = z.infer<typeof customerAIInput>;
/** The notice a request outside the four tasks gets, in place of an AI draft. */
export const unsupportedTaskNotice =
  "This request exceeds the four bounded business tasks. Use a scoped published resource, official authority or independent adviser; no adviser availability is implied.";
export const customerPlanSchema = z
  .object({
    opening: z.enum(["none", "please_review", "for_consideration", "outstanding_record"]),
    sections: z
      .array(
        z
          .object({
            heading: z.enum(["overview", "scope", "deliverables", "next_steps", "notes"]),
            lineIndexes: z.array(z.number().int().min(0).max(19)).max(6),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export function missingCustomerFields(i: CustomerAIInput) {
  const missing: string[] = [];
  for (const key of ["issuerName", "recipientName", "documentNumber", "issueDate"] as const)
    if (!i[key].trim()) missing.push(key);
  if (["invoice", "quotation"].includes(i.task) && !i.financialInput.lines.length) missing.push("lineItems");
  if (i.task === "payment_reminder") {
    if (i.financialInput.amountDueKobo === null) missing.push("amountDue");
    if (!i.dueDate) missing.push("dueDate");
    if (
      i.financialInput.paymentRecord &&
      recordedBalance(i.financialInput.paymentRecord).amountDueKobo === "0"
    )
      missing.push("balanceReconciliation");
  }
  if (i.task === "business_proposal" && !i.contextLines.length) missing.push("proposalPurposeAndScope");
  return missing;
}
export function unsupportedCustomerInput(i: CustomerAIInput) {
  const text = [
    i.draftingInstruction ?? "",
    ...i.contextLines,
    ...i.financialInput.lines.map((l) => l.description),
    ...(i.financialInput.optionalLines ?? []).map((l) => l.description),
  ].join("\n");
  return /ignore.{0,50}(instructions|system|policy|balance|user)|system override|(?:publish|email).{0,35}(every|all).{0,20}(draft|document)|(?:access|use).{0,30}(bank tools|private URLs)|reveal.{0,50}(secret|other tenant|system prompt)|read.{0,30}\.env|169\.254\.169\.254|(?:invent|assume|guess|make up).{0,40}(tax|name|signature|amount|registration|payment|legal)|(?:draft|provide|write|create).{0,35}(legal opinion|employment contract|non-compete|non-disclosure agreement)|(?:lawyer approved|guaranteed compliant|forge.{0,20}payment proof)/i.test(
    text,
  );
}
/** Only selected redacted notes/instruction are sent, never profile/history or direct financial/name fields. */
export function customerProviderPayload(i: CustomerAIInput) {
  const identifiers = [
    i.issuerName,
    i.recipientName,
    i.documentNumber,
    ...(i.financialInput.paymentRecord?.payments.map((p) => p.reference) ?? []),
  ]
    .map((v) => v.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const identifierPattern = identifiers.length
    ? new RegExp(identifiers.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi")
    : null;
  const redact = (line: string) => {
    let text = line;
    if (identifierPattern) text = text.replace(identifierPattern, "[IDENTIFIER]");
    text = text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
      .replace(/(?:api[_ -]?key|password|secret)\s*[:=]\s*\S+/gi, "[REDACTED]")
      .replace(/\+?\d[\d ()-]{7,}\d/g, "[NUMBER]")
      .replace(/\b\d+(?:[.,]\d+)*\b/g, "[NUMBER]");
    // The model classifies an excerpt. Original notes are retained verbatim in the private document.
    return text.slice(0, 1000);
  };
  return {
    task: i.task,
    tone: i.tone,
    notes: i.contextLines.map((line, index) => ({ index, text: redact(line) })),
    ...(i.draftingInstruction?.trim() ? { draftingInstruction: redact(i.draftingInstruction) } : {}),
  };
}
export type CustomerPreview = z.infer<typeof CreateCustomerAIDraftResponse>;
export function customerPreview(
  id: string,
  input: CustomerAIInput,
  status: CustomerPreview["status"],
  plan: CustomerPlan | null,
  inputHash: string,
  providerCalls: number | null = 0,
  modelUsed: string | null = null,
  extra: string[] = [],
): CustomerPreview {
  const safeInput = status === "unsupported" ? { ...input, contextLines: [] } : input;
  const draft = buildBusinessDraft(safeInput, plan);
  const limitations = [
    "This is your private business draft, not a released Valo template, legal opinion or verified payment evidence.",
    "Names and amounts are supplied by you. Totals use integer-kobo arithmetic; no tax rate, exemption, registration or signature is invented.",
    "Only selected redacted notes and your optional drafting instruction are sent to AI; automatic redaction is incomplete. Real confidential data remains prohibited during development.",
    "Exports remain deliberately watermarked business drafts. No professional review or editorial publication is claimed.",
    ...extra,
  ];
  return CreateCustomerAIDraftResponse.parse({
    id,
    task: input.task,
    status,
    ...draft,
    missingFields: missingCustomerFields(input),
    limitations,
    modelUsed,
    providerCalls,
    inputHash,
    previewHash: hashAI(draft),
    acceptedDocumentId: null,
  });
}
