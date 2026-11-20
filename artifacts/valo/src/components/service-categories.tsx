import type { TicketInputCategory } from "@workspace/api-client-react";
import { CATEGORY_LABELS } from "@/lib/ticket-categories";

/**
 * SRV-001: the kinds of help a person can ask Valo staff about, each explained in plain words, so
 * the page is useful while no provider is listed. A description says what someone can ask about,
 * never that anything is provided, booked or done on their behalf, and names no authority.
 */
export const SERVICE_DESCRIPTIONS = {
  registration: "Registering a business name or company, or keeping its registered details up to date.",
  tax: "Which tax registrations, returns and records may apply to your business.",
  accounting: "Organising bookkeeping, invoices, receipts and year-end records.",
  employment: "Staff contracts, pay records, leave and workplace policies.",
  legal: "Business agreements and documents such as contracts, terms and formal letters.",
  privacy: "Collecting, keeping and sharing personal information about customers and staff.",
  sector_approval: "Permits, licences or approvals that an activity such as making food products may need.",
} as const satisfies Record<Exclude<TicketInputCategory, "support">, string>;

export const SERVICE_CATEGORIES = Object.keys(SERVICE_DESCRIPTIONS) as (keyof typeof SERVICE_DESCRIPTIONS)[];

export function ServiceCategories() {
  return (
    <ul className="grid gap-2">
      {SERVICE_CATEGORIES.map((c) => (
        <li key={c} className="rounded-xl border border-border px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <span>{CATEGORY_LABELS[c]}</span>
            <span className="text-xs text-muted-foreground">No provider yet</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{SERVICE_DESCRIPTIONS[c]}</p>
        </li>
      ))}
    </ul>
  );
}
