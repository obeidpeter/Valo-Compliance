import { Link } from 'wouter';
import { PageHeader } from '@/components/states';

const QA = [
  ['Is a draft I write a legal template?', 'No. Drafts you write are labelled "business draft". They are not released templates and have not been reviewed by Valo, a professional or an AI.'],
  ['Why is the library empty?', 'Templates appear only after source and rights review. Baseline templates are held until that is done.'],
  ['Can I download my draft as PDF or Word?', 'Not yet. Export needs a private renderer and verified storage that are still being built. The button explains this rather than pretending.'],
  ['What happens if I edit in two tabs?', 'Each save checks the revision you started from. If another tab saved first, Valo keeps your unsaved text and asks how to proceed.'],
  ['Does restoring an old revision delete newer ones?', 'No. Restoring saves the old content as a brand new revision. History is never overwritten.'],
  ['I cannot sign in or my email is not verified.', 'Use "Forgot password" on the sign-in screen, or finish the email verification step. If your account is suspended, contact support.'],
  ['Should I enter real business information?', 'Not during development. Please use synthetic test details only.'],
];

export default function Help() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Help" title="Straight answers">Still stuck? <Link href="/support" className="text-primary underline underline-offset-4">Save a support request</Link>.</PageHeader>
      <div className="divide-y divide-border border-y border-border">
        {QA.map(([q, a], i) => (
          <details key={q} className="group py-5" data-testid={'faq-' + i}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
              {q}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-sm transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
