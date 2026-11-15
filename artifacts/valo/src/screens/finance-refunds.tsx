import {useState} from "react";
import {useGetFinanceRefunds,decideFinanceRefund,reconcileFinanceRefund,type RefundRecord} from "@workspace/api-client-react";
import {ErrorState,Skel} from "@/components/states";
import {describeError,formatDate} from "@/lib/api";
import {FinanceDisputes} from "./finance-disputes";
function RefundCard({row,refresh}:{row:RefundRecord;refresh:()=>Promise<unknown>}){
  const[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  async function run(action:()=>Promise<unknown>){
    setBusy(true);setError(null);
    try{await action();setReason("");await refresh();}catch(e){setError(describeError(e).message);}finally{setBusy(false);}
  }
  return <article className="rounded-xl border bg-card p-4">
    <h3 className="break-all font-semibold">{row.reference}</h3>
    <p className="my-2 text-sm">{row.amountKobo===null?"Legacy amount unconfirmed":new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN"}).format(row.amountKobo/100)} · {row.status.replaceAll("_"," ")}</p>
    <p className="whitespace-pre-wrap text-sm">{row.reason}</p>
    <p className="my-2 text-xs text-muted-foreground">Revision {row.version} · Attempts {row.attempts}/5 · Checked {row.checkedAt?formatDate(row.checkedAt):"not yet"}</p>
    {row.decisionReason&&<p className="my-2 text-sm">Decision reason: {row.decisionReason}</p>}
    {row.failure&&<p className="my-2 text-sm" role="status">{row.failure.replaceAll("_"," ")}. Funds remain reserved unless verified failed or rejected.</p>}
    {row.status==="needs_attention"&&<p className="my-2 text-sm">The provider needs secure customer account handling. Use the authorised Paystack merchant workflow; do not put bank details or identity documents in these notes. No bank credit is assumed.</p>}
    {row.status==="requested"&&<form onSubmit={e=>e.preventDefault()}>
      <label className="block text-sm" htmlFor={`decision-${row.id}`}>Reason shared with the customer</label>
      <textarea id={`decision-${row.id}`} className="field my-2 w-full" required minLength={10} maxLength={1500} value={reason} onChange={e=>setReason(e.target.value)}/>
      <div className="flex flex-wrap gap-2">{(["approve","reject"]as const).map(decision=><button type="button" key={decision}
        className="btn btn-secondary" disabled={busy||reason.trim().length<10} onClick={()=>void run(()=>decideFinanceRefund(row.id,{decision,reason,expectedVersion:row.version}))}>
        {decision==="approve"?"Authorize test refund":"Reject request"}</button>)}</div>
    </form>}
    {!["requested","rejected"].includes(row.status)&&<button className="btn btn-secondary mt-3" disabled={busy} onClick={()=>void run(()=>reconcileFinanceRefund(row.id,{}))}>Reconcile original refund reference</button>}
    {busy&&<p className="mt-2 text-sm" role="status">Saving or checking…</p>}
    {error&&<p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
  </article>;
}
export function FinanceRefunds(){
  const q=useGetFinanceRefunds({query:{refetchInterval:30000,refetchOnWindowFocus:true}});
  if(q.isLoading)return <Skel className="mt-6 h-40"/>;
  if(q.isError)return <ErrorState error={q.error} onRetry={()=>q.refetch()}/>;
  return <section className="mt-6" aria-labelledby="finance-refunds-heading">
    <h2 id="finance-refunds-heading" className="font-display text-2xl">Refund decisions and reconciliation</h2>
    <p className="my-3 text-sm">{q.data?.policy}</p>
    <p className="mb-4 text-sm text-muted-foreground">Every decision requires an active finance role and fresh managed MFA. Authorization is not completion. No customer draft bodies are shown.</p>
    <p className="mb-4 text-sm text-muted-foreground">This development queue can include controlled scenario fixtures. Those records are not evidence of Paystack execution or real bank credits.</p>
    {!q.data?.refunds.length?<p className="my-4 text-sm">No refund requests.</p>:<div className="space-y-4">{q.data.refunds.map(row=><RefundCard key={row.id} row={row} refresh={()=>q.refetch()}/>)}</div>}
    <FinanceDisputes/>
  </section>;
}
