import { GetBuildStatusResponse } from "@workspace/api-zod";
import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { PaymentsStatus } from "@/islands/payments-status";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/pricing");

export default async function Pricing() {
  const status = await readForPage("/public/status", GetBuildStatusResponse);
  return (
    <div className="mx-auto max-w-5xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Pricing" title="Prices have not been set.">
        We will not show a number until it is final. There is no checkout, and no card is ever asked for in
        this build.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-7">
          <p className="eyebrow">Today</p>
          <p className="font-display mt-3 text-3xl">Drafting workspace</p>
          <p className="mt-3 text-muted-foreground">
            Open a development workspace to write and save business drafts. Use synthetic details only.
          </p>
          <PublicLink href="/sign-up" className="btn btn-primary mt-6">
            Open a workspace
          </PublicLink>
        </div>
        <div className="surface p-7">
          <p className="eyebrow">Payments</p>
          <PaymentsStatus live={status.ok ? status.data.livePaymentsEnabled : null} />
          <p className="mt-3 text-muted-foreground">
            Live payments are not enabled. Plans will be published here after commercial terms are approved.
          </p>
          <button className="btn btn-ghost mt-6" disabled aria-disabled="true" data-testid="button-checkout">
            Checkout unavailable
          </button>
        </div>
      </div>
    </div>
  );
}
