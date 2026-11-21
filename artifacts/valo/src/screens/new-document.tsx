import { Link } from "wouter";
import { ArrowRight, FilePlus2, Loader2, Sparkles } from "lucide-react";
import { GuidedDraftStarter } from "@/components/guided-draft-starter";
import { Notice } from "@/components/states";
import { WorkspaceNav } from "@/components/workspace-nav";
import { describeError } from "@/lib/api";
import { useNewDocument } from "@/lib/use-new-document";

/**
 * The one place a document starts: the everyday documents Valo asks questions for, a blank page,
 * and the drafting assistant. The home screen and the documents screen each lead here.
 */
export default function NewDocumentPage() {
  const blank = useNewDocument();
  const way =
    "surface group flex h-full w-full items-center gap-4 p-5 text-left transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal max-w-3xl">
        <p className="eyebrow">Documents</p>
        <h1 className="font-display mt-2 text-4xl sm:text-5xl">New document</h1>
      </header>
      <div className="mt-10">
        <GuidedDraftStarter />
      </div>
      <section className="mt-12" aria-labelledby="other-ways-title">
        <h2 id="other-ways-title" className="font-display text-2xl">
          Other ways to start
        </h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          <li>
            <button
              type="button"
              className={way + " disabled:cursor-not-allowed disabled:opacity-60"}
              onClick={blank.start}
              disabled={blank.pending}
              data-testid="button-new-draft"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                {blank.pending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <FilePlus2 className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Blank document</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  An empty page that you write yourself.
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          </li>
          <li>
            <Link href="/workspace/ai" className={way} data-testid="link-ai-drafting">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Drafting assistant</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  Give your details for an invoice, quotation, payment reminder or business proposal, and AI
                  writes a first version for you to check.
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        </ul>
        {blank.error && (
          <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {describeError(blank.error).message}
          </p>
        )}
      </section>
      <Notice className="mt-10" tone="ink" title="These are your own documents">
        Nobody at Valo reviews what you write here. A document you make is not a published Valo template, and
        making one is not proof of a payment or a signature. Please use made-up details only for now.
      </Notice>
    </div>
  );
}
