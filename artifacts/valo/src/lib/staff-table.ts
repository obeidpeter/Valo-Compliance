import { formatDateTime } from "./format";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const COLUMN_OVERRIDES: Record<string, string> = {
  id: "ID",
  createdAt: "Created",
  updatedAt: "Updated",
  checkedAt: "Checked",
  workspaceId: "Workspace ID",
  identityId: "Identity ID",
  contentVersionId: "Content version ID",
  orderId: "Order ID",
  caseId: "Case ID",
  amountKobo: "Amount (kobo)",
};

/** Turn a raw camelCase or snake_case staff record key into a readable column header. */
export function formatStaffColumn(key: string): string {
  if (key in COLUMN_OVERRIDES) return COLUMN_OVERRIDES[key]!;
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return key;
  return (spaced[0]!.toUpperCase() + spaced.slice(1).toLowerCase()).replace(/\bid\b/gi, "ID");
}

/** Format a staff table cell cleanly for scanning, keeping full structured JSON optional. */
export function formatStaffCell(value: unknown): { summary: string; detail?: string } {
  if (value === null || value === undefined || value === "") return { summary: "—" };
  if (typeof value === "boolean") return { summary: value ? "Yes" : "No" };
  if (typeof value === "number") return { summary: String(value) };
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) return { summary: formatDateTime(value) };
    return { summary: value };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { summary: "0 items" };
    if (value.every((item) => typeof item === "string" || typeof item === "number")) {
      return { summary: value.join(", ") };
    }
    return {
      summary: `${value.length} ${value.length === 1 ? "item" : "items"}`,
      detail: JSON.stringify(value, null, 2),
    };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return {
    summary: `${entries.length} ${entries.length === 1 ? "field" : "fields"}`,
    detail: JSON.stringify(value, null, 2),
  };
}

/** Name which staff sub-panels currently block area switching. */
export function dirtyStaffPanels(flags: { support: boolean; content: boolean; manual: boolean }): string[] {
  const out: string[] = [];
  if (flags.support) out.push("Support cases");
  if (flags.content) out.push("Content escalations");
  if (flags.manual) out.push("Manual content editor");
  return out;
}
