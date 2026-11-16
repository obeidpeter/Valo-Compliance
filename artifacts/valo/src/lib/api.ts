import type { CanonicalDocument, DocumentBlock } from "@workspace/api-client-react";
import {
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedRenderableBlocks,
} from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";

type MaybeApiError = { status?: number; data?: unknown; message?: string };

export type ErrorKind =
  "offline" | "unauthenticated" | "forbidden" | "conflict" | "validation" | "notFound" | "server";

export interface DescribedError {
  kind: ErrorKind;
  status?: number;
  message: string;
  currentRevision?: number;
}

export function describeError(err: unknown): DescribedError {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      kind: "offline",
      message: "You appear to be offline. Nothing was lost; reconnect and try again.",
    };
  }
  const e = (err ?? {}) as MaybeApiError;
  const status = typeof e.status === "number" ? e.status : undefined;
  const data = (e.data ?? null) as { error?: unknown; currentRevision?: unknown } | null;
  const serverText = data && typeof data.error === "string" ? data.error : undefined;
  const currentRevision = data && typeof data.currentRevision === "number" ? data.currentRevision : undefined;
  if (status === undefined) {
    return {
      kind: "offline",
      message: "The Valo service could not be reached. Check your connection and retry.",
    };
  }
  if (status === 401)
    return { kind: "unauthenticated", status, message: serverText ?? "Please sign in to continue." };
  if (status === 403) {
    return {
      kind: "forbidden",
      status,
      message:
        serverText ??
        "Your account cannot access this yet. It may need email verification, or it may be suspended.",
    };
  }
  if (status === 404)
    return {
      kind: "notFound",
      status,
      message: serverText ?? "We could not find that record in your workspace.",
    };
  if (status === 409)
    return {
      kind: "conflict",
      status,
      message: serverText ?? "This was changed elsewhere since you opened it.",
      currentRevision,
    };
  if (status === 400 || status === 422)
    return {
      kind: "validation",
      status,
      message: serverText ?? "Some details were not accepted. Please review and try again.",
    };
  return {
    kind: "server",
    status,
    message: serverText ?? "Something went wrong on our side. Your work in this tab is unchanged.",
  };
}

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
