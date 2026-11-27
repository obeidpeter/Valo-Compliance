import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateDocument,
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { blankContent } from "@/lib/api";
import { live } from "@/lib/checker";
import { savedBusinessName } from "@/lib/guided-prefill";

/** Starts a blank document and opens its editor. `pending` and `error` are the request's own. */
export function useNewDocument() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const ws = useGetWorkspace({ query: { queryKey: getGetWorkspaceQueryKey(), ...live } });
  const create = useCreateDocument();
  function start() {
    create.mutate(
      {
        data: {
          title: "Untitled document",
          content: blankContent(savedBusinessName(ws.data?.profile)),
        },
      },
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
