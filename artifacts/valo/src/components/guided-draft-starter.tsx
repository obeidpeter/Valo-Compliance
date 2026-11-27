import { useLocation } from "wouter";
import { ArrowRight, Loader2 } from "lucide-react";
import { GUIDED_TEMPLATE_IDS, type GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { describeError } from "@/lib/api";
import { DOCUMENT_PURPOSES } from "@/lib/document-kinds";
import { savedBusinessName } from "@/lib/guided-prefill";
import type { LandingTask } from "@/lib/landing-tasks";
import { cn } from "@/lib/utils";
import { basePath } from "@/lib/env";
import { useStartGuided } from "@/hooks/use-start-guided";

/**
 * The documents the workspace asks questions for, each a button that starts one and opens its
 * editor. Every kind is in view with what it is for, so nothing has to be remembered or looked up.
 * `chosen` is the task a visitor picked before they had an account: its documents come first.
 */
export function GuidedDraftStarter({ chosen }: { chosen?: LandingTask | undefined }) {
  const [, navigate] = useLocation();
  const { start, starting, pending, workspace, formTemplates, error } = useStartGuided((doc) =>
    navigate("/workspace/documents/" + doc.id),
  );
  const businessName = savedBusinessName(workspace.data?.profile);
  const listed = new Set(formTemplates.data?.templates.map((t) => t.templateId));
  const toBuy = new Set(formTemplates.data?.needsPurchase);
  const tile =
    "surface group flex h-full w-full items-center gap-4 p-5 text-left transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";
  /** A document's name, what it is for, and, when it has one, its state: `prefix` tells the chosen
   * task's copy from the full list's. */
  const words = (id: GuidedTemplateId, prefix: string, state: string | null) => (
    <span className="min-w-0 flex-1">
      <span className="block font-medium">{GUIDED_SPECS_V1[id].title}</span>
      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
        {DOCUMENT_PURPOSES[id]}
      </span>
      {state && (
        <span
          className="mt-1.5 block text-xs font-medium text-foreground"
          data-testid={"state-" + prefix + id}
        >
          {state}
        </span>
      )}
    </span>
  );
  const arrow = (
    <ArrowRight
      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      aria-hidden="true"
    />
  );
  /** One document's button. `place` tells the chosen task's buttons from the full list's. */
  const kind = (id: GuidedTemplateId, place: "chosen" | "all") => {
    const prefix = place === "chosen" ? "chosen-" : "";
    // A premium template this workspace has not bought starts neither form: it leads to the template
    // in the library, where it can be bought, instead of to a refusal. The library is a public page,
    // served by the server: a full load (decision 0011).
    if (toBuy.has(id))
      return (
        <li key={id}>
          <a
            className={cn(tile, place === "chosen" && "border-primary")}
            href={`${basePath}/library?type=template&access=premium&q=${encodeURIComponent(GUIDED_SPECS_V1[id].title)}`}
            data-testid={"link-buy-" + prefix + id}
          >
            {words(id, prefix, "Buy the template first")}
            {arrow}
          </a>
        </li>
      );
    return (
      <li key={id}>
        <button
          type="button"
          className={cn(tile, place === "chosen" && "border-primary")}
          disabled={pending}
          onClick={() => start(id)}
          data-testid={(place === "chosen" ? "button-start-chosen-" : "button-start-") + id}
        >
          {words(id, prefix, listed.has(id) ? "Uses the template's own wording" : null)}
          {starting === id && pending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            arrow
          )}
        </button>
      </li>
    );
  };
  return (
    <div data-testid="guided-draft-starter">
      {chosen && (
        <section className="mb-12" aria-labelledby="chosen-task-title" data-testid="chosen-task">
          <p className="eyebrow">You chose</p>
          <h2 id="chosen-task-title" className="font-display mt-2 text-2xl">
            {chosen.task}
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {chosen.documents.length === 1
              ? "Start it here. Valo asks you its questions and sets the document out from your answers."
              : "Start with the one that fits. Valo asks you its questions and sets the document out from your answers."}
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chosen.documents.map((id) => kind(id, "chosen"))}
          </ul>
        </section>
      )}
      <section aria-labelledby="guided-start-title">
        <h2 id="guided-start-title" className="font-display text-2xl">
          {chosen ? "All everyday documents" : "Everyday documents"}
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Choose one. Valo asks you its questions and sets the document out from your answers.
          {businessName
            ? " Your saved business name is filled in for you; you can change it on the document."
            : ""}
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDED_TEMPLATE_IDS.map((id) => kind(id, "all"))}
        </ul>
      </section>
      <p role="status" className="sr-only">
        {starting && pending ? `Starting your ${GUIDED_SPECS_V1[starting].title.toLowerCase()}…` : ""}
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(error).message}
        </p>
      )}
    </div>
  );
}
