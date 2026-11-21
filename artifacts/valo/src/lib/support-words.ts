import { CATEGORY_LABELS } from "@/lib/ticket-categories";
import type { SupportStatus } from "@/lib/support-case-api";

/** Where a support request stands, as its customer reads it. */
export const SUPPORT_STATUS_WORDS: Record<SupportStatus, string> = {
  open: "Waiting for staff",
  in_progress: "With a member of staff",
  awaiting_customer: "Staff have replied",
  resolved: "Resolved",
};

/** Where a request stands. A state this build does not know keeps its own name, spelt in words. */
export function supportStatusWords(status: string) {
  return (SUPPORT_STATUS_WORDS as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

/** What a request is about, in the words the form offered. */
export function supportTopic(category: string) {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category.replaceAll("_", " ");
}
