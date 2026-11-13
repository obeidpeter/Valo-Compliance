import { Notice, PageHeader } from '@/components/states';

export default function Terms() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Terms" title="Terms of use, not yet approved" />
      <Notice title="Development notice">These are working notes for a development build. They have not been approved by Valo's owners or legal advisers, and they are not final terms terms.</Notice>
      <div className="mt-10 grid gap-8">
        {[["Not advice","Valo does not provide legal, tax, accounting or regulatory advice. Drafts you write are your own and unreviewed."],["Commercial terms","Pricing, refunds and service levels have not been approved. Nothing is sold in this build."],["Availability","The service may change or be reset during development without notice."],["No endorsement","No regulator or professional body has reviewed or endorsed Valo."]].map(([h, b]: string[]) => (
          <section key={h}><h2 className="font-display text-2xl">{h}</h2><p className="mt-2 leading-relaxed text-muted-foreground">{b}</p></section>
        ))}
      </div>
    </div>
  );
}
