import { Link } from 'wouter';
import { useGetBuildStatus } from '@workspace/api-client-react';
import { PageHeader, Skel } from '@/components/states';

export default function Pricing() {
  const s = useGetBuildStatus();
  return (
    <div className="mx-auto max-w-5xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Pricing" title="Prices have not been set.">
        We will not show a number until it is final. There is no checkout, and no card is ever asked for in this build.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-7">
          <p className="eyebrow">Today</p>
          <p className="font-display mt-3 text-3xl">Drafting workspace</p>
          <p className="mt-3 text-muted-foreground">Open a development workspace to write and save business drafts. Use synthetic details only.</p>
          <Link href="/sign-up" className="btn btn-primary mt-6">Open a workspace</Link>
        </div>
        <div className="surface p-7">
          <p className="eyebrow">Payments</p>
          {s.isLoading ? <Skel className="mt-3 h-8 w-40" /> : (
            <p className="font-display mt-3 text-3xl" data-testid="text-payments-status">{s.data?.livePaymentsEnabled ? 'Enabled' : 'Switched off'}</p>
          )}
          <p className="mt-3 text-muted-foreground">Live payments are not enabled. Plans will be published here after commercial terms are approved.</p>
          <button className="btn btn-ghost mt-6" disabled aria-disabled="true" data-testid="button-checkout">Checkout unavailable</button>
        </div>
      </div>
    </div>
  );
}
