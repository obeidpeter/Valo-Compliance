import {
  getListOwnedTemplateEditionsQueryKey,
  useListOwnedTemplateEditions,
} from "@workspace/api-client-react";
import type { Identity } from "@/islands/identity-store";

export function useOwnedTemplateEditions(identity: Identity, hasPremium: boolean): ReadonlySet<string> {
  const session = identity.status === "signed-in" ? identity.sessionId : null;
  const ownership = useListOwnedTemplateEditions({
    query: {
      queryKey: [...getListOwnedTemplateEditionsQueryKey(), session],
      enabled: !!session && hasPremium,
      gcTime: 0,
      retry: false,
      // The labels change only after a purchase or a refund. Coming back to the tab rereads them; a
      // poll every 15 seconds also checked the sign-in live each time (decision 0003).
      refetchOnWindowFocus: true,
    },
  });
  return new Set(session && hasPremium && ownership.isSuccess ? ownership.data : []);
}
