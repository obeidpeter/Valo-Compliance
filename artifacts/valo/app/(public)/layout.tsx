import type { ReactNode } from "react";
import { headers } from "next/headers";
import { PublicShell } from "@/components/public-shell";
import { PublicProviders } from "@/islands/public-providers";

// Every response carries its own nonce, so every public page renders per request; none is generated
// ahead of time or kept in Next's caches (decision 0011, point 5).
export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-valo-nonce") ?? undefined;
  return (
    <PublicShell nonce={nonce}>
      <PublicProviders>{children}</PublicProviders>
    </PublicShell>
  );
}
