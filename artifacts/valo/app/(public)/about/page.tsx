import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { fixedPageMetadata } from "@/server/page-metadata";

const WORKS = [
  [
    "Your documents",
    "Make invoices, quotations, receipts and payment reminders in a private editor that keeps every earlier version. Download your own documents as PDF or Word files.",
  ],
  [
    "Requirements check",
    "Answer questions about your business. Each result says why it may apply and what is missing, and links to the official source.",
  ],
  [
    "Tasks and reminders",
    "Turn a result into a task of your own, with a date you confirm. You can save how you want to be reminded; the reminders screen says whether a reminder can be sent yet.",
  ],
  [
    "Drafting assistant",
    "Optional help from AI in writing a first version from your own details. It runs only when you ask for it and agree. You review everything before it becomes a document.",
  ],
];
const NOT = [
  "Legal, tax or accounting advice, or a substitute for it.",
  "A professional's review of your documents. A document you write is not professional advice or a certified legal document.",
  "A way to pay, subscribe or book. None of these is switched on.",
  "Endorsed by any regulator or government body.",
];

export const generateMetadata = () => fixedPageMetadata("/about");

export default function About() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="About Valo" title="Documents and guidance for Nigerian small businesses">
        Valo is a place to make the documents a small business in Nigeria writes every week, and to see which
        requirements may apply to it. Guidance is shown only when it can name the official text it comes from.
      </PageHeader>
      <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <p className="eyebrow">What works today</p>
          <ul className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-border bg-border">
            {WORKS.map(([t, b]) => (
              <li key={t} className="bg-card p-5">
                <p className="font-medium">{t}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{b}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <p className="eyebrow">What Valo is not</p>
          <ul className="mt-4 grid gap-3">
            {NOT.map((n) => (
              <li key={n} className="flex gap-3 border-t border-border pt-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--ochre))]" />
                {n}
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl border border-border bg-sidebar p-5 text-sm leading-relaxed">
            <p className="font-medium">Still being built</p>
            <p className="mt-1 text-muted-foreground">
              Please use made-up details only. A template or guide is listed only once it can name its
              sources, and a page with nothing to list says so.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <PublicLink href="/sign-up" className="btn btn-primary">
              Create account <ArrowRight className="h-4 w-4" />
            </PublicLink>
            <PublicLink href="/contact" className="btn btn-ghost">
              Contact us
            </PublicLink>
          </div>
        </section>
      </div>
    </div>
  );
}
