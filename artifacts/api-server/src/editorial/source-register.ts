import { db,valoSourceSnapshots } from "@workspace/db";
import { desc } from "drizzle-orm";
import { finalSourceContext,allSourceLeads,coordinatingRefinement,handoverCheckpoint } from "@workspace/valo-core";
export async function sourceEvidenceRegister(){
  const latest=await db.selectDistinctOn([valoSourceSnapshots.sourceId]).from(valoSourceSnapshots)
    .orderBy(valoSourceSnapshots.sourceId,desc(valoSourceSnapshots.attemptedAt));
  return{
    notice:"Actual retrieval is not legal currency, rights clearance, AI review or publication. Retention and roadmap periods remain unapproved planning proposals. No confidential customer data or production launch is authorised.",
    handoverSummary:handoverCheckpoint.summary,
    coordinatingSummary:"All 27 supplied document mappings match the existing register: five direct matches, one composite manual and 21 distinct additions. All 13 conflict resolutions and 14 source observations are retained; no implementation acceptance follows. The owner confirmed the existing repository is intended; creation history, private visibility, source synchronisation and protection remain separate evidence checks.",
    references:allSourceLeads.map(lead=>{
      const row=latest.find(s=>s.sourceId===lead.id);
      const identity=row?.metadata.identity as {status?:string;warning?:string|null}|null|undefined;
      return{id:lead.id,title:lead.title,url:lead.url,category:lead.category,
        baselineNotes:lead.baselineNotes,sourceLocator:lead.sourceLocator,
        status:row?.status??"not_attempted",attemptedAt:row?.attemptedAt.toISOString()??null,
        fetchedAt:row?.fetchedAt?.toISOString()??null,httpStatus:row?.httpStatus??null,
        failureCode:row?.failureCode??null,rawChecksum:row?.rawChecksum??null,textChecksum:row?.textChecksum??null,
        rawStored:Boolean(row?.rawObjectKey),textStored:Boolean(row?.textObjectKey),
        publication:"held" as const,aiReviewedAt:null,sourceCheckedAt:null,
        coordinatingNotes:coordinatingRefinement.sourceFindings.filter(s=>s.canonicalSourceId===lead.id)
          .map(s=>`${s.id} · Coordinating observation: ${s.availability}. ${s.verified_notes} Required validation: ${s.implementation_constraint}`),
        titleEvidenceStatus:identity?.status??null,
        metadataTitle:typeof row?.metadata.retrievedTitle==="string"?row.metadata.retrievedTitle:null,
        titleWarning:identity?.warning??null};
    }),
    retentionProposals:finalSourceContext.retentionProposals.map(r=>({...r})),
    roadmapSections:finalSourceContext.roadmapSections.map(r=>({...r})),
  };
}
