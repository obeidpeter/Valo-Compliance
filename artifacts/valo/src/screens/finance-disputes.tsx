import {useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {getFinanceDisputes,getFinanceDispute,getFinanceDisputeReceipt,linkFinanceDispute,actOnFinanceDispute,actOnPaymentConcern,
  type PaymentConcern,type DisputeWorkflow,type DisputeIntent,type FinanceDisputeDetail} from "@workspace/api-client-react";
import {describeError,formatDate} from "@/lib/api";

const queueKey=["/api/admin/disputes"] as const;
const money=(n:number)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(n/100);
type Action=Parameters<typeof actOnFinanceDispute>[1];
function WorkflowSummary({row}:{row:DisputeWorkflow}){
  return <dl className="my-3 grid gap-2 text-sm sm:grid-cols-2">
    <div><dt className="text-muted-foreground">Order</dt><dd className="break-all">{row.orderReference}</dd><dd>{row.orderTitle} · {money(row.orderAmountKobo)}</dd></div>
    <div><dt className="text-muted-foreground">Canonical provider dispute</dt><dd className="break-all">{row.providerId}</dd><dd>{row.canonicalStatus.replaceAll("-"," ")}</dd></div>
    <div><dt className="text-muted-foreground">Recorded merchant resolution</dt><dd>{row.providerResolution??"None recorded"}</dd><dd>{row.providerAmountKobo===null?"No amount recorded":money(row.providerAmountKobo)}</dd></div>
    <div><dt className="text-muted-foreground">Template access</dt><dd>{row.entitlementStatus??"Not recorded"}</dd><dd>{row.held?"Finance hold is active":"No finance hold"}</dd></div>
    <div><dt className="text-muted-foreground">Last canonical check</dt><dd>{formatDate(row.checkedAt)}</dd></div>
  </dl>;
}
function FinanceConcern({row,refresh}:{row:PaymentConcern;refresh:()=>Promise<unknown>}){
  const[message,setMessage]=useState(""),[action,setAction]=useState<"reply"|"request_information"|"close">("reply");
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  return <article className="rounded-xl border p-4 text-sm">
    <h4 className="break-all font-semibold">Concern {row.id}</h4><p className="my-2 break-all">Order {row.orderReference} · {row.status.replaceAll("_"," ")}</p>
    <p className="whitespace-pre-wrap break-words">{row.message}</p>
    <details className="my-3"><summary className="cursor-pointer py-1">Customer concern history</summary><p className="my-2 text-xs text-muted-foreground">Up to the latest 100 history entries are shown. Earlier entries remain saved.</p><ol className="space-y-2">{row.history.map(item=><li key={item.id}>
      <p className="text-xs text-muted-foreground">{item.actorType} · {formatDate(item.createdAt)} · {item.action.replaceAll("_"," ")}</p>
      <p className="whitespace-pre-wrap break-words">{item.reason}</p>
    </li>)}</ol></details>
    {row.status!=="closed"&&<form onSubmit={e=>{e.preventDefault();if(busy||message.trim().length<10)return;setBusy(true);setError(null);
      void actOnPaymentConcern(row.id,{expectedVersion:row.version,action,message:message.trim()})
        .then(async()=>{setMessage("");await refresh();}).catch(e=>setError(describeError(e).message)).finally(()=>setBusy(false));
    }}>
      <label className="block" htmlFor={`finance-concern-action-${row.id}`}>Concern response</label>
      <select id={`finance-concern-action-${row.id}`} className="field my-2 w-full" disabled={busy} value={action} onChange={e=>setAction(e.target.value as typeof action)}>
        <option value="reply">Reply</option><option value="request_information">Request information</option><option value="close">Close concern with a reply</option>
      </select>
      <label className="block" htmlFor={`finance-concern-message-${row.id}`}>Message visible to the customer</label>
      <textarea id={`finance-concern-message-${row.id}`} className="field my-2 w-full" required minLength={10} maxLength={1500} disabled={busy} value={message} onChange={e=>setMessage(e.target.value)}/>
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||message.trim().length<10}>{busy?"Saving response…":"Save concern response"}</button>
    </form>}
    {error&&<p className="mt-2 text-destructive" role="alert">{error} Reload the queue before repeating an uncertain response.</p>}
  </article>;
}
function IntentCard({intent,detail,busy,reason,act}:{intent:DisputeIntent;detail:FinanceDisputeDetail;busy:boolean;reason:string;act:(input:Partial<Action>&{action:Action["action"]})=>Promise<void>}){
  const[ack,setAck]=useState(false),[downloadBusy,setDownloadBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const prepared=intent.state==="prepared",uncertain=detail.intents.some(row=>["dispatching","unknown","needs_review"].includes(row.state));
  const canDispatch=prepared&&detail.executionEnabled&&!detail.workflow.held&&!uncertain&&detail.workflow.canonicalStatus==="awaiting-merchant-feedback";
  return <article className="rounded-xl border p-4 text-sm" aria-label={`Prepared operation ${intent.id}`}>
    <h4 className="font-semibold">{intent.operation.replaceAll("_"," ")} · {intent.state.replaceAll("_"," ")}</h4>
    <p className="my-2 whitespace-pre-wrap break-words">{intent.summary}</p>
    <dl className="space-y-1">{intent.facts.map((fact,i)=><div key={i}><dt className="font-medium">{fact.label}</dt><dd className="whitespace-pre-wrap break-words">{fact.value}</dd></div>)}</dl>
    <details className="my-3"><summary className="cursor-pointer py-1">Saved evidence references</summary>
      <p className="break-all">Intent: {intent.id}</p><p className="break-all">Source: {intent.sourceReference}</p><p className="break-all">Input hash: {intent.inputHash}</p>
      <p>Prepared {formatDate(intent.createdAt)}</p><p>Attempt recorded: {intent.attemptedAt?formatDate(intent.attemptedAt):"None"}</p>
      <p>Provider acknowledgement: {intent.acknowledgedAt?formatDate(intent.acknowledgedAt):"None recorded"}</p>
      {intent.providerFilename&&<p className="break-all">Provider file receipt: {intent.providerFilename}</p>}
      {intent.providerEvidenceId&&<p className="break-all">Provider evidence receipt: {intent.providerEvidenceId}</p>}
    </details>
    {intent.receiptUrl&&<button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary mb-3" disabled={busy||downloadBusy} onClick={()=>void(async()=>{
      setDownloadBusy(true);setError(null);try{
        const blob=await getFinanceDisputeReceipt(detail.workflow.id,intent.id,{responseType:"blob",cache:"no-store"});
        const objectUrl=URL.createObjectURL(blob),a=document.createElement("a");a.href=objectUrl;a.download=`dispute-receipt-${intent.id}.pdf`;a.click();URL.revokeObjectURL(objectUrl);
      }catch(e){setError(describeError(e).message);}finally{setDownloadBusy(false);}
    })()}>{downloadBusy?"Loading receipt…":"Download prepared receipt"}</button>}
    {intent.state==="unknown"&&<p role="status" className="my-2">The provider outcome is unknown. Do not resend this operation. Reconciliation checks the canonical record; if it cannot prove the result, finance must review it manually.</p>}
    {intent.state==="needs_review"&&<p role="status" className="my-2">This operation requires manual review. No further provider mutation is assumed or retried.</p>}
    {intent.state==="reconciled"&&<p role="status" className="my-2">The canonical record matches the intended financial effect. The original transmission receipt remains unknown. This operation will not be resent, and no bank verdict or credit is confirmed.</p>}
    {intent.state==="acknowledged"&&<p className="my-2">A provider acknowledgement was recorded. It is not confirmation of a bank victory or a credit reaching the customer.</p>}
    {intent.failure&&<p className="my-2 break-words" role="status">Review note: {intent.failure.replaceAll("_"," ")}</p>}
    {prepared&&<div className="mt-3 border-t pt-3">
      <label className="flex items-start gap-2"><input type="checkbox" checked={ack} disabled={busy||!canDispatch} onChange={e=>setAck(e.target.checked)}/>
        I have reviewed this immutable intent and authorise this one test provider operation. Preparing it alone sends nothing.</label>
      <div className="mt-3 flex flex-wrap gap-2"><button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-primary" disabled={busy||!canDispatch||!ack||reason.trim().length<10}
        onClick={()=>void act({action:"dispatch_intent",intentId:intent.id,acknowledgement:true}).then(()=>setAck(false))}>Dispatch this test operation</button>
        <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:"cancel_intent",intentId:intent.id})}>Cancel prepared intent</button></div>
      {!detail.executionEnabled&&<p className="mt-2">Test provider execution is disabled. This prepared intent has not been sent.</p>}
      {detail.workflow.canonicalStatus!=="awaiting-merchant-feedback"&&<p className="mt-2">The recorded dispute is not awaiting merchant feedback. Reconcile it before considering another action.</p>}
      {uncertain&&<p className="mt-2">An earlier operation is in progress or needs review. Reconcile its outcome before another dispatch.</p>}
      {detail.workflow.held&&<p className="mt-2">Release the finance hold before any dispatch; release does not itself send an operation.</p>}
    </div>}
    {error&&<p className="mt-2 text-destructive" role="alert">{error}</p>}
  </article>;
}
function DisputeDetail({id,refresh}:{id:string;refresh:()=>Promise<unknown>}){
  const qc=useQueryClient(),detailKey=[...queueKey,id];
  const q=useQuery({queryKey:detailKey,queryFn:({signal})=>getFinanceDispute(id,{signal}),refetchOnWindowFocus:true});
  const[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const[resolution,setResolution]=useState<""|"merchant-accepted"|"declined">(""),[amount,setAmount]=useState("");
  const[information,setInformation]=useState({customer_email:"",customer_name:"",customer_phone:"",service_details:"",delivery_address:"",delivery_date:""});
  const[sourceNote,setSourceNote]=useState(""),[preparationAck,setPreparationAck]=useState(false);const keys=useRef(new Map<string,string>());
  async function act(input:Partial<Action>&{action:Action["action"]}){
    if(busy||!q.data||reason.trim().length<10||input.action.startsWith("prepare_")&&!preparationAck)return;
    const base={...input,...(input.action.startsWith("prepare_")?{acknowledgement:true}:{}),expectedVersion:q.data.workflow.version,reason:reason.trim()};
    const fingerprint=JSON.stringify(base);if(!keys.current.has(fingerprint))keys.current.set(fingerprint,crypto.randomUUID());
    setBusy(true);setError(null);setNotice(null);
    try{const result=await actOnFinanceDispute(id,{...base,requestKey:keys.current.get(fingerprint)!} as Action);
      qc.setQueryData(detailKey,result);if(input.action.startsWith("prepare_"))setPreparationAck(false);setNotice(input.action.startsWith("prepare_")?"Intent saved for review. No provider operation was sent.":"Saved state refreshed. Check the recorded operation and canonical status below.");await refresh();
    }catch(e){setError(describeError(e).message+" Reload the saved record before acting again; an uncertain provider operation must not be resent.");}
    finally{setBusy(false);}
  }
  if(q.isLoading)return <p role="status" className="my-4">Loading the saved dispute record…</p>;
  if(q.isError||!q.data)return <div role="alert" className="my-4"><p>{describeError(q.error).message}</p><button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary mt-2" onClick={()=>void q.refetch()}>Reload dispute record</button></div>;
  const detail=q.data;
  return <section className="mt-5 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby={`dispute-${id}`}>
    <h3 id={`dispute-${id}`} className="text-lg font-semibold">Finance dispute review</h3><WorkflowSummary row={detail.workflow}/>
    <p className="my-3 text-sm">{detail.notice}</p><p className="my-3 text-sm">Drafts and past downloads remain the customer’s work. Merchant decisions and provider acknowledgements do not establish a bank outcome.</p>
    <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary mb-4" disabled={busy} onClick={()=>void q.refetch()}>Reload saved dispute record</button>
    <label className="block text-sm font-medium" htmlFor={`dispute-reason-${id}`}>Reason for the next finance action</label>
    <textarea id={`dispute-reason-${id}`} className="field my-2 w-full" required minLength={10} maxLength={1500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/>
    <p className="mb-3 text-xs text-muted-foreground">Every action requires an active finance role and fresh MFA, checked by the server. Do not include card, bank or private draft details.</p>
    <div className="flex flex-wrap gap-2">
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary" disabled={busy||reason.trim().length<10} onClick={()=>void act({action:detail.workflow.held?"release_hold":"hold"})}>{detail.workflow.held?"Release finance hold":"Place finance hold"}</button>
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary" disabled={busy||!detail.executionEnabled||reason.trim().length<10} onClick={()=>void act({action:"reconcile"})}>Reconcile with canonical record</button>
    </div>
    {!detail.executionEnabled&&<p role="status" className="my-3 text-sm">Test provider execution is disabled. You can prepare and review evidence; no provider request will be made from these disabled controls.</p>}
    <details className="my-5 rounded-xl border p-3"><summary className="cursor-pointer py-1 font-semibold">Prepare evidence and a merchant decision</summary>
      <p className="my-3 text-sm">Preparation saves an immutable intent for review. Each provider operation needs a separate acknowledged dispatch. Only order and payment evidence is available here; private customer drafts and arbitrary uploads are excluded.</p>
      <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={preparationAck} disabled={busy} onChange={e=>setPreparationAck(e.target.checked)}/>
        I confirm that any supplied facts have a verified source. This preparation saves evidence for review and sends nothing to the provider.</label>
      <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} type="button" className="btn btn-secondary" disabled={busy||!preparationAck||reason.trim().length<10} onClick={()=>void act({action:"prepare_receipt"})}>Prepare receipt from saved order</button>
      <form className="mt-5 border-t pt-4" onSubmit={e=>{e.preventDefault();if(busy||sourceNote.trim().length<10)return;
        const facts={customer_email:information.customer_email.trim(),customer_name:information.customer_name.trim(),customer_phone:information.customer_phone.trim(),service_details:information.service_details.trim(),
          ...(information.delivery_address.trim()?{delivery_address:information.delivery_address.trim()}:{}),...(information.delivery_date?{delivery_date:information.delivery_date}:{})};
        void act({action:"prepare_evidence",information:facts,sourceNote:sourceNote.trim()});
      }}>
        <h4 className="font-medium">Structured fraud evidence</h4><p className="my-2 text-sm">Enter only facts supplied and verified for this test case. If a required fact is unknown, leave this evidence unprepared; do not invent it. Delivery details are optional.</p>
        {([['customer_email','Customer email','email'],['customer_name','Customer name','text'],['customer_phone','Customer phone','tel'],['service_details','Service details','text'],['delivery_address','Delivery address (optional)','text'],['delivery_date','Delivery date (optional)','date']] as const).map(([key,label,type])=><div key={key}>
          <label className="block text-sm" htmlFor={`${id}-${key}`}>{label}</label><input id={`${id}-${key}`} type={type} className="field my-2 w-full" value={information[key]} disabled={busy}
            required={!key.startsWith("delivery_")} minLength={key==="service_details"?10:key==="customer_phone"?5:undefined} maxLength={key==="service_details"?2000:key==="customer_name"?150:key==="customer_phone"?40:key==="delivery_address"?500:254} onChange={e=>setInformation(s=>({...s,[key]:e.target.value}))}/>
        </div>)}
        <label className="block text-sm" htmlFor={`source-${id}`}>Where these facts were verified</label><textarea id={`source-${id}`} className="field my-2 w-full" required minLength={10} maxLength={1500} disabled={busy} value={sourceNote} onChange={e=>setSourceNote(e.target.value)}/>
        <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||!preparationAck||reason.trim().length<10||sourceNote.trim().length<10}>Prepare structured evidence</button>
      </form>
      <form className="mt-5 border-t pt-4" onSubmit={e=>{e.preventDefault();if(!resolution||busy)return;let amountKobo=0;
        if(resolution==="merchant-accepted"){
          const match=/^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/.exec(amount);
          if(!match){setError("Enter a positive NGN amount with at most two decimal places.");return;}
          const parsed=BigInt(match[1])*100n+BigInt((match[2]??"").padEnd(2,"0"));
          if(parsed<=0n||parsed>BigInt(detail.workflow.orderAmountKobo)){setError("The amount must be positive and cannot exceed the original payment. The server also checks existing refunds and reservations.");return;}
          amountKobo=Number(parsed);
        }
        void act({action:"prepare_decision",resolution,amountKobo});
      }}>
        <h4 className="font-medium">Merchant decision</h4><label className="mt-2 block text-sm" htmlFor={`resolution-${id}`}>Proposed response to the provider dispute</label>
        <select id={`resolution-${id}`} className="field my-2 w-full" required disabled={busy} value={resolution} onChange={e=>setResolution(e.target.value as typeof resolution)}>
          <option value="">Choose a response</option><option value="merchant-accepted">Accept and request the specified refund</option><option value="declined">Decline using acknowledged evidence</option>
        </select>
        {resolution==="merchant-accepted"&&<><label className="block text-sm" htmlFor={`dispute-amount-${id}`}>Proposed refund amount in NGN</label><input id={`dispute-amount-${id}`} inputMode="decimal" className="field my-2 w-full" required maxLength={12} disabled={busy} value={amount} onChange={e=>setAmount(e.target.value)}/></>}
        <p className="my-2 text-sm">Declining requires the recorded provider upload receipt; fraud claims also require the evidence receipt. Accepting reserves an amount and does not itself confirm a completed refund.</p>
        <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||!preparationAck||!resolution||reason.trim().length<10}>Prepare merchant decision</button>
      </form>
    </details>
    {busy&&<p role="status" className="my-3 text-sm">Saving or reconciling this action…</p>}{notice&&<p role="status" className="my-3 text-sm">{notice}</p>}{error&&<p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
    <h4 className="my-3 font-semibold">Immutable prepared operations</h4>
    {!detail.intents.length?<p className="text-sm">No operations prepared. No provider mutation has been requested from this workflow.</p>:<div className="space-y-3">{detail.intents.map(intent=><IntentCard key={`${intent.id}:${intent.inputHash}:${intent.state}:${detail.workflow.version}`} intent={intent} detail={detail} busy={busy} reason={reason} act={act}/>)}</div>}
    <details className="mt-4 text-sm"><summary className="cursor-pointer py-1 font-semibold">Finance action history</summary><ol className="mt-2 space-y-3">{detail.history.map(item=><li key={item.id}>
      <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)} · {item.actorType} · {item.action.replaceAll("_"," ")}</p><p className="whitespace-pre-wrap break-words">{item.reason}</p>
    </li>)}</ol></details>
  </section>;
}
export function FinanceDisputes(){
  const qc=useQueryClient(),q=useQuery({queryKey:queueKey,queryFn:({signal})=>getFinanceDisputes({signal}),refetchOnWindowFocus:true});
  const[selected,setSelected]=useState<string|null>(null),[orderId,setOrderId]=useState(""),[providerId,setProviderId]=useState("");
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const refresh=()=>qc.invalidateQueries({queryKey:queueKey});
  return <section className="mt-8 border-t pt-6" aria-labelledby="finance-disputes-heading">
    <h2 id="finance-disputes-heading" className="font-display text-2xl">Payment concerns and provider disputes</h2>
    <p className="my-3 text-sm">Customer concerns are service conversations, separate from disputes raised through a bank. Finance access requires an active role and fresh managed MFA. Actions and evidence references are audited.</p>
    {q.isLoading?<p role="status">Loading finance queue…</p>:q.isError?<div role="alert"><p>{describeError(q.error).message}</p><button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary mt-2" onClick={()=>void q.refetch()}>Reload finance disputes</button></div>:<>
      <p className="my-3 text-sm">{q.data?.notice}</p>
      <h3 className="my-3 font-semibold">Customer concerns</h3>{!q.data?.concerns.length?<p className="text-sm text-muted-foreground">No customer concerns in this queue.</p>:<div className="space-y-3">{q.data.concerns.map(row=><FinanceConcern key={row.id} row={row} refresh={refresh}/>)}</div>}
      <h3 className="my-4 font-semibold">Verified dispute workflows</h3>{!q.data?.workflows.length?<p className="text-sm text-muted-foreground">No linked dispute workflows. This does not establish that no bank dispute exists.</p>:<ul className="space-y-3">{q.data.workflows.map(row=><li key={row.id} className="rounded-xl border p-4">
        <WorkflowSummary row={row}/><button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary max-w-full whitespace-normal break-all text-left" onClick={()=>setSelected(row.id)}>Review dispute {row.providerId}</button>
      </li>)}</ul>}
      {!!q.data?.observations.length&&<details className="my-4 text-sm"><summary className="cursor-pointer py-1">Unlinked provider observations</summary><ul className="mt-2 space-y-2">{q.data.observations.map(row=><li key={`${row.orderId}:${row.providerId}`} className="rounded-xl border p-3">
        <p className="break-all">Order {row.orderId} · Provider {row.providerId} · {row.status}</p><p>Checked {formatDate(row.checkedAt)}</p>
        <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary mt-2" onClick={()=>{setOrderId(row.orderId);setProviderId(row.providerId);}}>Use these linking details</button>
      </li>)}</ul></details>}
      <details className="my-5 rounded-xl border p-3"><summary className="cursor-pointer py-1 font-semibold">Link an existing test provider dispute</summary>
        <p className="my-3 text-sm">This checks a canonical provider record against a saved order. It does not create a bank dispute. Do not guess IDs or use live transactions.</p>
        <form onSubmit={e=>{e.preventDefault();if(busy||!q.data?.executionEnabled)return;setBusy(true);setError(null);
          void linkFinanceDispute({orderId:orderId.trim(),providerId:providerId.trim()}).then(async result=>{qc.setQueryData([...queueKey,result.workflow.id],result);setSelected(result.workflow.id);await refresh();})
            .catch(e=>setError(describeError(e).message)).finally(()=>setBusy(false));
        }}>
          <label className="block text-sm" htmlFor="dispute-order-id">Saved order ID</label><input id="dispute-order-id" className="field my-2 w-full" required maxLength={36} pattern="[0-9a-fA-F-]{36}" value={orderId} disabled={busy} onChange={e=>setOrderId(e.target.value)}/>
          <label className="block text-sm" htmlFor="dispute-provider-id">Existing test provider dispute ID</label><input id="dispute-provider-id" className="field my-2 w-full" required inputMode="numeric" pattern="[0-9]{1,40}" maxLength={40} value={providerId} disabled={busy} onChange={e=>setProviderId(e.target.value)}/>
          <button style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}} className="btn btn-secondary" disabled={busy||!q.data?.executionEnabled}>{busy?"Checking canonical record…":"Check and link canonical dispute"}</button>
          {!q.data?.executionEnabled&&<p className="my-2 text-sm">Test provider execution is disabled. Existing saved workflows remain available for preparation and review.</p>}
        </form>{error&&<p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
      </details>
      {selected&&<DisputeDetail key={selected} id={selected} refresh={refresh}/>}
    </>}
  </section>;
}
