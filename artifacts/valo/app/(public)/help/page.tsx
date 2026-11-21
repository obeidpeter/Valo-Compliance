import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { fixedPageMetadata } from "@/server/page-metadata";

const QA = [
  [
    "Does anyone at Valo check a document I write?",
    'No. A document you write is your own. It is labelled "business draft", nobody at Valo reviews it, and it does not tell you what the law requires.',
  ],
  [
    "Why is the list of documents or guides empty?",
    "A template or guide is listed only once it is published with its sources. Until then the page says so. You can still write a document of your own, or check your requirements.",
  ],
  [
    "Can I download my document as a PDF or Word file?",
    "Yes. Open the document in your workspace and go to its download section, where you can create a Word or PDF file. The file is made from your own saved text, and every page is marked as a business draft. A blank copy of a template can be downloaded only where the template is listed under Documents.",
  ],
  [
    "How do I get a copy of my data, or ask for it to be corrected or deleted?",
    'Sign in and choose "Privacy and data". It is in the account menu at the top of the page, and in the menu on a phone. There you can download a copy of your workspace data and save a correction or deletion request for staff.',
  ],
  [
    "What happens if I edit the same document in two tabs?",
    "Valo notices when another tab has saved the document first. It keeps your unsaved text and asks what you want to do.",
  ],
  [
    "Does restoring an earlier version of a document delete the later ones?",
    "No. Restoring saves the earlier text again as the newest version. Nothing in the history is overwritten.",
  ],
  [
    "I cannot sign in, or my email is not verified.",
    'Use "Forgot password" on the sign-in screen, or finish the email verification step. If your account is suspended or you are still stuck, use the "Trouble signing in" page, which works without signing in.',
  ],
  [
    "Should I enter real business information?",
    "Not yet. Valo is still being built, so please use made-up details only.",
  ],
];

export const generateMetadata = () => fixedPageMetadata("/help");

export default function Help() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Help" title="Questions and answers">
        Cannot sign in?{" "}
        <PublicLink href="/account-access" className="text-primary underline underline-offset-4">
          Trouble signing in
        </PublicLink>
        . Something not working?{" "}
        <PublicLink href="/support" className="text-primary underline underline-offset-4">
          Report a problem
        </PublicLink>
        . Anything else?{" "}
        <PublicLink href="/contact" className="text-primary underline underline-offset-4">
          Contact us
        </PublicLink>
        .
      </PageHeader>
      <div className="divide-y divide-border border-y border-border">
        {QA.map(([q, a], i) => (
          <details key={q} className="group py-5" data-testid={"faq-" + i}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
              {q}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-sm transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
