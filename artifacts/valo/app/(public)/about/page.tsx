import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { fixedPageMetadata } from "@/server/page-metadata";

const WORKS = [
  [
    "Private business drafts",
    "Write invoices, quotations, reminders and proposals in a private editor with revision history. Export your own drafts to PDF or Word.",
  ],
  [
    "Requirements checker",
    "Answer questions about your business. Each result says why it may apply, what is missing, and links to the official source.",
  ],
  [
    "Tasks and reminders",
    "Turn checker results into your own tasks with dates you confirm. Reminder preferences are saved; delivery depends on a configured channel.",
  ],
  [
    "Draft assistant",
    "Optional help shaping a first draft from your own details. You review everything before it becomes a document.",
  ],
];
const NOT = [
  "Legal, tax or accounting advice, or a substitute for it.",
  "Professional review of your documents. Private business drafts are not professional advice or certified legal documents.",
  "Payments, subscriptions or bookings. None are enabled.",
  "Endorsement by any regulator or government body.",
];

export const generateMetadata = () => fixedPageMetadata("/about");

export default function About() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="About Valo" title="Two shelves, kept apart on purpose.">
        Valo is a private workspace for the documents a Nigerian small business writes every week, alongside
        guidance that is shown only when it traces back to official text.
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
            <p className="font-medium">Still in development</p>
            <p className="mt-1 text-muted-foreground">
              Please use synthetic test details only. The public catalogue grows only when an item can name
              its sources; empty pages say so rather than fill space.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <PublicLink href="/sign-up" className="btn btn-primary">
              Open a workspace <ArrowRight className="h-4 w-4" />
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
