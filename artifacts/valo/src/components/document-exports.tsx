import { useId, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import {
  useListDocumentExports, useCreateDocumentExport, useRetryDocumentExport,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { ErrorState } from "./states";

function ExportButton({ documentId, revisionId, format, disabled, onCreated }: {
  documentId:string;revisionId:string;format:"docx"|"pdf";disabled:boolean;onCreated:()=>void;
}) {
  const [key] = useState(()=>crypto.randomUUID());
  const create = useCreateDocumentExport({
    request:{headers:{"Idempotency-Key":key}},
    mutation:{onSuccess:onCreated},
  });
  return <div>
    <button className="btn btn-ghost btn-sm" disabled={disabled || create.isPending}
      onClick={()=>create.mutate({id:documentId,data:{revisionId,format,acknowledgeDraft:true}})}>
      <Download className="h-4 w-4"/>{create.isPending ? "Requesting…" : `Create ${format.toUpperCase()} draft`}
    </button>
    {create.isError && <p role="alert" className="mt-2 text-sm text-red-800">{describeError(create.error).message}</p>}
  </div>;
}
export function DocumentExports({ documentId,revisionId,revisionNumber,disabled }: {
  documentId:string;revisionId:string;revisionNumber:number;disabled:boolean;
}) {
  const checkbox = useId();
  const [acknowledged,setAcknowledged] = useState(false);
  const jobs = useListDocumentExports(documentId,{query:{
    refetchInterval:query=>query.state.data?.some(job=>["queued","running","retrying"].includes(job.status)) ? 2000 : 15000,
    refetchOnWindowFocus:true,
  }});
  const retry = useRetryDocumentExport({mutation:{onSuccess:()=>{void jobs.refetch();}}});
  return <section id="private-exports" className="card p-5 sm:p-7" aria-labelledby="export-heading" data-testid="private-exports">
    <p className="eyebrow mb-2">Private exports · development only</p>
    <h2 id="export-heading" className="font-display text-2xl">Download your saved business draft</h2>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
      Both formats use the same saved revision. These manual drafts are not released Valo templates,
      verified payment proof or professionally reviewed content. A draft notice appears in each file.
    </p>
    <label htmlFor={checkbox} className="my-4 flex items-start gap-3 text-sm">
      <input id={checkbox} type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} className="mt-1"/>
      I deliberately want a visibly marked incomplete business draft, including any missing fields.
    </label>
    {disabled && <p role="status" className="mb-3 text-sm">Save or resolve unsaved changes before requesting an export.</p>}
    <p className="mb-3 text-sm">Saved revision {revisionNumber}</p>
    <div className="flex flex-wrap gap-3">
      {(["docx","pdf"] as const).map(format=><ExportButton key={`${revisionId}-${format}`} documentId={documentId} revisionId={revisionId}
        format={format} disabled={disabled || !acknowledged} onCreated={()=>{void jobs.refetch();}}/>)}
    </div>
    {jobs.isLoading && <p className="mt-4 text-sm" role="status">Loading saved export jobs…</p>}
    {jobs.isError && <ErrorState title="Export status unavailable" error={jobs.error} onRetry={()=>jobs.refetch()}/>}
    {jobs.data?.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No export requested for this document yet.</p>}
    <ul className="mt-5 divide-y divide-border" aria-live="polite">
      {jobs.data?.map(job=><li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Revision {job.revision} · {job.format.toUpperCase()} · {job.status}</p>
          <p className="text-xs text-muted-foreground">Attempts: {job.attempts}{job.size !== null ? ` · ${job.size.toLocaleString("en-NG")} bytes` : ""}</p>
          {job.errorCode && <p className="mt-1 break-words text-sm text-red-800">{job.errorCode}. Your saved draft has not been changed.</p>}
        </div>
        {job.downloadUrl && <a href={job.downloadUrl} className="btn btn-primary btn-sm"><Download className="h-4 w-4"/>Download {job.format.toUpperCase()}</a>}
        {job.status === "failed" && <button className="btn btn-ghost btn-sm" disabled={retry.isPending}
          onClick={()=>retry.mutate({id:job.id,data:{}})}><RotateCcw className="h-4 w-4"/>Retry export</button>}
      </li>)}
    </ul>
    {retry.isError && <p role="alert" className="text-sm text-red-800">{describeError(retry.error).message}</p>}
    <p className="mt-3 text-xs text-muted-foreground">Queue or file-storage failure never means “completed”. Production export approval and disaster recovery are still unproved.</p>
  </section>;
}
