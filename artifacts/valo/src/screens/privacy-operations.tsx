import {useEffect,useRef,useState} from "react";
import {Link} from "wouter";
import {useListStaffPrivacyCases,useActOnStaffPrivacyCase,type PrivacyCase,type PrivacyCaseDetail,type PrivacyStaffAction} from "@workspace/api-client-react";
import {ErrorState} from "@/components/states";
import {useUnsavedNavigation} from "@/lib/use-unsaved-navigation";
import {formatDate} from "@/lib/api";
const actions:{value:PrivacyStaffAction["action"];label:string}[]=[
  {value:"claim",label:"Claim verified request"},{value:"request_information",label:"Request more information"},
  {value:"hold",label:"Hold processing"},{value:"release_hold",label:"Release a resolved hold"},
  {value:"reject",label:"Reject with recorded reason"},{value:"prepare_export",label:"Prepare scoped application JSON"},
  {value:"record_correction",label:"Record an actual corrected profile revision"},
  {value:"start_erasure",label:"Start synthetic development content erasure"},
  {value:"resume_erasure",label:"Resume synthetic development content erasure"},
];
export default function PrivacyOperations(){
  const[page,setPage]=useState(1),[selected,setSelected]=useState<PrivacyCase|null>(null),[detail,setDetail]=useState<PrivacyCaseDetail|null>(null);
  const[action,setAction]=useState<PrivacyStaffAction["action"]>("claim"),[reason,setReason]=useState(""),[profileVersionId,setProfile]=useState(""),[ack,setAck]=useState(false);
  const dirty=!!reason.trim()||!!profileVersionId.trim()||ack;
  const nav=useUnsavedNavigation(()=>dirty),dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(nav.blocked)dialog.current?.showModal();else dialog.current?.close();},[nav.blocked]);
  const q=useListStaffPrivacyCases({page},{query:{retry:false,refetchOnWindowFocus:!dirty}});
  const mutation=useActOnStaffPrivacyCase({mutation:{onSuccess:async result=>{
    setSelected(result.request);setDetail(result);setReason("");setProfile("");setAck(false);await q.refetch();
  }}});
  const clear=()=>{setReason("");setProfile("");setAck(false);mutation.reset();};
  const choose=(row:PrivacyCase)=>{
    if(dirty&&!window.confirm("Discard the unsent operation details before opening this request?"))return;
    clear();setSelected(row);setDetail(null);setAction("claim");
  };
  const submit=()=>{
    if(!selected||reason.trim().length<10||mutation.isPending)return;
    mutation.mutate({id:selected.id,data:{expectedVersion:selected.version,action,reason:reason.trim(),
      ...(profileVersionId.trim()?{profileVersionId:profileVersionId.trim()}:{}),acknowledgement:ack}});
  };
  return <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
    <Link href="/staff" className="text-sm underline underline-offset-4">All staff operations</Link>
    <p className="eyebrow mt-6">Privacy operations</p><h1 className="font-display mt-2 text-4xl">Requests, processing and results</h1>
    <p className="mt-3 max-w-3xl text-sm text-muted-foreground">A separate server-assigned privacy role and fresh multi-factor verification are required. Assignment, a prepared application JSON file and a confirmed full outcome are different states. No statutory deadline is inferred here.</p>
    {q.isLoading&&<p className="mt-6" role="status">Loading the privacy queue…</p>}
    {q.isError&&<div className="mt-6"><ErrorState error={q.error} onRetry={()=>q.refetch()}/><Link href="/workspace/account" className="mt-3 inline-block text-sm underline">Manage sign-in security</Link></div>}
    {q.data&&<>
      <p className="mt-6 text-sm">{q.data.total} requests · page {q.data.page} · {q.data.pageSize} per page</p>
      {q.data.items.length===0&&<p className="mt-4">No requests on this page.</p>}
      <ul className="mt-4 grid gap-3">{q.data.items.map(row=><li key={row.id} className="surface min-w-0 p-5">
        <h2 className="break-words font-medium">{row.reference}</h2>
        <p className="mt-1 text-sm">{row.kind} · {row.status.replaceAll("_"," ")} · version {row.version} · {formatDate(row.createdAt)}</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm">{row.message}</p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" aria-pressed={selected?.id===row.id} onClick={()=>choose(row)} disabled={mutation.isPending}>Open operations</button>
      </li>)}</ul>
      <div className="mt-4 flex flex-wrap gap-3" role="group" aria-label="Privacy queue pages">
        <button className="btn btn-ghost btn-sm" disabled={page===1||dirty||mutation.isPending} onClick={()=>{setPage(page-1);setSelected(null);}}>Previous</button>
        <button className="btn btn-ghost btn-sm" disabled={page*q.data.pageSize>=q.data.total||dirty||mutation.isPending} onClick={()=>{setPage(page+1);setSelected(null);}}>Next</button>
        <button className="btn btn-ghost btn-sm" disabled={dirty||mutation.isPending} onClick={()=>q.refetch()}>Refresh queue</button>
      </div>
      {dirty&&<p className="mt-2 text-sm text-muted-foreground">Unsent operation details are preserved. Submit or explicitly discard them before changing pages or refreshing.</p>}
    </>}
    {selected&&<section className="surface mt-8 grid gap-4 p-5 sm:p-7" aria-labelledby="privacy-operation-heading">
      <h2 id="privacy-operation-heading" className="font-display break-words text-2xl">{selected.reference}</h2>
      <p className="text-sm">Expected version {selected.version} · {selected.verifiedAt?"Owner verified":"Owner not verified"} · {selected.assigned?"Assigned":"Unassigned"}</p>
      <label className="grid gap-2 text-sm">Operation
        <select className="field" value={action} onChange={e=>setAction(e.target.value as PrivacyStaffAction["action"])} disabled={mutation.isPending}>
          {actions.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </label>
      <label className="grid gap-2 text-sm">Reason, scope and observed evidence
        <textarea className="field min-h-28" value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1000} disabled={mutation.isPending}/>
      </label>
      {(action==="start_erasure"||action==="resume_erasure")&&
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={mutation.isPending}/>
          <span>I acknowledge irreversible deletion of the named application content and private exports in this synthetic development workspace. Access will be revoked. Financial, support/privacy and audit records are retained pending policy review; managed identity, backups and external providers are not fulfilled.</span></label>}
      {action==="record_correction"&&<>
        <label className="grid gap-2 text-sm">Actual corrected profile version ID
          <input className="field" value={profileVersionId} onChange={e=>setProfile(e.target.value)} disabled={mutation.isPending} autoComplete="off"/>
        </label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={mutation.isPending}/>
          <span>I checked the specified current profile revision and scope. This does not claim that sign-in-provider or other-system corrections are complete.</span></label>
      </>}
      <p className="rounded-xl bg-secondary p-3 text-sm">Content erasure is development-only and accepts explicitly synthetic workspaces. Resume advances a bounded batch and records actual system outcomes. A partial result is not complete account deletion. Production deletion and external-provider handling remain disabled.</p>
      {mutation.isError&&<ErrorState error={mutation.error}/>}
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={reason.trim().length<10||mutation.isPending||
          (action==="record_correction"&&(!profileVersionId.trim()||!ack))||
          ((action==="start_erasure"||action==="resume_erasure")&&!ack)}>{mutation.isPending?"Processing…":"Apply recorded operation"}</button>
        <button className="btn btn-ghost btn-sm" disabled={mutation.isPending} onClick={clear}>Discard unsent details</button>
      </div>
      {detail&&<div role="status" className="grid gap-3">
        <p className="text-sm"><strong>{detail.request.status.replaceAll("_"," ")}</strong>: {detail.request.resultScope}</p>
        <ul className="grid gap-2 text-sm">{detail.steps.map(s=><li key={s.system}><strong>{s.system}: {s.status.replaceAll("_"," ")}</strong><p className="whitespace-pre-wrap break-words">{s.detail}</p></li>)}</ul>
      </div>}
    </section>}
    <dialog ref={dialog} className="max-w-md rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      aria-labelledby="privacy-leave-heading" onCancel={e=>{e.preventDefault();nav.stay();}}>
      <h2 id="privacy-leave-heading" className="font-display text-2xl">Leave an unsent operation?</h2>
      <p className="mt-3 text-sm">Leaving does not send or approve this operation. Review and submit it here, or explicitly discard its unsent details.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button className="btn btn-primary btn-sm" onClick={nav.stay} autoFocus>Stay and review</button>
        <button className="btn btn-ghost btn-sm" onClick={()=>{clear();nav.proceed();}}>Discard and leave</button></div>
    </dialog>
  </div>;
}
