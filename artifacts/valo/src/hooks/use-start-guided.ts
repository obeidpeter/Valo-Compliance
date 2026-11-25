import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useCreateDocument,
  useGetWorkspace,
  useStartFormDocument,
  useListFormTemplates,
  getGetWorkspaceQueryKey,
  getListFormTemplatesQueryKey,
  getListFormTemplatesQueryOptions,
  getListDocumentsQueryKey,
  type BusinessDocument,
  type CanonicalDocument,
} from "@workspace/api-client-react";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { compileGuidedContent } from "@workspace/valo-core/guided-runtime";
import { live } from "@/lib/checker";
import { prefillGuidedData } from "@/lib/guided-prefill";

/**
 * Starting one of the documents the workspace asks questions for, and opening it with `opened`. A
 * kind whose template's wording is released with a form that fills it starts as that form (forms
 * v2); any other starts with its questions.
 */
export function useStartGuided(opened: (doc: BusinessDocument) => void) {
  const [starting, setStarting] = useState<GuidedTemplateId | null>(null);
  // Waiting for the list of forms that can start, after a click that came before it loaded.
  const [waiting, setWaiting] = useState(false);
  const ws = useGetWorkspace({ query: { queryKey: getGetWorkspaceQueryKey(), ...live } });
  // The templates whose form (forms v2) can be started now, with a released edition of their wording.
  const formTemplates = useListFormTemplates({
    query: { queryKey: getListFormTemplatesQueryKey(), staleTime: 60_000 },
  });
  const create = useCreateDocument(),
    startForm = useStartFormDocument(),
    qc = useQueryClient();
  const pending = create.isPending || startForm.isPending || waiting;
  function start(id: GuidedTemplateId) {
    setStarting(id);
    const open = (doc: BusinessDocument) => {
      void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
      void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      opened(doc);
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
        { onSuccess: open, onError: () => setStarting(null) },
      );
    if (!GUIDED_SPECS_V2[id]) return questionsOnly();
    // A kind whose template's wording is released with a form that fills it starts as that form
    // (forms v2), with the saved business name filled in by the server. A click before the list of
    // such forms has loaded waits for it, rather than asking for a form the list would say is not
    // released. Should the list fail to load, or the wording be withdrawn meanwhile, the server says
    // so and the document starts with its questions as before.
    const asForm = () =>
      startForm.mutate(
        { data: { templateId: id } },
        {
          onSuccess: open,
          onError: (error) => {
            if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
              startForm.reset();
              questionsOnly();
            } else setStarting(null);
          },
        },
      );
    const listed = (list: { templates: { templateId: string }[] }) =>
      list.templates.some((t) => t.templateId === id);
    if (formTemplates.isSuccess) return listed(formTemplates.data) ? asForm() : questionsOnly();
    setWaiting(true);
    void qc.ensureQueryData(getListFormTemplatesQueryOptions()).then(
      (list) => {
        setWaiting(false);
        if (listed(list)) asForm();
        else questionsOnly();
      },
      () => {
        // The list could not load: the server's answer to the start decides.
        setWaiting(false);
        asForm();
      },
    );
  }
  return {
    start,
    starting,
    pending,
    workspace: ws,
    formTemplates,
    error: create.isError || startForm.isError ? (create.error ?? startForm.error) : null,
  };
}
