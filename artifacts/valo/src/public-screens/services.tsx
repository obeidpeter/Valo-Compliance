"use client";

import type { TicketInputCategory } from "@workspace/api-client-react";
import { TicketFormInner, TicketSignedOut } from "@/components/ticket-form-parts";
import { useIdentity } from "@/islands/identity-store";

/**
 * The services page's enquiry form, which needs a signed-in, verified account. It shows the
 * signed-out card until the identity provider, loaded after the page, reports a signed-in visitor,
 * whose email address the form starts with (decision 0011, point 6).
 */
export function ServiceEnquiry({
  category,
  categories,
}: {
  category: TicketInputCategory;
  categories: TicketInputCategory[];
}) {
  const identity = useIdentity();
  return identity.status === "signed-in" ? (
    <TicketFormInner
      key={category}
      defaultCategory={category}
      categories={categories}
      intro="Enquiries require a signed-in, verified account."
      email={identity.email}
    />
  ) : (
    <TicketSignedOut />
  );
}
