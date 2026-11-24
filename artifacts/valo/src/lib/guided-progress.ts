import type { GuidedField } from "@workspace/valo-core/guided";
import type { FormValue, FormView } from "./form-view";
import { guidedVisible } from "@workspace/valo-core/guided-runtime";

export type GuidedNavItem = {
  id: string;
  domId: string;
  label: string;
  issueCount: number;
  done: boolean;
};

export type GuidedProgress = {
  requiredTotal: number;
  requiredDone: number;
  percent: number;
  firstIssueTarget: { selector: string; label: string } | null;
  navItems: GuidedNavItem[];
};

/**
 * Computes live completion counts, section/table jump items, and the exact DOM selector of the
 * first visible missing or invalid required answer in a guided document.
 */
export function computeGuidedProgress(
  spec: FormView,
  data: FormValue,
  issues: Record<string, string>,
): GuidedProgress {
  const fieldById = new Map<string, GuidedField>(spec.fields.map((f) => [f.id, f]));
  const placed = new Set(spec.sections.flatMap((s) => s.fieldIds));
  const loose = spec.fields.filter((f) => !placed.has(f.id));

  let requiredTotal = 0;
  let requiredMissing = 0;
  let firstIssueTarget: { selector: string; label: string } | null = null;
  const navItems: GuidedNavItem[] = [];

  const scanFields = (fields: GuidedField[], navId: string, domId: string, label: string) => {
    const visible = fields.filter((f) => guidedVisible(f, data.values));
    if (visible.length === 0) return;
    let sectionIssues = 0;
    for (const f of visible) {
      const hasIssue = Boolean(issues[f.id]);
      if (f.required) requiredTotal++;
      if (hasIssue) {
        sectionIssues++;
        if (f.required) requiredMissing++;
        if (!firstIssueTarget) firstIssueTarget = { selector: `#g-${f.id}`, label: f.label };
      }
    }
    navItems.push({
      id: navId,
      domId,
      label,
      issueCount: sectionIssues,
      done: sectionIssues === 0,
    });
  };

  for (const section of spec.sections) {
    const fields = section.fieldIds
      .map((id) => fieldById.get(id))
      .filter((f): f is GuidedField => Boolean(f));
    scanFields(fields, section.id, `guided-sec-${section.id}`, section.label);
  }
  scanFields(loose, "other", "guided-sec-other", "Other details");

  for (const table of spec.tables) {
    if (!guidedVisible(table, data.values)) continue;
    const rows = data.tables[table.id] ?? [];
    let tableIssues = 0;
    if (rows.length < table.minRows) {
      requiredTotal++;
      if (issues[table.id]) {
        tableIssues++;
        requiredMissing++;
        if (!firstIssueTarget) {
          firstIssueTarget = { selector: `#gt-${table.id}-add`, label: table.label };
        }
      }
    }
    rows.forEach((row, rowIndex) => {
      const merged = { ...data.values, ...row };
      for (const col of table.columns) {
        if (!guidedVisible(col, merged)) continue;
        const key = `${table.id}:${rowIndex}:${col.id}`;
        const hasIssue = Boolean(issues[key]);
        if (col.required) requiredTotal++;
        if (hasIssue) {
          tableIssues++;
          if (col.required) requiredMissing++;
          if (!firstIssueTarget) {
            firstIssueTarget = {
              selector: `#gt-${table.id}-${rowIndex}-${col.id}`,
              label: `${col.label} (row ${rowIndex + 1})`,
            };
          }
        }
      }
    });
    navItems.push({
      id: `table-${table.id}`,
      domId: `guided-tbl-${table.id}`,
      label: table.label,
      issueCount: tableIssues,
      done: tableIssues === 0,
    });
  }

  const requiredDone = Math.max(0, requiredTotal - requiredMissing);
  const percent = requiredTotal === 0 ? 100 : Math.min(100, Math.round((requiredDone / requiredTotal) * 100));

  return { requiredTotal, requiredDone, percent, firstIssueTarget, navItems };
}
