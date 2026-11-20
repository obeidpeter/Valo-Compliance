import type { TicketInputCategory } from "@workspace/api-client-react";

/** What each kind of support or service enquiry is called. */
export const CATEGORY_LABELS: Record<TicketInputCategory, string> = {
  support: "Valo product support",
  registration: "Business registration",
  tax: "Tax",
  accounting: "Accounting and bookkeeping",
  employment: "Employment and staff",
  legal: "Legal documents",
  privacy: "Data protection and privacy",
  sector_approval: "Sector approvals and permits",
};
