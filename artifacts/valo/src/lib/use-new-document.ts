import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateDocument,
  getGetWorkspaceQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { blankContent } from "@/lib/api";

/** Starts a blank document and opens its editor. `pending` and `error` are the request's own. */
export function useNewDocument() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const create = useCreateDocument();
  function start() {
    create.mutate(
      { data: { title: "Untitled document", content: blankContent() } },
      {
        onSuccess: (doc) => {
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          setLocation("/workspace/documents/" + doc.id);
        },
      },
    );
  }
  return { start, pending: create.isPending, error: create.error };
}
