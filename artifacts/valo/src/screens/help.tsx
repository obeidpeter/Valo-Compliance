import { Link } from 'wouter';
import { PageHeader } from '@/components/states';

const QA = [
  ['Is a draft I write a legal template?', 'No. Drafts you write are labelled "business draft". Nobody at Valo reviews them, and they do not tell you what the law requires.'],
  ['Why is the library or resources page empty?', 'Items appear only when they are actually released with their sources. Until then the page says so, and you can still write a blank private draft or use the requirements checker.'],
  ['Can I download my draft as PDF or Word?', 'Yes. Open a draft in your workspace and use Export. Files are generated from your own text and marked as a business draft. Blank catalogue downloads exist only for items listed in the library.'],
  ['How do I get a copy of my data or ask for deletion?', 'Signed in, go to Workspace, then Privacy. You can download a JSON copy of your workspace data and save a correction or deletion request for staff.'],
  ['What happens if I edit in two tabs?', 'Each save checks the revision you started from. If another tab saved first, Valo keeps your unsaved text and asks how to proceed.'],
  ['Does restoring an old revision delete newer ones?', 'No. Restoring saves the old content as a brand new revision. History is never overwritten.'],
  ['I cannot sign in or my email is not verified.', 'Use "Forgot password" on the sign-in screen, or finish the email verification step. If your account is suspended or you are still stuck, use the account access page; it works without signing in.'],
  ['Should I enter real business information?', 'Not during development. Please use synthetic test details only.'],
];

export default function Help() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Help" title="Straight answers">Locked out? <Link href="/account-access" className="text-primary underline underline-offset-4">Account access help</Link>. Anything else? <Link href="/contact" className="text-primary underline underline-offset-4">Contact us</Link>.</PageHeader>
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
