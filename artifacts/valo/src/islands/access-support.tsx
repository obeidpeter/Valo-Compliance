"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccessSupportInputTopic } from "@workspace/api-client-react";
import { AccessSupportForm } from "@/components/access-support-form";

/** The access support form on a server-rendered page, with the query client its request needs. The
 * request needs no account: the API accepts it from anyone, as from the browser app. */
export function AccessSupportIsland({ defaultTopic }: { defaultTopic: AccessSupportInputTopic }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false, networkMode: "always" } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <AccessSupportForm defaultTopic={defaultTopic} />
    </QueryClientProvider>
  );
}
