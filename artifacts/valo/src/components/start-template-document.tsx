import { ClipboardList } from "lucide-react";
import { GUIDED_TEMPLATE_IDS, type GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { describeError } from "@/lib/api";
import { basePath } from "@/lib/env";
import { useStartGuided } from "@/hooks/use-start-guided";

/**
 * The document a template's page can start with its questions, if any: by the template's own ID for a
 * reviewed release, or by its registered title for a staff-library edition, which is filed under it.
 */
export function guidedTemplateFor(templateId: string, title: string): GuidedTemplateId | null {
  const byId = GUIDED_TEMPLATE_IDS.find((id) => id === templateId);
  if (byId) return byId;
  const named = title.trim().toLowerCase();
  return GUIDED_TEMPLATE_IDS.find((id) => GUIDED_SPECS_V1[id].title.toLowerCase() === named) ?? null;
}

/**
 * On a template's page, for a signed-in reader who may use it, the button that starts its document as
 * the New document page would: as its form when its wording is released for one, else with its
 * questions. The document opens in the workspace, which is the browser app: a full load (decision
 * 0011).
 */
export function StartTemplateDocument({ templateId, title }: { templateId: string; title: string }) {
  const id = guidedTemplateFor(templateId, title);
  const { start, starting, pending, error } = useStartGuided((doc) =>
    window.location.assign(`${basePath}/workspace/documents/${encodeURIComponent(doc.id)}`),
  );
  if (!id) return null;
  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={pending}
        onClick={() => start(id)}
        data-testid="button-answer-questions"
      >
        <ClipboardList className="h-4 w-4" aria-hidden />
        {starting === id && pending ? "Starting your document…" : "Answer its questions"}
      </button>
      <p className="text-sm text-muted-foreground">Valo sets the document out from your answers.</p>
      {error && (
        <p role="alert" className="text-sm text-red-800" data-testid="text-start-error">
          {describeError(error).message}
        </p>
      )}
    </div>
  );
}
