import {useState} from "react";
import {useListPrivacyCases,useGetPrivacyCase,useVerifyPrivacyCase,useCancelPrivacyCase,type PrivacyCase} from "@workspace/api-client-react";
import {ErrorState} from "./states";
import {formatDate} from "@/lib/api";
export function PrivacyCases(){
  const cases=useListPrivacyCases();
  return <section className="mt-8" aria-labelledby="privacy-cases-heading">
    <h2 id="privacy-cases-heading" className="font-display text-2xl">Request processing and results</h2>
    <p className="mt-2 text-sm text-muted-foreground">Verification, assignment and preparation are separate steps. A received or partially fulfilled request is not a confirmed deletion or complete provider-wide export.</p>
    {cases.isLoading&&<p role="status" className="mt-4">Loading your requests…</p>}
    {cases.isError&&<ErrorState error={cases.error} onRetry={()=>cases.refetch()}/>}
    {cases.data?.length===0&&<p className="mt-4 text-sm text-muted-foreground">No structured privacy requests yet. Older support-only requests remain listed separately.</p>}
    <ul className="mt-5 grid gap-4">{cases.data?.map(request=><li key={request.id}>
      <PrivacyCaseCard request={request} onChanged={async()=>{await cases.refetch();}}/>
    </li>)}</ul>
  </section>;
}
function PrivacyCaseCard({request,onChanged}:{request:PrivacyCase;onChanged:()=>Promise<void>}){
  const[open,setOpen]=useState(false),[ack,setAck]=useState(false);
  const detail=useGetPrivacyCase(request.id,{query:{enabled:open}});
  const refresh=async()=>{setAck(false);await Promise.all([detail.refetch(),onChanged()]);};
  const verify=useVerifyPrivacyCase({mutation:{onSuccess:refresh}});
  const cancel=useCancelPrivacyCase({mutation:{onSuccess:refresh}});
  const row=detail.data?.request??request,busy=verify.isPending||cancel.isPending;
  const mayVerify=["awaiting_verification","needs_information"].includes(row.status);
  const mayCancel=["awaiting_verification","verified","assigned","needs_information","held","failed"].includes(row.status);
  return <article className="surface min-w-0 p-5" data-testid="privacy-case">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="break-words font-medium">{row.reference}</h3>
        <p className="mt-1 text-sm">{row.kind} · <strong>{row.status.replaceAll("_"," ")}</strong> · version {row.version}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.createdAt)} · {row.assigned?"Assigned to privacy operations":"Not assigned"}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={`privacy-${row.id}`}
        onClick={()=>setOpen(!open)}>{open?"Hide request":"View request"}</button>
    </div>
    {open&&<div id={`privacy-${row.id}`} className="mt-5 grid gap-4">
      <p className="whitespace-pre-wrap break-words text-sm">{row.message}</p>
      <p className="rounded-xl bg-accent/50 p-3 text-sm">{row.resultScope}</p>
      {detail.isError&&<ErrorState error={detail.error} onRetry={()=>detail.refetch()}/>}
      {detail.isLoading&&<p role="status">Loading processing history…</p>}
      {detail.data?.steps.length!==0&&<ul className="grid gap-2 text-sm" aria-label="Processing steps">
        {detail.data?.steps.map(step=><li key={step.system} className="rounded-xl border border-border p-3">
          <strong>{step.system}: {step.status.replaceAll("_"," ")}</strong><p className="mt-1 whitespace-pre-wrap break-words">{step.detail}</p>
        </li>)}
      </ul>}
      {mayVerify&&<label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>
        <span>I confirm this is my business's request and want the signed-in owner identity checked. This does not confirm that processing is finished.</span>
      </label>}
      <div className="flex flex-wrap gap-3">
        {mayVerify&&<button type="button" className="btn btn-primary btn-sm" disabled={!ack||busy}
          onClick={()=>verify.mutate({id:row.id,data:{expectedVersion:row.version,acknowledgement:true}})}>
          {verify.isPending?"Verifying…":"Verify my request"}</button>}
        {mayCancel&&<button type="button" className="btn btn-ghost btn-sm" disabled={busy}
          onClick={()=>cancel.mutate({id:row.id,data:{expectedVersion:row.version,acknowledgement:true}})}>Cancel before processing</button>}
        {row.resultAvailable&&<a className="btn btn-ghost btn-sm" href={`/api/workspace/privacy-cases/${row.id}/result`} download>
          Download prepared result</a>}
      </div>
      {verify.isError&&<ErrorState error={verify.error}/>}
      {cancel.isError&&<ErrorState error={cancel.error}/>}
      {!!detail.data?.events.length&&<ol className="grid gap-2 border-t border-border pt-4 text-sm" aria-label="Request history">
        {detail.data.events.map(event=><li key={event.sequence}>
          <strong>{event.action.replaceAll("_"," ")}</strong> · {event.actorType} · {formatDate(event.createdAt)}
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{event.reason}</p>
        </li>)}
      </ol>}
    </div>}
  </article>;
}
