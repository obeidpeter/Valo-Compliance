import type { CanonicalDocument, DocumentBlock } from "@workspace/api-client-react";
import {
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedRenderableBlocks,
} from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";

export { describeError, type DescribedError, type ErrorKind } from "./describe-error";

export function newBlockId(): string {
  return "b_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function blankParagraph(): DocumentBlock {
  return { id: newBlockId(), type: "paragraph", text: "", rows: [] };
}

export function blankContent(): CanonicalDocument {
  return {
    fields: { issuerName: "", recipientName: "", documentNumber: "", issueDate: "", dueDate: "", notes: "" },
    blocks: [blankParagraph()],
    selectedClauses: [],
    formatting: { font: "serif", accent: "forest" },
  };
}

export const FIELD_LABELS: Record<keyof CanonicalDocument["fields"], string> = {
  issuerName: "Issued by",
  recipientName: "Addressed to",
  documentNumber: "Reference number",
  issueDate: "Issue date",
  dueDate: "Due date",
  notes: "Notes",
};

export function missingFields(content: CanonicalDocument): string[] {
  const out: string[] = [];
  let visible = content.blocks;
  try {
    const answers = guidedDataFromBlocks(content.blocks);
    if (answers) {
      const spec = GUIDED_SPECS_V1[answers.templateId];
      for (const [key, message] of Object.entries(guidedDataIssues(spec, answers)))
        out.push(`${spec.fields.find((f) => f.id === key)?.label ?? key}: ${message}`);
      visible = guidedRenderableBlocks(content);
    } else {
      (Object.keys(FIELD_LABELS) as (keyof CanonicalDocument["fields"])[]).forEach((k) => {
        if (!content.fields[k]?.trim()) out.push(FIELD_LABELS[k]);
      });
      if (!content.blocks.some((b) => b.text.trim() || b.rows.some((r) => r.some((c) => c.trim()))))
        out.push("Body text");
    }
  } catch {
    return [
      "The saved guided layout is unsupported or altered. Restore a valid revision; do not treat it as complete.",
    ];
  }
  const body = visible.flatMap((b) => [b.text, ...b.rows.flat()]).join("\n");
  const placeholders = [...new Set(body.match(/\[[^\]\n]{0,140}\]|\{\{[^}\n]{1,140}\}\}|_{3,}/g) ?? [])];
  if (placeholders.length)
    out.push(
      `Possible unresolved template placeholders (${placeholders.length}): ${placeholders.slice(0, 5).join(", ")}`,
    );
  return out;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
