import type { TicketInputCategory } from "@workspace/api-client-react";

/**
 * SRV-002: a service enquiry needs the person's explicit consent to share it; product support does
 * not. The API refuses a service enquiry without consent (ticketInput in the API's
 * valo-validation.ts); the form asks for consent in the same cases, and a test checks they agree.
 */
export function needsSharingConsent(category: TicketInputCategory) {
  return category !== "support";
}

export type EnquiryDraft = { category: TicketInputCategory; scope: string; email: string; consent: boolean };

/** What stops a draft being sent, by field, in the words the form shows; empty when nothing does. */
export function enquiryProblems(draft: EnquiryDraft) {
  const scope =
    draft.scope.trim().length < 10
      ? "Describe what you need in at least 10 characters."
      : draft.scope.length > 4000
        ? "Keep it under 4,000 characters."
        : "";
  const email = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email) ? "Enter an email we can reply to." : "";
  const consent =
    needsSharingConsent(draft.category) && !draft.consent
      ? "Tick this box to send a service enquiry, or choose Valo product support as the topic."
      : "";
  return { scope, email, consent };
}
