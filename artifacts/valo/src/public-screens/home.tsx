import type { ComponentType, ReactNode } from "react";
import {
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  Info,
  Link2,
  Lock,
  Package,
  PenLine,
  ReceiptText,
  Truck,
  UserPlus,
} from "lucide-react";
import { PublicLink as Link } from "@/components/public-link";
import { formatCount, formatDay, formatNaira } from "@/lib/format";
import { landingTasks, type LandingTask } from "@/lib/landing-tasks";
import { ANY_DOCUMENT, signUpFor } from "@/lib/start";

/**
 * The landing page: what a visitor can do, an example of each, the everyday tasks, how it works, why
 * it can be relied on, and short answers. Every claim is true of this build as it stands. The tasks
 * come from the documents the workspace can start today, and the count of ready-made templates is
 * shown only when the server could read it. The two examples carry made-up details and say so; the
 * requirement example shows what a result holds without naming a real rule or authority, because
 * guidance is published only through its own checks.
 */
const WRAP = "mx-auto max-w-7xl px-5 lg:px-8";
const H2 = "font-display text-3xl leading-tight sm:text-4xl";
const SUB = "mt-2 text-lg text-muted-foreground";
/** The two actions, written the same way wherever the page offers them. */
const DOCUMENTS = { href: signUpFor(ANY_DOCUMENT), label: "Create a document" };
const REQUIREMENTS = { href: "/checker", label: "Check my requirements" };
/** A large button whose words may wrap, so it fits the narrowest phone. */
const BIG = "btn min-h-12 whitespace-normal px-6 py-2 text-center text-base leading-tight";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
const TASK_ICONS: Record<string, Icon> = {
  invoice: FileText,
  quotation: Calculator,
  receipt: ReceiptText,
  reminder: Clock,
  order: Package,
  delivery: Truck,
  hire: UserPlus,
  agreement: PenLine,
};

export function Home({ templates }: { templates: number | undefined }) {
  const tasks = landingTasks();
  return (
    <div>
      <Hero />
      <Tasks tasks={tasks} templates={templates} />
      <HowItWorks />
      <Reliance />
      <Questions />
      <Closing />
    </div>
  );
}

function Hero() {
  return (
    <section
      className={
        WRAP +
        " grid items-center gap-10 pb-14 pt-10 sm:pt-14 lg:grid-cols-[1.14fr_0.86fr] lg:gap-14 lg:pb-20 lg:pt-16"
      }
    >
      <div className="min-w-0">
        <p className="eyebrow">For Nigerian small businesses</p>
        <h1
          className="font-display mt-4 text-[2.25rem] leading-[1.06] sm:text-5xl xl:text-[3.5rem]"
          data-testid="text-headline"
        >
          Make your business documents. <span className="block text-primary">Know which rules apply.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Create invoices, quotations, receipts and agreements by answering a few questions. Then check which
          registrations and rules may apply to your business, each with the official source it comes from.
        </p>
        <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap">
          <Link href={DOCUMENTS.href} className={BIG + " btn-primary"} data-testid="link-hero-documents">
            {DOCUMENTS.label} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href={REQUIREMENTS.href} className={BIG + " btn-ink"} data-testid="link-hero-compliance">
            {REQUIREMENTS.label} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ul className="mt-6 grid gap-2 text-sm text-muted-foreground sm:flex sm:flex-wrap sm:gap-x-5">
          {["Private to your account", "Download as PDF or Word", "Every rule shows its source"].map(
            (fact) => (
              <li key={fact} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> {fact}
              </li>
            ),
          )}
        </ul>
      </div>
      <Examples />
    </section>
  );
}

/** A document and a requirement result as Valo shows them, with made-up details. The cards are a
 * picture: a screen reader is told what they show by the caption, not read every cell. */
function Examples() {
  const lines = [
    { what: "Product or service", quantity: 2, price: 1_500_000 },
    { what: "Delivery", quantity: 1, price: 350_000 },
  ];
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  // The price column, where the paper has room for four columns: not on a phone, and not beside the
  // headline until the screen is wide.
  const PRICE = "hidden pl-3 text-right sm:table-cell lg:max-xl:hidden";
  return (
    <figure className="mx-auto w-full min-w-0 max-w-md lg:max-w-none" data-testid="figure-examples">
      <div className="relative lg:pb-48 lg:pl-10" aria-hidden>
        <div className="rounded-2xl border border-border bg-white p-5 shadow-[var(--shadow-xl)] sm:p-7 lg:rotate-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">Your Business Ltd</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                12 Example Road, Ikeja, Lagos
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl leading-none tracking-wide sm:text-3xl">INVOICE</p>
              <p className="mt-1.5 text-xs text-muted-foreground">INV-0007</p>
            </div>
          </div>
          {/* The narrowest phones have room for two of the three. */}
          <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-border py-3 text-xs text-muted-foreground sm:grid-cols-3">
            {[
              ["Bill to", "Your customer"],
              ["Issued", formatDay("2026-11-18")],
              ["Due", formatDay("2026-12-02")],
            ].map(([label, value], index) => (
              <div key={label} className={index === 2 ? "hidden sm:block" : undefined}>
                <dt>{label}</dt>
                <dd className="mt-0.5 text-[0.82rem] font-semibold text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <table className="mt-3 w-full text-[0.82rem]">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Description</th>
                <th className="py-1.5 pl-3 text-right font-medium">Qty</th>
                <th className={PRICE + " py-1.5 font-medium"}>Price</th>
                <th className="py-1.5 pl-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.what} className="border-b border-border/60">
                  <td className="py-2">{line.what}</td>
                  <td className="py-2 pl-3 text-right">{line.quantity}</td>
                  <td className={PRICE + " py-2"}>{formatNaira(line.price)}</td>
                  <td className="py-2 pl-3 text-right">{formatNaira(line.quantity * line.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex justify-end gap-6 font-bold">
            <span>Total</span>
            <span>{formatNaira(total)}</span>
          </p>
          <p className="mt-4 flex items-center justify-end gap-2">
            <span className="pill pill-forest">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
            <span className="pill pill-ink">PDF</span>
            <span className="pill pill-ink">Word</span>
          </p>
        </div>
        <div className="surface relative z-10 mx-4 -mt-5 p-5 shadow-[var(--shadow-lg)] lg:absolute lg:bottom-0 lg:left-0 lg:mx-0 lg:mt-0 lg:w-72">
          <span className="pill pill-ochre">May apply</span>
          <p className="font-display mt-2 text-xl leading-tight">The name of the requirement</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Why: the answers you gave that it depends on.
          </p>
          <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Source: <span className="font-semibold text-primary">the official text</span>, and the date it
              was last checked
            </span>
          </p>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs text-muted-foreground lg:text-right">
        Examples with made-up details: an invoice, and what a requirement result tells you.
      </figcaption>
    </figure>
  );
}

function Tasks({ tasks, templates }: { tasks: LandingTask[]; templates: number | undefined }) {
  return (
    <section className="border-y border-border bg-sidebar" aria-labelledby="home-tasks">
      <div className={WRAP + " py-14 lg:py-20"}>
        <h2 id="home-tasks" className={H2}>
          What do you need to do today?
        </h2>
        <p className={SUB}>Choose one. After you create your account, you start on it.</p>
        <ul className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="list-tasks">
          {tasks.map((task) => {
            const TaskIcon = TASK_ICONS[task.id] ?? FileText;
            return (
              <li key={task.id}>
                <Link
                  href={signUpFor(task.id)}
                  className="surface group flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-5"
                  data-testid={"link-task-" + task.id}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
                    <TaskIcon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="flex items-center justify-between gap-2 font-semibold leading-snug">
                    {task.task}
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                  <span className="-mt-1.5 text-sm text-muted-foreground">{task.with}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-col gap-4 rounded-2xl bg-foreground p-5 text-background sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div className="flex items-start gap-4 sm:items-center">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background/10">
              <ClipboardCheck className="h-5 w-5" aria-hidden />
            </span>
            <p>
              <span className="block text-lg font-semibold leading-snug">
                Not sure what your business needs to register for?
              </span>
              <span className="mt-0.5 block text-background/75">
                Answer a few questions and see what may apply, and why.
              </span>
            </p>
          </div>
          <Link
            href={REQUIREMENTS.href}
            className="btn shrink-0 whitespace-normal bg-background py-2 text-center leading-tight text-foreground hover:bg-secondary"
            data-testid="link-tasks-compliance"
          >
            {REQUIREMENTS.label} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {templates !== undefined && templates > 0 && (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="text-template-count">
            {templates === 1
              ? "There is also 1 ready-made template to start from. "
              : `There are also ${formatCount(templates)} ready-made templates to start from. `}
            <Link href="/library" className="font-medium text-primary underline underline-offset-4">
              Browse documents
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

function HowItWorks() {
  const ways: { title: string; icon: ReactNode; tone: string; mark: string; steps: [string, string][] }[] = [
    {
      title: "Documents",
      icon: <FileText className="h-5 w-5" aria-hidden />,
      tone: "bg-primary",
      mark: "bg-accent text-primary",
      steps: [
        ["Choose a document", "Invoice, quotation, receipt, agreement and more."],
        ["Answer a few questions", "We flag anything missing. We never make details up."],
        ["Download as PDF or Word", "Change it any time. Every version is kept."],
      ],
    },
    {
      title: "Requirements",
      icon: <ClipboardCheck className="h-5 w-5" aria-hidden />,
      tone: "bg-foreground",
      mark: "bg-secondary text-foreground",
      steps: [
        ["Tell us about your business", "Skip anything you do not know."],
        ["See what may apply, and why", "Each result names the official source it comes from."],
        ["Save it as a task", "Add a date, and tick it off when it is done."],
      ],
    },
  ];
  return (
    <section className={WRAP + " py-14 lg:py-20"} aria-labelledby="home-how">
      <h2 id="home-how" className={H2}>
        How it works
      </h2>
      <p className={SUB}>Two things you can do, three steps each.</p>
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {ways.map((way) => (
          <article key={way.title} className="surface relative overflow-hidden p-6 pb-2 sm:p-7 sm:pb-3">
            <div className={"absolute inset-x-0 top-0 h-1 " + way.tone} />
            <h3 className="font-display flex items-center gap-3 text-2xl">
              <span className={"grid h-9 w-9 place-items-center rounded-full " + way.mark}>{way.icon}</span>
              {way.title}
            </h3>
            <ol className="mt-4">
              {way.steps.map(([step, detail], index) => (
                <li key={step} className="grid grid-cols-[2rem_1fr] gap-3.5 border-t border-border py-4">
                  <span
                    className="grid h-7 w-7 place-items-center rounded-full border border-border text-sm font-semibold text-muted-foreground"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-semibold">{step}</span>
                    <span className="text-[0.95rem] text-muted-foreground">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

function Reliance() {
  const reasons: [Icon, string, string][] = [
    [
      Link2,
      "Every rule shows its source",
      "Guidance names the official text it comes from, with the date it was last checked.",
    ],
    [
      Lock,
      "Your documents stay yours",
      "They are kept in your own workspace. Every save is kept too, so you can always go back.",
    ],
    [
      Info,
      "We say when we do not know",
      "If we have nothing checked on a topic, we tell you and point you to the right authority.",
    ],
  ];
  return (
    <section className="border-y border-border bg-sidebar" aria-labelledby="home-rely">
      <div className={WRAP + " py-14 lg:py-20"}>
        <h2 id="home-rely" className={H2}>
          Why you can rely on it
        </h2>
        <div className="mt-8 grid gap-7 md:grid-cols-3 md:gap-6">
          {reasons.map(([ReasonIcon, title, body]) => (
            <div key={title}>
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-primary">
                <ReasonIcon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <p
          className="mt-9 rounded-2xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-5 py-4 text-[0.95rem] leading-relaxed text-[hsl(var(--ochre-foreground))]"
          data-testid="text-good-to-know"
        >
          <strong className="font-semibold">Good to know.</strong> Valo is not legal, tax or accounting
          advice, and no regulator endorses it. A document you make is your own draft, and nobody at Valo
          reviews it. Templates and guidance are drafted and reviewed by AI, not by a Nigerian legal, tax or
          sector specialist.{" "}
          <Link href="/about" className="whitespace-nowrap font-medium underline underline-offset-4">
            How Valo works
          </Link>
        </p>
      </div>
    </section>
  );
}

function Questions() {
  const answers: [string, ReactNode][] = [
    [
      "What can I do with Valo today?",
      "Make business documents and download them, check which requirements may apply to your business, and keep a list of tasks. Valo has not launched, so please use made-up details for now.",
    ],
    [
      "Is this legal advice?",
      "No. Valo is not legal, tax or accounting advice, and no regulator endorses it. For a decision that matters, ask a qualified professional or the authority itself.",
    ],
    [
      "Who checks the guidance?",
      "AI drafts and reviews it against official sources, and each entry names the source it comes from. No Nigerian legal, tax or sector specialist has reviewed it.",
    ],
    [
      "Who can see my documents?",
      <>
        They are kept in your own workspace, where other customers cannot see them.{" "}
        <Link href="/privacy" className="font-medium text-primary underline underline-offset-4">
          What Valo stores
        </Link>
      </>,
    ],
    [
      "What does it cost?",
      <>
        Prices have not been set, and nothing can be bought yet.{" "}
        <Link href="/pricing" className="font-medium text-primary underline underline-offset-4">
          Pricing
        </Link>
      </>,
    ],
  ];
  return (
    <section
      className={WRAP + " grid gap-8 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14 lg:py-20"}
      aria-labelledby="home-questions"
    >
      <div>
        <h2 id="home-questions" className={H2}>
          Questions people ask
        </h2>
        <p className={SUB}>
          Short answers.{" "}
          <Link href="/help" className="font-medium text-primary underline underline-offset-4">
            The Help page has more
          </Link>
          .
        </p>
      </div>
      <div className="surface divide-y divide-border overflow-hidden" data-testid="list-questions">
        {answers.map(([question, answer], index) => (
          <details key={question} className="group" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              {question}
              <ChevronDown
                className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="max-w-prose px-5 pb-5 text-[0.95rem] leading-relaxed text-muted-foreground">
              {answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className={WRAP + " pb-10 lg:pb-20"} aria-labelledby="home-start">
      <div className="flex flex-col gap-7 rounded-3xl bg-primary px-6 py-9 text-primary-foreground sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:px-14">
        <div>
          <h2 id="home-start" className="font-display text-3xl leading-tight sm:text-4xl">
            Start with your first document.
          </h2>
          <p className="mt-2 text-lg text-primary-foreground/80">
            Or find out which requirements may apply to your business.
          </p>
        </div>
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <Link
            href={DOCUMENTS.href}
            className={BIG + " bg-background text-[hsl(155_42%_14%)] hover:bg-secondary dark:text-foreground"}
            data-testid="link-closing-documents"
          >
            {DOCUMENTS.label}
          </Link>
          <Link
            href={REQUIREMENTS.href}
            className={
              BIG +
              " border border-primary-foreground/55 text-primary-foreground hover:bg-primary-foreground/10"
            }
            data-testid="link-closing-compliance"
          >
            {REQUIREMENTS.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
