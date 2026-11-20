import type { ReactNode } from "react";
import { ArrowRight, FileText, Scale } from "lucide-react";
import type { BuildStatus } from "@workspace/api-client-react";
import { GetBuildStatusResponse } from "@workspace/api-zod";
import { Skel } from "@/components/page-parts";
import { PublicLink as Link } from "@/components/public-link";
import { SignedInRedirect } from "@/islands/signed-in-redirect";
import { readForPage } from "@/server/page-api";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/");

/**
 * The home page, which the server renders for everyone (decision 0011, point 7). A signed-in visitor
 * sees it for a moment, then goes on to the workspace once the identity provider has loaded. The
 * catalogue's template count shows when the server could read it.
 */
export default async function Home() {
  const status = await readForPage<BuildStatus>("/public/status", GetBuildStatusResponse);
  const s = status.ok ? status.data : undefined;
  return (
    <div>
      <SignedInRedirect />
      <section className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:pt-20 lg:px-8">
        <p className="eyebrow reveal">For owners of Nigerian small businesses</p>
        <h1
          className="font-display reveal reveal-2 mt-5 max-w-5xl text-[2.6rem] leading-[1.04] sm:text-6xl lg:text-[5.2rem]"
          data-testid="text-headline"
        >
          The documents you need.{" "}
          <span className="italic text-primary">The business rules you should know.</span>
        </h1>
        <p className="reveal reveal-3 mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          A private workspace for invoices, quotations and everyday business documents, alongside guidance
          that appears only when it traces back to an official source. Neither pretends to be the other.
        </p>

        <div className="reveal reveal-4 mt-12 grid gap-4 md:grid-cols-2">
          <Shelf
            icon={<FileText className="h-5 w-5" />}
            label="Shelf one"
            title="Business documents"
            body="Write and save your own drafts in a private workspace, with every save kept as a revision you can return to."
            meta={
              <>
                <span className="pill pill-forest">
                  <span className="dot" /> Private drafting and export
                </span>
                {s && s.publishedTemplates > 0 && (
                  <span className="pill pill-ink">{s.publishedTemplates} catalogue templates</span>
                )}
              </>
            }
            href="/sign-up"
            cta="Start a business draft"
            tone="forest"
            testid="documents"
          />
          <Shelf
            icon={<Scale className="h-5 w-5" />}
            label="Shelf two"
            title="Compliance guidance"
            body="Answer a few questions about your business and see which official routes may apply. Published guidance always names its source."
            meta={
              <>
                <span className="pill pill-ink">
                  <span className="dot" /> Requirements checker
                </span>
                <span className="pill pill-ink">Sources shown</span>
              </>
            }
            href="/checker"
            cta="Check what may apply"
            tone="ink"
            testid="compliance"
          />
        </div>
      </section>

      <section className="border-y border-border bg-sidebar">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="eyebrow">Why two shelves</p>
            <h2 className="font-display mt-3 text-4xl leading-tight">
              A draft is not a rule. We will not blur the line.
            </h2>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border">
            {[
              [
                "Your drafts are labelled as yours",
                'Everything you write is marked "business draft". It is not a released template, and nobody at Valo or any AI has reviewed it.',
              ],
              [
                "Guidance waits for its source",
                "A rule appears only when it links to the official text it came from. Nothing unreviewed is published to fill space.",
              ],
              [
                "Gaps are stated, not hidden",
                "Where Valo has nothing checked to say, the page says so and points to the official authority instead.",
              ],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-5 bg-card p-6">
                <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="eyebrow">Inside the workspace</p>
            <h2 className="font-display mt-3 text-4xl leading-tight">
              A quiet place to write, save and undo.
            </h2>
            <ul className="mt-8 grid gap-5 text-[0.98rem]">
              {[
                [
                  "Business profile",
                  'Legal form, registration, activities, state and LGA. Every answer allows "unknown" or "not yet answered".',
                ],
                [
                  "Section editor",
                  "Paragraphs, lists and key fields with autosave. Missing details are flagged, not invented.",
                ],
                [
                  "Revision history",
                  "Restoring an old version creates a new revision. History is never overwritten.",
                ],
                [
                  "Exports",
                  "Export your own drafts to PDF or Word from the editor. Each file is marked as a business draft.",
                ],
              ].map(([t, b]) => (
                <li
                  key={t}
                  className="grid grid-cols-[9rem_1fr] gap-4 border-t border-border pt-5 max-sm:grid-cols-1 max-sm:gap-1"
                >
                  <span className="font-medium">{t}</span>
                  <span className="text-muted-foreground leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <DraftSpecimen />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-24 lg:px-8">
        <div className="surface grid gap-6 p-8 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <p className="eyebrow">Before you begin</p>
            <p className="font-display mt-3 text-3xl leading-snug" data-testid="text-home-status">
              Valo is still being built. Use test details only.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              There are no payments, no professional services and no regulator endorsement. What works today:
              private drafts, exports of your own drafts, the requirements checker, tasks and reminders.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Link href="/about" className="btn btn-ghost">
              How Valo works <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="btn btn-ghost">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Shelf(props: {
  icon: ReactNode;
  label: string;
  title: string;
  body: string;
  meta: ReactNode;
  href: string;
  cta: string;
  tone: "forest" | "ink";
  testid: string;
}) {
  return (
    <article
      className="surface group relative flex flex-col overflow-hidden p-7 transition-shadow hover:shadow-[var(--shadow-lg)] sm:p-9"
      data-testid={"card-shelf-" + props.testid}
    >
      <div
        className={
          "absolute inset-x-0 top-0 h-1 " + (props.tone === "forest" ? "bg-primary" : "bg-foreground")
        }
      />
      <div className="flex items-center justify-between">
        <span
          className={
            "grid h-11 w-11 place-items-center rounded-full " +
            (props.tone === "forest" ? "bg-accent text-primary" : "bg-secondary text-foreground")
          }
        >
          {props.icon}
        </span>
        <span className="eyebrow">{props.label}</span>
      </div>
      <h2 className="font-display mt-8 text-3xl sm:text-4xl">{props.title}</h2>
      <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">{props.body}</p>
      <div className="mt-6 flex min-h-7 flex-wrap gap-2">{props.meta ?? <Skel className="h-6 w-48" />}</div>
      <div className="mt-8 pt-2">
        <Link
          href={props.href}
          className={"btn " + (props.tone === "forest" ? "btn-primary" : "btn-ink")}
          data-testid={"link-hero-" + props.testid}
        >
          {props.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}

function DraftSpecimen() {
  return (
    <figure aria-label="Illustration of the draft editor" className="relative">
      <div className="surface rotate-[-1.2deg] p-7 shadow-[var(--shadow-xl)]">
        <div className="flex items-center justify-between">
          <span className="pill pill-ink">Business draft</span>
          <span className="font-mono text-xs text-muted-foreground">rev 3 · saved</span>
        </div>
        <div className="mt-6 h-6 w-2/3 rounded bg-foreground/85" />
        <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-border p-3">
            <p className="eyebrow">Issued by</p>
            <div className="mt-2 h-2.5 w-3/4 rounded bg-muted" />
          </div>
          <div className="rounded-lg border border-dashed border-[hsl(38_50%_70%)] bg-[hsl(var(--ochre-soft))] p-3">
            <p className="eyebrow">Due date</p>
            <p className="mt-1.5 text-[hsl(38_60%_28%)]">Missing</p>
          </div>
        </div>
        <div className="mt-6 grid gap-2.5">
          {[100, 94, 97, 60].map((w, i) => (
            <div key={i} className="h-2.5 rounded bg-muted" style={{ width: w + "%" }} />
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <span className="pill pill-forest">Undo</span>
          <span className="pill pill-ink">Export draft</span>
        </div>
      </div>
      <figcaption className="mt-6 text-center text-xs text-muted-foreground">
        Illustration of the editor. Not a sample document.
      </figcaption>
    </figure>
  );
}
