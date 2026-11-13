import { useGetSourceEvidence } from '@workspace/api-client-react';
import { ErrorState, Skel } from '@/components/states';
export function SourceEvidence(){
  const query=useGetSourceEvidence({query:{retry:false,refetchInterval:30000,refetchOnWindowFocus:true}});
  return <section className="mt-10" aria-labelledby="source-evidence-title">
    <h2 id="source-evidence-title" className="font-display text-3xl">Source evidence and proposed policies</h2>
    {query.isLoading?<Skel className="mt-5 h-40"/>:query.isError?<ErrorState error={query.error} onRetry={()=>query.refetch()}/>:query.data&&<>
      <p className="mt-4 text-sm text-muted-foreground">{query.data.notice}</p>
      <p className="mt-4 text-sm text-muted-foreground">{query.data.coordinatingSummary}</p>
      <div className="surface mt-5 p-5">
        <h3 className="font-medium">Documentation handover — preserved in local history</h3>
        <p className="mt-3 break-words text-sm text-muted-foreground">{query.data.handoverSummary}</p>
        <a className="mt-3 inline-block text-sm underline" href="https://github.com/obeidpeter/Valo-Compliance/pull/1" target="_blank" rel="noopener noreferrer">Open the documentation draft pull request</a>
      </div>
      <p className="mt-4 font-mono text-xs">{query.data.references.filter(r=>/^S\d{2}$/.test(r.id)).length} original leads + {query.data.references.filter(r=>r.id.startsWith('SV-')).length} distinct coordinating additions · {query.data.references.filter(r=>r.status==='retrieved_unreviewed').length} retrieved but unreviewed · 0 published</p>
      <h3 className="mt-7 font-display text-2xl">Editorial provider runs</h3>
      <p className="mt-3 text-sm text-muted-foreground">Separate drafting, factual and challenge calls. Successful execution is not a cleared review or publication. Source currency, rights, policy, export and isolation gates remain held. Candidate bodies stay private.</p>
      {!query.data.editorialRuns.length?<p className="mt-3 text-sm">No persisted provider runs yet.</p>:
        <div className="mt-4 space-y-3">{query.data.editorialRuns.map(r=><details key={r.id} className="surface p-5">
          <summary className="cursor-pointer">{r.role} · {r.status} · publication held</summary>
          <p className="mt-3 break-all text-sm">Run {r.id}<br/>Model {r.model}<br/>Prompt {r.promptVersion}</p>
          <p className="mt-3 text-sm">Provider response: {r.providerResponseId??'None'}<br/>Latency: {r.latencyMs===null?'Not recorded':`${r.latencyMs} ms`}<br/>Review verdict: {r.modelVerdict??'Not applicable or unavailable'}</p>
          <p className="mt-3 break-all font-mono text-xs">Source hash: {r.sourceHash}<br/>Candidate hash: {r.candidateHash??'Not created'}</p>
          {r.failureCode&&<p className="mt-3 text-sm">{r.failureCode}</p>}
        </details>)}</div>}
      <div className="mt-5 space-y-3">{query.data.references.map(r=><details key={r.id} className="surface p-5">
        <summary className="cursor-pointer"><span className="font-mono">{r.id}</span> · {r.title}<span className="mt-2 block text-xs text-muted-foreground">{r.status.replaceAll('_',' ')} · publication held</span></summary>
        <a className="mt-4 block break-all text-sm underline" href={r.url} target="_blank" rel="noopener noreferrer">Original official/source reference</a>
        <p className="mt-3 text-sm">Latest attempt: {r.attemptedAt??'Not attempted'} · HTTP {r.httpStatus??'No complete response'}</p>
        {r.failureCode&&<p className="mt-3 font-mono text-xs">{r.failureCode}</p>}
        <p className="mt-3 text-sm">Private raw snapshot: {r.rawStored?'stored':'not stored'} · extracted text: {r.textStored?'stored':'not stored'}</p>
        <p className="mt-3 text-sm">Source checked: {r.sourceCheckedAt??'Not recorded'} · AI reviewed: {r.aiReviewedAt??'Not recorded'}</p>
        <p className="mt-3 break-all font-mono text-xs">Raw SHA-256: {r.rawChecksum??'None'}<br/>Text SHA-256: {r.textChecksum??'None'}</p>
        <p className="mt-4 text-sm text-muted-foreground"><strong>Original baseline note, not this retrieval’s conclusion:</strong> {r.baselineNotes}</p>
        {r.coordinatingNotes.map(note=><p key={note} className="mt-3 text-sm text-muted-foreground">{note}</p>)}
        {r.titleEvidenceStatus&&<p className="mt-3 text-sm">Content/title identity: {r.titleEvidenceStatus.replaceAll('_',' ')}. This is not legal or amendment review.</p>}
        {r.metadataTitle&&<p className="mt-3 text-sm">Document metadata title: {r.metadataTitle}</p>}
        {r.titleWarning&&<p className="mt-3 text-sm">{r.titleWarning}</p>}
      </details>)}</div>
      <h3 className="font-display mt-8 text-2xl">Retention proposals — not enacted policy</h3>
      <p className="mt-3 text-sm text-muted-foreground">These periods are not Nigerian statutory deadlines. No automatic deletion or 35-day recovery guarantee has been enabled.</p>
      {query.data.retentionProposals.map(r=><div key={r.id} className="surface mt-3 p-5"><h4 className="font-medium">{r.dataClass}</h4><p className="mt-2 text-sm">{r.exactProposal}</p><p className="mt-3 text-xs text-muted-foreground">Unapproved · not enforced · G0 decision required</p></div>)}
      <h3 className="font-display mt-8 text-2xl">Original delivery sequence</h3>
      <p className="mt-3 text-sm text-muted-foreground">Weeks, staffing and the illustrative calendar are planning assumptions, not announced dates or budgets.</p>
      {query.data.roadmapSections.map(r=><details key={r.id} className="surface mt-3 p-5"><summary className="cursor-pointer">{r.title} · not accepted</summary><p className="mt-4 whitespace-pre-line text-sm">{r.exactContract}</p></details>)}
    </>}
  </section>;
}
