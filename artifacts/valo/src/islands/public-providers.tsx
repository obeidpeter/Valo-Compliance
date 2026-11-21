"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicLink } from "@/components/public-link";
import type { SiteLink } from "@/components/site-chrome";
import { SiteLinkContext } from "@/components/site-link";

/**
 * What the islands of a server-rendered page share: one query client for the reads they make from the
 * browser, which retries a failed read twice unless the API refused it, and the public link for the
 * shared components they render.
 */
export function PublicProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false, networkMode: "always" },
          queries: {
            refetchOnWindowFocus: false,
            retry: (count, error) => {
              const status = (error as { status?: number })?.status;
              return !(status && status >= 400 && status < 500) && count < 2;
            },
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SiteLinkContext.Provider value={PublicLink as SiteLink}>{children}</SiteLinkContext.Provider>
    </QueryClientProvider>
  );
}
