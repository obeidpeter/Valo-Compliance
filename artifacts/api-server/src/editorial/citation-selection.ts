import { z } from "zod";
import { candidateSchema,type EvidenceBundle } from "./pipeline-contract";

const paragraph=candidateSchema.shape.paragraphs.element;
const claim=paragraph.shape.claims.element;
export const draftSelectionSchema=candidateSchema.extend({
  paragraphs:z.array(paragraph.extend({
    claims:z.array(z.strictObject({
      id:claim.shape.id,statement:claim.shape.statement,excerptIndex:z.number().int().min(0).max(63),
    })).max(8),
  })).min(1).max(4),
});
const bundleSchema=z.strictObject({
  snapshotId:z.uuid(),sourceId:z.string().min(1),title:z.string().min(1),url:z.url(),
  fetchedAt:z.string().min(1),rawHash:z.string().regex(/^[a-f0-9]{64}$/),textHash:z.string().regex(/^[a-f0-9]{64}$/),
  publication:z.literal("held"),effectivePeriod:z.literal("unverified"),
  passages:z.array(z.strictObject({id:z.string().min(1).max(80),page:z.number().int().positive(),
    text:z.string().min(1).max(12000)})).min(1).max(2),
});
export function sourceExcerpts(bundle:EvidenceBundle){
  const excerpts:{excerptIndex:number;passageId:string;start:number;end:number;quote:string}[]=[];
  for(const passage of bundle.passages)for(let start=0;start<passage.text.length;start+=900){
    const end=Math.min(start+1200,passage.text.length);
    excerpts.push({excerptIndex:excerpts.length,passageId:passage.id,start,end,quote:passage.text.slice(start,end)});
    if(end===passage.text.length)break;
  }
  if(excerpts.length>64)throw Error("AI_CITATION_SELECTION_INVALID");
  return excerpts;
}
export function editorialDraftInput(bundle:EvidenceBundle){
  return{role:"draft",sourceBundle:bundle,sourceExcerpts:sourceExcerpts(bundle),
    task:"Summarise only included formation provisions and their stated exceptions. Select exact excerpt indexes for each claim. Do not assert currentness."};
}
export function resolveDraftSelection(raw:unknown,input:unknown){
  const context=z.object({sourceBundle:bundleSchema,sourceExcerpts:z.array(z.unknown())}).parse(input);
  const excerpts=sourceExcerpts(context.sourceBundle);
  if(JSON.stringify(context.sourceExcerpts)!==JSON.stringify(excerpts))throw Error("AI_CITATION_SELECTION_INVALID");
  const selected=draftSelectionSchema.parse(raw);
  return candidateSchema.parse({...selected,paragraphs:selected.paragraphs.map(p=>({...p,
    claims:p.claims.map(c=>{
      const excerpt=excerpts[c.excerptIndex];if(!excerpt)throw Error("AI_CITATION_SELECTION_INVALID");
      return{id:c.id,statement:c.statement,sourceSnapshotId:context.sourceBundle.snapshotId,
        passageId:excerpt.passageId,quote:excerpt.quote};
    }),
  }))});
}
