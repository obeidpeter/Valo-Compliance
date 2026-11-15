import {useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {getWorkspaceDisputes,createPaymentConcern,respondPaymentConcern,type PaymentConcern} from "@workspace/api-client-react";
import {describeError,formatDate} from "@/lib/api";

const queryKey=["/api/workspace/disputes"] as const;
function Concern({row,refresh}:{row:PaymentConcern;refresh:()=>Promise<unknown>}){
  const[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  return <article className="rounded-xl border p-3 text-sm">
    <p className="break-all font-medium">Concern {row.id}</p>
    <p className="my-1">{row.status.replaceAll("_"," ")} · Saved {formatDate(row.createdAt)}</p>
    <p className="whitespace-pre-wrap break-words">{row.message}</p>
    <details className="my-3"><summary className="cursor-pointer py-1">Replies and history</summary>
      <p className="my-2 text-xs text-muted-foreground">Up to the latest 100 history entries are shown. Earlier entries remain saved.</p>
      {!row.history.length?<p className="my-2">No replies yet.</p>:<ol className="space-y-2">{row.history.map(item=><li key={item.id} className="border-l pl-3">
        <p className="text-xs text-muted-foreground">{item.actorType} · {formatDate(item.createdAt)} · {item.action.replaceAll("_"," ")}</p>
        <p className="whitespace-pre-wrap break-words">{item.reason}</p>
      </li>)}</ol>}
    </details>
    {row.status!=="closed"&&<form onSubmit={e=>{e.preventDefault();if(busy||message.trim().length<10)return;
      setBusy(true);setError(null);void respondPaymentConcern(row.id,{expectedVersion:row.version,message:message.trim()})
        .then(async()=>{setMessage("");await refresh();}).catch(e=>setError(describeError(e).message)).finally(()=>setBusy(false));
    }}>
      <label className="block" htmlFor={`concern-reply-${row.id}`}>Add information to this concern</label>
      <textarea id={`concern-reply-${row.id}`} className="field my-2 w-full" required minLength={10} maxLength={2000}
        value={message} disabled={busy} onChange={e=>setMessage(e.target.value)}/>
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||message.trim().length<10}>{busy?"Saving reply…":"Save reply"}</button>
    </form>}
    {error&&<p className="mt-2 text-destructive" role="alert">{error} Refresh this history before repeating a reply whose outcome is unclear.</p>}
  </article>;
}

/** A customer service concern is separate from a cardholder's bank dispute. */
export function PaymentConcerns({orderId,orderReference}:{orderId:string;orderReference:string}){
  const qc=useQueryClient(),q=useQuery({queryKey,queryFn:({signal})=>getWorkspaceDisputes({signal}),refetchOnWindowFocus:true});
  const[message,setMessage]=useState(""),[ack,setAck]=useState(false),[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null),[saved,setSaved]=useState<string|null>(null);
  const request=useRef<{message:string;key:string}|null>(null);
  const refresh=()=>qc.invalidateQueries({queryKey});
  const rows=q.data?.concerns.filter(row=>row.orderId===orderId)??[];
  const workflows=q.data?.workflows.filter(row=>row.orderId===orderId)??[];
  return <section className="mt-6 border-t pt-4" aria-label={`Payment concerns for ${orderReference}`}>
    <h3 className="font-semibold">Payment concerns and replies</h3>
    <p className="my-2 text-sm">Tell Valo about this order. Saving a concern does not open a bank dispute, request a refund or change your access. Your bank handles any dispute you raise with it.</p>
    <p className="mb-3 text-sm text-muted-foreground">Use only test information here. Do not include card numbers, bank details, identity documents or private draft contents.</p>
    {q.isLoading?<p role="status" className="text-sm">Loading concern history…</p>:q.isError?<div role="alert" className="text-sm">
      <p>{describeError(q.error).message}</p><button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary mt-2" onClick={()=>void q.refetch()}>Reload concern history</button>
    </div>:<>
      {!!workflows.length&&<div className="my-3 space-y-2">{workflows.map(row=><p key={row.id} className="rounded-xl border p-3 text-sm">
        Verified provider observation: {row.canonicalStatus.replaceAll("-"," ")}. Template access: {row.entitlementStatus??"not recorded"}. Last checked {formatDate(row.checkedAt)}.
        {" "}This is not a Valo decision about the bank outcome. Your saved drafts and past downloads remain your work.
      </p>)}</div>}
      {!rows.length?<p className="my-3 text-sm text-muted-foreground">No concerns saved for this order.</p>:<div className="my-3 space-y-3">{rows.map(row=><Concern key={row.id} row={row} refresh={refresh}/>)}</div>}
    </>}
    <form onSubmit={e=>{e.preventDefault();if(busy||!ack||message.trim().length<20)return;
      const value=message.trim();if(request.current?.message!==value)request.current={message:value,key:crypto.randomUUID()};
      setBusy(true);setError(null);setSaved(null);
      void createPaymentConcern(orderId,{requestKey:request.current.key,message:value,acknowledgement:true})
        .then(async row=>{setSaved(row.id);setMessage("");setAck(false);request.current=null;await refresh();})
        .catch(e=>setError(describeError(e).message)).finally(()=>setBusy(false));
    }}>
      <label className="block text-sm" htmlFor={`payment-concern-${orderId}`}>What happened with this order?</label>
      <textarea id={`payment-concern-${orderId}`} className="field my-2 w-full" required minLength={20} maxLength={2000}
        value={message} disabled={busy} onChange={e=>setMessage(e.target.value)}/>
      <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>
        I understand this saves a concern for Valo; it does not open a bank dispute or complete a refund.</label>
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||!ack||message.trim().length<20}>{busy?"Saving concern…":"Save payment concern"}</button>
    </form>
    {saved&&<p className="mt-3 break-all text-sm" role="status">Concern saved. Your reference is {saved}. No provider dispute or refund was created.</p>}
    {error&&<p className="mt-3 text-sm text-destructive" role="alert">{error} If the outcome is unclear, reload the history. Retrying these unchanged details uses the same request key.</p>}
  </section>;
}
