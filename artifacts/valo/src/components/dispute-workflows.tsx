import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type ReactNode} from "react";
import {useGetFinanceDispute,prepareFinanceDispute,controlFinanceDispute,useGetOrderDisputeInformation,saveOrderDisputeInformation} from "@workspace/api-client-react";
import {useUnsavedNavigation} from "@/lib/use-unsaved-navigation";
import {describeError} from "@/lib/api";

const DirtyContext=createContext<((id:string,dirty:boolean)=>void)|null>(null);
function useDisputeDirty(dirty:boolean){
  const register=useContext(DirtyContext),id=useId();
  useEffect(()=>{register?.(id,dirty);return()=>register?.(id,false);},[register,id,dirty]);
}
export function DisputeFormsBoundary({children}:{children:ReactNode}){
  const flags=useRef(new Map<string,boolean>()),title=useId();
  const register=useCallback((id:string,dirty:boolean)=>{if(dirty)flags.current.set(id,true);else flags.current.delete(id);},[]);
  const nav=useUnsavedNavigation(()=>[...flags.current.values()].some(Boolean)),ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(nav.blocked&&!ref.current?.open)ref.current?.showModal();else if(!nav.blocked)ref.current?.close();},[nav.blocked]);
  return <DirtyContext.Provider value={register}>{children}<dialog ref={ref} className="max-w-md rounded-2xl border bg-background p-6 text-foreground" onCancel={e=>{e.preventDefault();nav.stay();}} aria-labelledby={title}>
    <h3 id={title} className="font-display text-xl">Unsaved dispute information</h3>
    <p className="my-3">Keep editing to save first, or deliberately discard these entries.</p>
    <button autoFocus className="btn btn-primary mr-2" onClick={()=>nav.stay()}>Keep editing</button>
    <button className="btn btn-secondary" onClick={()=>nav.proceed()}>Discard and leave</button>
  </dialog></DirtyContext.Provider>;
}
export function FinanceDisputeCard({id}:{id:string}){
  const q=useGetFinanceDispute(id,{query:{refetchInterval:30000}});
  const[kind,setKind]=useState<"upload_receipt"|"submit_evidence"|"merchant_decision">("upload_receipt");
  const[resolution,setResolution]=useState<"merchant-accepted"|"declined">("merchant-accepted");
  const[amount,setAmount]=useState(""),[message,setMessage]=useState(""),[informationId,setInformationId]=useState("");
  const[busy,setBusy]=useState(false),[error,setError]=useState(""),key=useRef(crypto.randomUUID());
  const dirty=!!(message||amount||informationId||kind!=="upload_receipt"||resolution!=="merchant-accepted");
  useDisputeDirty(dirty);
  async function run(fn:()=>Promise<unknown>,reset=false){
    setBusy(true);setError("");
    try{await fn();if(reset){setMessage("");setAmount("");setInformationId("");setKind("upload_receipt");setResolution("merchant-accepted");key.current=crypto.randomUUID();}
      await q.refetch();
    }catch(e){setError(describeError(e).message);}finally{setBusy(false);}
  }
  if(!q.data)return <p role="status">{q.isError?describeError(q.error).message:"Loading scoped dispute…"}</p>;
  const d=q.data;
  return <article className="rounded-xl border p-4">
    <h4 className="font-semibold">Order {d.orderReference}</h4>
    <p className="my-2 text-sm">Provider state: {d.status}; reported resolution: {d.resolution??"not supplied"}. Neither is a confirmed bank outcome.</p>
    <p className="my-2 text-sm">{d.policy}</p>
    {!d.executionEnabled&&<p className="my-2 text-sm font-semibold">Development merchant execution is disabled. You can prepare/review an intent; nothing will be uploaded or submitted.</p>}
    <form onSubmit={e=>{e.preventDefault();void run(()=>prepareFinanceDispute(id,{kind,requestKey:key.current,message,
      ...(kind==="submit_evidence"?{informationId}:{}),
      ...(kind==="merchant_decision"?{resolution,amountKobo:resolution==="declined"?0:Number(amount)}:{})}),true);}}>
      <label className="block text-sm">Operation<select className="field my-1 w-full" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
        <option value="upload_receipt">Upload existing order receipt</option><option value="submit_evidence">Submit customer-consented structured evidence</option>
        <option value="merchant_decision">Prepare merchant decision</option></select></label>
      {kind==="submit_evidence"&&<label className="block text-sm">Exact saved customer statement<select className="field my-1 w-full" required value={informationId} onChange={e=>setInformationId(e.target.value)}>
        <option value="">Choose a consented statement</option>{d.information.map(r=><option key={String(r.id)} value={String(r.id)}>{String(r.id)}</option>)}</select></label>}
      {kind==="merchant_decision"&&<>
        <label className="block text-sm">Merchant response<select className="field my-1 w-full" value={resolution} onChange={e=>setResolution(e.target.value as typeof resolution)}>
          <option value="merchant-accepted">Accept full or partial claim</option><option value="declined">Decline with acknowledged evidence</option></select></label>
        {resolution==="merchant-accepted"&&<label className="block text-sm">Amount to accept in integer kobo, not naira<input className="field my-1 w-full" type="number" min={1} max={d.amountKobo} step={1} required value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
      </>}
      <label className="block text-sm">Accurate reason / provider message<textarea className="field my-1 w-full" required minLength={10} maxLength={1500} value={message} onChange={e=>setMessage(e.target.value)}/></label>
      <p className="my-2 text-sm">No invented delivery facts. Declines need an acknowledged receipt filename; fraud claims additionally need structured evidence.</p>
      <button className="btn btn-secondary" disabled={busy}>Prepare immutable intent only</button>
    </form>
    {error&&<p role="alert" className="my-2 text-destructive">{error}</p>}
    <ul className="mt-4 space-y-3">{d.actions.map(a=><li key={a.id} className="rounded-lg border p-3 text-sm">
      <p>{a.kind}: <strong>{a.status}</strong> · local attempts {a.attempts} · revision {a.version}</p>
      <p className="my-1 whitespace-pre-wrap">{String(a.payload.message??"")}</p>
      {a.failure&&<p role="status">{a.failure}. An unknown result will not be automatically sent again.</p>}
      {a.result&&<pre className="my-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(a.result,null,2)}</pre>}
      <div className="flex flex-wrap gap-2">
        {a.status==="prepared"&&<><button className="btn btn-secondary" disabled={busy||!d.executionEnabled} onClick={()=>void run(()=>controlFinanceDispute(a.id,"execute",{expectedVersion:a.version}))}>Send authorized test action once</button>
          <button className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>controlFinanceDispute(a.id,"cancel",{expectedVersion:a.version}))}>Cancel unsent intent</button></>}
        {a.attempts>0&&<button className="btn btn-secondary" disabled={busy||!d.executionEnabled} onClick={()=>void run(()=>controlFinanceDispute(a.id,"reconcile",{expectedVersion:a.version}))}>Fetch canonical state only</button>}
      </div>
    </li>)}</ul>
    <details className="mt-3 text-sm"><summary>Exact consented information and transition history</summary>
      <pre className="whitespace-pre-wrap break-all">{JSON.stringify({information:d.information,history:d.history},null,2)}</pre></details>
  </article>;
}
export function CustomerDisputeInformation({orderId}:{orderId:string}){
  const q=useGetOrderDisputeInformation(orderId),key=useRef(crypto.randomUUID());
  const[disputeId,setDispute]=useState(""),[name,setName]=useState(""),[phone,setPhone]=useState(""),[details,setDetails]=useState("");
  const[address,setAddress]=useState(""),[date,setDate]=useState(""),[consent,setConsent]=useState(false);
  const[busy,setBusy]=useState(false),[error,setError]=useState("");
  const dirty=!!(disputeId||name||phone||details||address||date||consent);
  useDisputeDirty(dirty);
  if(!q.data)return <p role="status">{q.isError?describeError(q.error).message:"Loading your dispute information…"}</p>;
  return <section className="my-4 rounded-xl border p-3">
    <h4 className="font-semibold">Information for an existing bank dispute</h4>
    <p className="my-2 text-sm">{q.data.notice}</p>
    <form onSubmit={e=>{e.preventDefault();setBusy(true);setError("");void saveOrderDisputeInformation(orderId,{
      disputeId,requestKey:key.current,customerName:name,customerPhone:phone,serviceDetails:details,
      ...(address?{deliveryAddress:address}:{}),...(date?{deliveryDate:date}:{}),consentVersion:"test-dispute-information-v1"})
      .then(async()=>{setDispute("");setName("");setPhone("");setDetails("");setAddress("");setDate("");setConsent(false);key.current=crypto.randomUUID();await q.refetch();})
      .catch(e=>setError(describeError(e).message)).finally(()=>setBusy(false));}}>
      <label className="block text-sm">Selected provider dispute<select className="field my-1 w-full" value={disputeId} required onChange={e=>setDispute(e.target.value)}>
        <option value="">Choose the matching dispute</option>{q.data.disputes.map(d=><option key={String(d.id)} value={String(d.id)}>{String(d.id)} — {String(d.status)}</option>)}</select></label>
      <label className="block text-sm">Your actual name<input className="field my-1 w-full" value={name} required maxLength={150} onChange={e=>setName(e.target.value)}/></label>
      <label className="block text-sm">Your actual phone number<input className="field my-1 w-full" value={phone} required minLength={5} maxLength={40} onChange={e=>setPhone(e.target.value)}/></label>
      <label className="block text-sm">What was actually supplied or disputed<textarea className="field my-1 w-full" required minLength={10} maxLength={2000} value={details} onChange={e=>setDetails(e.target.value)}/></label>
      <label className="block text-sm">Actual delivery address, only if relevant<input className="field my-1 w-full" value={address} maxLength={500} onChange={e=>setAddress(e.target.value)}/></label>
      <label className="block text-sm">Actual delivery date, only if known<input type="date" className="field my-1 w-full" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label className="my-3 flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I consent to finance sharing these exact facts and my verified account email with Paystack for this selected dispute.</label>
      <button className="btn btn-secondary" disabled={busy||!consent}>Save statement — not a bank decision</button>
    </form>
    {error&&<p role="alert" className="my-2 text-destructive">{error}</p>}
    <details className="mt-3 text-sm"><summary>Saved statements</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(q.data.information,null,2)}</pre></details>
  </section>;
}
