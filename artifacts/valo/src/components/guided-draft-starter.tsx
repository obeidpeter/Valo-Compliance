import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  ApiError,
  useCreateDocument,
  useGetWorkspace,
  useStartFormDocument,
  getGetWorkspaceQueryKey,
  getListDocumentsQueryKey,
  type BusinessDocument,
  type CanonicalDocument,
} from "@workspace/api-client-react";
import { GUIDED_TEMPLATE_IDS, type GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { compileGuidedContent } from "@workspace/valo-core/guided-runtime";
import { describeError } from "@/lib/api";
import { live } from "@/lib/checker";
import { DOCUMENT_PURPOSES } from "@/lib/document-kinds";
import { prefillGuidedData, savedBusinessName } from "@/lib/guided-prefill";
import type { LandingTask } from "@/lib/landing-tasks";
import { cn } from "@/lib/utils";

/**
 * The documents the workspace asks questions for, each a button that starts one and opens its
 * editor. Every kind is in view with what it is for, so nothing has to be remembered or looked up.
 * `chosen` is the task a visitor picked before they had an account: its documents come first.
 */
export function GuidedDraftStarter({ chosen }: { chosen?: LandingTask | undefined }) {
  const [starting, setStarting] = useState<GuidedTemplateId | null>(null);
  const ws = useGetWorkspace({ query: { queryKey: getGetWorkspaceQueryKey(), ...live } });
  const businessName = savedBusinessName(ws.data?.profile);
  const create = useCreateDocument(),
    startForm = useStartFormDocument(),
    qc = useQueryClient(),
    [, navigate] = useLocation();
  const pending = create.isPending || startForm.isPending;
  function start(id: GuidedTemplateId) {
    setStarting(id);
    const opened = (doc: BusinessDocument) => {
      void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
      void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      navigate("/workspace/documents/" + doc.id);
    };
    const questionsOnly = () =>
      create.mutate(
        {
          data: {
            // The title is printed as the document's heading, so it starts as the kind's own name.
            title: GUIDED_SPECS_V1[id].title,
            content: compileGuidedContent(prefillGuidedData(id, ws.data?.profile)) as CanonicalDocument,
          },
        },
        { onSuccess: opened, onError: () => setStarting(null) },
      );
    if (!GUIDED_SPECS_V2[id]) return questionsOnly();
    // A kind whose template's wording is released with a form that fills it starts as that form
    // (forms v2), with the saved business name filled in by the server. Until then the server says
    // so, and the document starts with the questions as before.
    startForm.mutate(
      { data: { templateId: id } },
      {
        onSuccess: opened,
        onError: (error) => {
          if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
            startForm.reset();
            questionsOnly();
          } else setStarting(null);
        },
      },
    );
  }
  /** One document's button. `place` tells the chosen task's buttons from the full list's. */
  const kind = (id: GuidedTemplateId, place: "chosen" | "all") => (
    <li key={id}>
      <button
        type="button"
        className={cn(
          "surface group flex h-full w-full items-center gap-4 p-5 text-left transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
          place === "chosen" && "border-primary",
        )}
        disabled={pending}
        onClick={() => start(id)}
        data-testid={(place === "chosen" ? "button-start-chosen-" : "button-start-") + id}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{GUIDED_SPECS_V1[id].title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {DOCUMENT_PURPOSES[id]}
          </span>
        </span>
        {starting === id && pending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <ArrowRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
      </button>
    </li>
  );
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
      {(create.isError || startForm.isError) && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(create.error ?? startForm.error).message}
        </p>
      )}
    </div>
  );
}
