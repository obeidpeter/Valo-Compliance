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
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  return new Set(session && hasPremium && ownership.isSuccess ? ownership.data : []);
}
