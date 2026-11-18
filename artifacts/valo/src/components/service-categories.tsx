import type { TicketInputCategory } from "@workspace/api-client-react";
import { CATEGORY_LABELS } from "./ticket-form";

/** The kinds of help a person can ask Valo staff about on the services page. */
export const SERVICE_CATEGORIES = [
  "registration",
  "tax",
  "accounting",
  "employment",
  "legal",
  "privacy",
  "sector_approval",
] as const satisfies readonly Exclude<TicketInputCategory, "support">[];

export function ServiceCategories() {
  return (
    <ul className="grid gap-2">
      {SERVICE_CATEGORIES.map((c) => (
        <li key={c} className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5">
          <span>{CATEGORY_LABELS[c]}</span>
          <span className="text-xs text-muted-foreground">No provider yet</span>
        </li>
      ))}
    </ul>
  );
}
