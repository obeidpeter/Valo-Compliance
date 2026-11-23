import type { CanonicalDocument } from "@workspace/api-client-react";
import type { GuidedData } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { FIELD_LABELS } from "./api";
import { formatDay, formatNaira } from "./format";
import { askedAs } from "./guided-money";

export type DocumentDiffEntry = {
  label: string;
  olderValue: string;
  currentValue: string;
};

function safeGuided(content: CanonicalDocument): GuidedData | null {
  try {
    return guidedDataFromBlocks(content.blocks);
  } catch {
    // Non-guided or unsupported guided content compares via standard fields and blocks.
    return null;
  }
}

function displayOrBlank(raw: string | undefined, kind: "text" | "date" | "money" = "text"): string {
  const value = (raw ?? "").trim();
  if (!value) return "Blank";
  if (kind === "date") return formatDay(value);
  if (kind === "money") return /^\d+$/.test(value) ? formatNaira(value) : value;
  return value.length > 90 ? value.slice(0, 87) + "…" : value;
}

/**
 * Summarizes visible differences between an older saved version and the currently open document so
 * the user can inspect what restoring will change before overwriting their latest draft.
 */
export function summarizeDocumentDiff(
  current: { title: string; content: CanonicalDocument },
  older: { title: string; content: CanonicalDocument },
): DocumentDiffEntry[] {
  const changes: DocumentDiffEntry[] = [];

  if (current.title.trim() !== older.title.trim()) {
    changes.push({
      label: "Title",
      olderValue: displayOrBlank(older.title),
      currentValue: displayOrBlank(current.title),
    });
  }

  const currentGuided = safeGuided(current.content);
  const olderGuided = safeGuided(older.content);

  if (currentGuided && olderGuided && currentGuided.templateId === olderGuided.templateId) {
    const spec = GUIDED_SPECS_V1[currentGuided.templateId];
    for (const field of spec.fields) {
      const a = (olderGuided.values[field.id] ?? "").trim();
      const b = (currentGuided.values[field.id] ?? "").trim();
      if (a === b) continue;
      const kind = field.type === "money_kobo" ? "money" : field.type === "date" ? "date" : "text";
      changes.push({
        label: askedAs(field),
        olderValue: displayOrBlank(a, kind),
        currentValue: displayOrBlank(b, kind),
      });
    }
    for (const table of spec.tables) {
      const olderRows = olderGuided.tables[table.id] ?? [];
      const currentRows = currentGuided.tables[table.id] ?? [];
      if (JSON.stringify(olderRows) !== JSON.stringify(currentRows)) {
        changes.push({
          label: table.label,
          olderValue: `${olderRows.length} ${olderRows.length === 1 ? "row" : "rows"}`,
          currentValue: `${currentRows.length} ${currentRows.length === 1 ? "row" : "rows"}`,
        });
      }
    }
    return changes;
  }

  for (const key of [
    "issuerName",
    "recipientName",
    "documentNumber",
    "issueDate",
    "dueDate",
    "notes",
  ] as const) {
    const a = (older.content.fields[key] ?? "").trim();
    const b = (current.content.fields[key] ?? "").trim();
    if (a === b) continue;
    const kind = key === "issueDate" || key === "dueDate" ? "date" : "text";
    changes.push({
      label: FIELD_LABELS[key],
      olderValue: displayOrBlank(a, kind),
      currentValue: displayOrBlank(b, kind),
    });
  }

  if (JSON.stringify(older.content.blocks) !== JSON.stringify(current.content.blocks)) {
    changes.push({
      label: "Body sections",
      olderValue: `${older.content.blocks.length} ${older.content.blocks.length === 1 ? "block" : "blocks"}`,
      currentValue: `${current.content.blocks.length} ${current.content.blocks.length === 1 ? "block" : "blocks"}`,
    });
  }

  if (
    JSON.stringify(older.content.financialInput ?? null) !==
    JSON.stringify(current.content.financialInput ?? null)
  ) {
    const oldLines = older.content.financialInput?.lines.length ?? 0;
    const curLines = current.content.financialInput?.lines.length ?? 0;
    changes.push({
      label: "Financial details",
      olderValue: `${oldLines} ${oldLines === 1 ? "line" : "lines"}`,
      currentValue: `${curLines} ${curLines === 1 ? "line" : "lines"}`,
    });
  }

  return changes;
}
