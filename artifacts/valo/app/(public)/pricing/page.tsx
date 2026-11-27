import type { BuildStatus } from "@workspace/api-client-react";
import { GetBuildStatusResponse } from "@workspace/api-zod";
import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { PaymentsStatus } from "@/islands/payments-status";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/pricing");

export default async function Pricing() {
  const status = await readForPage<BuildStatus>("/public/status", GetBuildStatusResponse);
  return (
    <div className="mx-auto max-w-5xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Pricing" title="Prices have not been set">
        No price is shown until it is final. Nothing can be bought yet, and you will not be asked for a card.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-7">
          <p className="eyebrow">What you can do now</p>
          <p className="font-display mt-3 text-3xl">Make documents and check requirements</p>
          <p className="mt-3 text-muted-foreground">
            With an account you can make and save documents, and save the results of your requirements check.
            Please use made-up details only for now.
          </p>
          <PublicLink href="/sign-up" className="btn btn-primary mt-6">
            Create account
          </PublicLink>
        </div>
        <div className="surface p-7">
          <p className="eyebrow">Payments</p>
          <PaymentsStatus live={status.ok ? status.data.livePaymentsEnabled : null} />
          <p className="mt-3 text-muted-foreground">
            Plans will be listed here once prices and terms are set.
          </p>
        </div>
      </div>
    </div>
  );
}
