/** Synthetic engineering input only. Never imported by customer compilation,
 * publication or production seed code. */
import { emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import type { GuidedField, GuidedTemplateId } from "@workspace/valo-core/guided";
export function completeGuidedTestData(id: GuidedTemplateId) {
  const data = emptyGuidedData(id),
    spec = GUIDED_SPECS_V1[id];
  const value = (f: GuidedField) => {
    if (f.type === "date") return "2026-11-14";
    if (f.type === "money_kobo") return "10000";
    if (f.type === "quantity") return "2.5";
    if (f.type === "integer") return "1";
    if (f.type === "select") return f.options![0]!.value;
    if (f.type === "acknowledgement") return "yes";
    return `Synthetic ${f.id}`;
  };
  for (const f of spec.fields) data.values[f.id] = value(f);
  for (const t of spec.tables)
    for (const row of data.tables[t.id]!) for (const c of t.columns) row[c.id] = value(c);
  return data;
}
