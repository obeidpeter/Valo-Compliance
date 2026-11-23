import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CopyPlus, Loader2 } from "lucide-react";
import {
  useCreateDocument,
  getGetWorkspaceQueryKey,
  getListDocumentsQueryKey,
  type BusinessDocument,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import {
  availableConversions,
  convertGuidedDocument,
  type ConversionTargetId,
} from "@/lib/document-conversions";
import { anotherLike } from "@/lib/document-copy";

/**
 * Starts a new document from the saved one in view: the same details, with its reference and its
 * dates left blank for the customer to give. It is a document of its own from then on; the saved
 * one is not changed. `unsaved` holds it back while the editor has changes it has not saved, so the
 * copy is of what the customer last saw saved.
 */
export function MakeAnother({ saved, unsaved }: { saved: BusinessDocument; unsaved: boolean }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const create = useCreateDocument();
  const [pendingAction, setPendingAction] = useState<"copy" | ConversionTargetId | null>(null);
  const start = useMemo(() => anotherLike(saved.content), [saved.content]);
  const conversions = useMemo(() => availableConversions(saved.content), [saved.content]);
  // A document whose saved questions cannot be read is not copied; the editor already says why.
  if (!start) return null;

  function launch(action: "copy" | ConversionTargetId, title: string, content: BusinessDocument["content"]) {
    setPendingAction(action);
    create.mutate(
      { data: { title, content } },
      {
        onSuccess: (made) => {
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          setLocation("/workspace/documents/" + made.id);
        },
        onSettled: () => setPendingAction(null),
      },
    );
  }

  return (
    <section className="surface p-5" aria-labelledby="make-another-title" data-testid="card-make-another">
      <h2 id="make-another-title" className="eyebrow">
        Make another
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Start a new document with these details. Its reference and its dates are left blank for you to fill
        in. This one is not changed.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={unsaved || create.isPending}
          onClick={() => launch("copy", saved.title, start)}
          data-testid="button-make-another"
        >
          {pendingAction === "copy" && create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CopyPlus className="h-4 w-4" aria-hidden="true" />
          )}
          Make another like this
        </button>
        {conversions.map((conv) => (
          <button
            key={conv.targetId}
            type="button"
            className="btn btn-primary btn-sm"
            disabled={unsaved || create.isPending}
            title={conv.description}
            onClick={() => {
              const converted = convertGuidedDocument(saved.content, conv.targetId);
              if (converted) launch(conv.targetId, converted.title, converted.content);
            }}
            data-testid={"button-convert-" + conv.targetId}
          >
            {pendingAction === conv.targetId && create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            )}
            {conv.label}
          </button>
        ))}
      </div>
      {conversions.length > 0 && <p className="hint mt-2">{conversions[0]!.description}</p>}
      {unsaved && (
        <p role="status" className="hint">
          Save your changes first.
        </p>
      )}
      {create.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {describeError(create.error).message}
        </p>
      )}
    </section>
  );
}
