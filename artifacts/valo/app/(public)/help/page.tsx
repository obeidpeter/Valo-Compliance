import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { HelpFilter } from "@/islands/help-filter";
import { fixedPageMetadata } from "@/server/page-metadata";

/** A link inside an answer. */
function To({ href, children }: { href: string; children: ReactNode }) {
  return (
    <PublicLink href={href} className="text-primary underline underline-offset-4">
      {children}
    </PublicLink>
  );
}

/** The questions, grouped by what the visitor is trying to do. Every answer is true of this build. */
const GROUPS: { title: string; questions: [question: string, answer: ReactNode][] }[] = [
  {
    title: "Making a document",
    questions: [
      [
        "How do I make a document?",
        <>
          Sign in and choose "New document". Pick one of the twelve everyday documents, such as an invoice, a
          quotation or a receipt, and answer its questions. Or start with a blank document. Valo saves the
          document as you work, and shows when it has.
        </>,
      ],
      [
        "Does anyone at Valo check a document I write?",
        'No. A document you write is your own. It is marked "Draft", nobody at Valo reviews it, and it does not tell you what the law requires.',
      ],
      [
        "Can I download my document as a PDF or Word file?",
        "Yes. Open the document in your workspace and go to its download section, where you can make a Word file or a PDF. The file is made from your own saved text, and every page is marked as a draft. A blank copy of a template can be downloaded only where the template is listed under Documents.",
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
        "Why is the list of documents or guides empty?",
        "A template or guide is listed only once it is published with its sources. Until then the page says so. You can still write a document of your own, or check your requirements.",
      ],
    ],
  },
  {
    title: "Checking your requirements",
    questions: [
      [
        "How do I find out which requirements may apply to my business?",
        <>
          Open <To href="/checker">Check requirements</To> and answer the questions about your business. You
          do not need an account. If you are not sure of an answer, choose "I do not know". Valo then shows
          what its published rules say for your answers, and why, with the official source. Where no published
          rule covers your answers, the page says so. That does not mean you are exempt.
        </>,
      ],
      [
        "Is this legal, tax or accounting advice?",
        "No. Valo gives general information with its sources, and tools for writing your own documents. It does not provide legal, tax or accounting advice, and no regulator endorses it.",
      ],
    ],
  },
  {
    title: "Dates and reminders",
    questions: [
      ["What time zone are dates and times in?", "Lagos time, wherever you are."],
      [
        "Will Valo remind me about a due date?",
        "Only if you turn reminders on, and only for a task with a due date you have confirmed. Valo does not send reminder emails to customers yet. You can save your choices now, and the Reminders page shows what has happened to each reminder.",
      ],
    ],
  },
  {
    title: "Your account and your data",
    questions: [
      [
        "I cannot sign in, or my email is not verified.",
        <>
          Use "Forgot password" on the sign-in screen, or finish the email verification step. If your account
          is suspended or you are still stuck, use <To href="/account-access">Trouble signing in</To>, which
          works without signing in.
        </>,
      ],
      [
        "How do I get a copy of my data, or ask for it to be corrected or deleted?",
        'Sign in and choose "Privacy and data". It is in the account menu at the top of the page, and in the menu on a phone. There you can download a copy of your workspace data and save a correction or deletion request for staff.',
      ],
      [
        "Should I enter real business information?",
        "Not yet. Valo is still being built, so please use made-up details only.",
      ],
    ],
  },
  {
    title: "Getting help",
    questions: [
      [
        "Where do I read the reply to a request I sent?",
        <>
          Sign in and open <To href="/support">Report a problem</To>. Your requests are listed under the form,
          each with any reply from staff. Valo does not email replies yet.
        </>,
      ],
    ],
  },
];

export const generateMetadata = () => fixedPageMetadata("/help");

/** Each group with its heading's id and the number of its first question on the page. */
const NUMBERED = GROUPS.map((group, index) => ({
  ...group,
  id: "help-" + group.title.replaceAll(" ", "-").toLowerCase(),
  first: GROUPS.slice(0, index).reduce((count, earlier) => count + earlier.questions.length, 0),
}));

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
      <HelpFilter total={GROUPS.reduce((sum, group) => sum + group.questions.length, 0)} />
      <div className="grid gap-10">
        {NUMBERED.map((group) => (
          <section key={group.id} aria-labelledby={group.id} data-help-group={group.id}>
            <h2 id={group.id} className="font-display text-2xl">
              {group.title}
            </h2>
            <div className="mt-3 divide-y divide-border border-y border-border">
              {group.questions.map(([question, answer], index) => (
                <details key={question} className="group py-5" data-testid={"faq-" + (group.first + index)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
                    {question}
                    <span
                      aria-hidden="true"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-sm transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
