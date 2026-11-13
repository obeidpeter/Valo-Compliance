import { db,valoSourceSnapshots } from "@workspace/db";
import { desc } from "drizzle-orm";
import { finalSourceContext } from "@workspace/valo-core";
export async function sourceEvidenceRegister(){
  const latest=await db.selectDistinctOn([valoSourceSnapshots.sourceId]).from(valoSourceSnapshots)
    .orderBy(valoSourceSnapshots.sourceId,desc(valoSourceSnapshots.attemptedAt));
  return{
    notice:"Actual retrieval is not legal currency, rights clearance, AI review or publication. Retention and roadmap periods remain unapproved planning proposals. No confidential customer data or production launch is authorised.",
    references:finalSourceContext.references.map(lead=>{
      const row=latest.find(s=>s.sourceId===lead.id);
      return{id:lead.id,title:lead.title,url:lead.url,category:lead.category,
        baselineNotes:lead.baselineNotes,sourceLocator:lead.sourceLocator,
        status:row?.status??"not_attempted",attemptedAt:row?.attemptedAt.toISOString()??null,
        fetchedAt:row?.fetchedAt?.toISOString()??null,httpStatus:row?.httpStatus??null,
        failureCode:row?.failureCode??null,rawChecksum:row?.rawChecksum??null,textChecksum:row?.textChecksum??null,
        rawStored:Boolean(row?.rawObjectKey),textStored:Boolean(row?.textObjectKey),
        publication:"held" as const,aiReviewedAt:null,sourceCheckedAt:null};
    }),
    retentionProposals:finalSourceContext.retentionProposals.map(r=>({...r})),
    roadmapSections:finalSourceContext.roadmapSections.map(r=>({...r})),
  };
}
