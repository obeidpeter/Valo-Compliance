import { and,eq } from "drizzle-orm";
import { db,valoContentVersions,valoPublicationPolicies,valoDocuments,valoPrices,valoEntitlements } from "@workspace/db";
import { evaluatePublication,publicationSchema,coveragePlan } from "@workspace/valo-core";
import { developmentPublicationOnly,operationalPolicy } from "../editorial/operational-policy";
import { getPublicationArtifact,type ArtifactRef } from "../editorial/publication-artifacts";
import { createDocumentInTransaction,getDocument,ValoProblem,authorizeWorkspaceWrite,type WorkspaceActor } from "./valo-store";
import { documentInput } from "./valo-validation";
import { loadRightsApplicability } from "../editorial/rights-applicability";
import { paginateReleasedItems } from "./valo-catalogue";
import { currentOperationalPermission } from "../editorial/operational-read-permission";
import {lockSourceState,sourceTargetAllowed} from "./valo-source-state";
export function releaseVisible(row:typeof valoContentVersions.$inferSelect,policyHash:string,now=new Date()){
  const parsed=publicationSchema.safeParse(row.bundle);
  return row.status==="published"&&+row.reviewBy>+now&&parsed.success&&
    parsed.data.candidate.hash===row.candidateHash&&parsed.data.policy.hash===policyHash&&
    evaluatePublication(parsed.data,now).decision==="eligible";
}
export async function liveReleasedVersions(){
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT)return[];
  const currentPolicy=await operationalPolicy();
  const rows=await db.select({content:valoContentVersions,policy:valoPublicationPolicies}).from(valoContentVersions)
    .innerJoin(valoPublicationPolicies,eq(valoContentVersions.policyId,valoPublicationPolicies.id))
    .where(eq(valoContentVersions.status,"published"));
  const allowed=[];
  for(const r of rows){
    if(!releaseVisible(r.content,r.policy.hash)||!await sourceTargetAllowed(db,"content",r.content.id,r.content.bundle))continue;
    if(publicationSchema.parse(r.content.bundle).candidate.evidenceMode==="original_operational"&&
      (r.policy.hash!==currentPolicy.policy.hash||!(await currentOperationalPermission(r.content))))continue;
    allowed.push(r.content);
  }
  return allowed
    .sort((a,b)=>b.version-a.version).filter((r,i,all)=>all.findIndex(v=>v.templateId===r.templateId)===i);
}
export async function liveOperationalVersions(){
  return(await liveReleasedVersions()).filter(r=>publicationSchema.parse(r.bundle).candidate.contentClass==="general_template");
}
export function projectReleasedResource(row:typeof valoContentVersions.$inferSelect){
  const b=publicationSchema.parse(row.bundle),c=b.candidate;
  if(c.contentClass!=="sourced_guidance")throw new Error("Not a released resource class");
  const first=c.body.split("\n").find(l=>l.trim())?.replace(/^#{1,6}\s+/,"").trim();
  const title=first&&first.length<=140?first:row.slug.replace(/-/g," ");
  const kind=c.coverage?.kind??"guidance";
  if(kind==="template")throw new Error("Resource classification mismatch");
  return{id:row.id,slug:row.slug,title,kind,industrySlugs:c.coverage?.industrySlugs??[],
    summary:c.body.replace(/\s+/g," ").slice(0,260),body:c.body,reviewedAt:c.sourceCheckDate,
    disclosure:c.disclosure,scope:c.scope,limitations:c.limitations,
    sources:c.claims.flatMap(claim=>{
      const s=b.sources.find(s=>s.id===claim.sourceId);
      if(!s||new URL(s.url).protocol!=="https:")return[];
      return[{url:s.url,title:s.title,locator:claim.locator}];
    }).filter((s,i,a)=>a.findIndex(x=>x.url===s.url&&x.locator===s.locator)===i)};
}
export async function releasedResources(){
  return(await liveReleasedVersions()).filter(r=>publicationSchema.parse(r.bundle).candidate.contentClass==="sourced_guidance")
    .map(projectReleasedResource);
}
export function operationalPresentation(templateId:string){
  if(templateId==="TPL-07")return{summary:"Record stock movements and physical counts using your own information.",
    preview:["SAMPLE FIELD: Business name [your information]","SAMPLE FIELDS: Item, unit and location [your information]",
      "SAMPLE SECTIONS: Receipts, issues, adjustments and physical counts [your records]"]};
  if(templateId==="TPL-06")return{summary:"Record a business expense and the details needed for your internal review.",
    preview:["SAMPLE FIELD: Claimant [your information]","SAMPLE FIELDS: Expense date, description, amount and currency [your records]",
      "SAMPLE FIELD: Internal review notes [your process]"]};
  return{summary:"Prepare this business document using your own information. Check its scope and required inputs before use.",
    preview:["SAMPLE FIELD: Business name [your information]","SAMPLE FIELD: Document details [your information]"]};
}
export async function liveCoverage(){
  return coveragePlan((await liveReleasedVersions()).map(row=>{
    const c=publicationSchema.parse(row.bundle).candidate;
    return{id:row.templateId,kind:c.contentClass==="general_template"?"template":c.coverage?.kind??"guidance",
      industrySlugs:c.coverage?.industrySlugs??[],locationIds:c.coverage?.locationIds??[],sourceCheckedAt:c.sourceCheckDate};
  }));
}
export async function releasedCatalogue(query:{q?:string;type?:string;industry?:string;page?:number}={}){
  const all=await liveOperationalVersions();
  const items=all.map(r=>{
    const document=documentInput.parse(JSON.parse(publicationSchema.parse(r.bundle).candidate.body));
    const c=publicationSchema.parse(r.bundle).candidate;
    return{id:r.id,slug:r.slug,title:document.title,type:"template",industry:c.coverage?.industrySlugs.join(",")||"All industries",
      summary:operationalPresentation(r.templateId).summary};
  });
  const guidance=(await releasedResources()).map(r=>({id:r.id,slug:r.slug,title:r.title,type:"guidance",
    industry:r.industrySlugs.join(",")||"All industries",summary:r.summary}));
  return {...paginateReleasedItems([...items,...guidance],query),heldTemplates:Math.max(0,40-all.filter(r=>/^TPL-(0[1-9]|[1-3][0-9]|40)$/.test(r.templateId)).length)};
}
export async function releasedTemplate(slug:string){
  const row=(await liveOperationalVersions()).find(r=>r.slug===slug);
  if(!row)throw new ValoProblem(404,"This template is unavailable, withdrawn or awaiting valid evidence.");
  const bundle=publicationSchema.parse(row.bundle),document=documentInput.parse(JSON.parse(bundle.candidate.body));
  return{id:row.id,templateId:row.templateId,slug:row.slug,title:document.title,
    summary:operationalPresentation(row.templateId).summary,
    version:row.version,reviewedAt:bundle.candidate.sourceCheckDate,reviewBy:row.reviewBy.toISOString(),
    disclosure:bundle.candidate.disclosure,scope:bundle.candidate.scope,limitations:bundle.candidate.limitations,
    preview:operationalPresentation(row.templateId).preview,
    developmentOnly:true,commercialLicenceAccepted:false,formats:["docx","pdf"] as const};
}
export async function lockedLiveVersion(tx:Parameters<Parameters<typeof db.transaction>[0]>[0],id:string){
  await lockSourceState(tx);
  const[row]=await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id,id)).for("share");
  if(!row)throw new ValoProblem(404,"Template unavailable");
  const[policy]=await tx.select().from(valoPublicationPolicies).where(eq(valoPublicationPolicies.id,row.policyId));
  if(!policy||!releaseVisible(row,policy.hash)||!await sourceTargetAllowed(tx,"content",row.id,row.bundle))throw new ValoProblem(404,"Template withdrawn, expired or unavailable");
  const c=publicationSchema.parse(row.bundle).candidate;
  if(c.evidenceMode==="original_operational"){
    const current=await operationalPolicy();
    if(policy.hash!==current.policy.hash||!(await currentOperationalPermission(row)))
      throw new ValoProblem(404,"Template unavailable while applicable rights or policy evidence is unresolved.");
  }
  return row;
}
async function requirePurchaseForPricedMaster(tx:Parameters<Parameters<typeof db.transaction>[0]>[0],actor:WorkspaceActor,row:typeof valoContentVersions.$inferSelect){
  // Baseline TPL-01..12 are always free; a price record cannot silently change that contract.
  if(/^TPL-(0[1-9]|1[0-2])$/.test(row.templateId))return;
  const[price]=await tx.select({id:valoPrices.id}).from(valoPrices).where(eq(valoPrices.contentVersionId,row.id)).limit(1);
  if(!price)throw new ValoProblem(403,"An approved licence and server-verified purchase are required for this premium document.");
  const[grant]=await tx.select().from(valoEntitlements).where(and(eq(valoEntitlements.workspaceId,actor.workspaceId),
    eq(valoEntitlements.contentVersionId,row.id),eq(valoEntitlements.status,"active"))).for("share");
  if(!grant)throw new ValoProblem(403,"This workspace does not have an active purchase for this template version.");
}
export async function createReleasedTemplateDraft(actor:WorkspaceActor,id:string){
  developmentPublicationOnly();
  const documentId=await db.transaction(async tx=>{
    const row=await lockedLiveVersion(tx,id);
    await authorizeWorkspaceWrite(tx,actor);
    await requirePurchaseForPricedMaster(tx,actor,row);
    const document=documentInput.parse(JSON.parse(publicationSchema.parse(row.bundle).candidate.body));
    const documentId=await createDocumentInTransaction(tx,actor,document);
    await tx.update(valoDocuments).set({templateVersionId:id}).where(and(eq(valoDocuments.id,documentId),eq(valoDocuments.workspaceId,actor.workspaceId)));
    return documentId;
  });
  return getDocument(actor,documentId);
}
export async function readReleasedMaster(id:string,format:"docx"|"pdf",actor?:WorkspaceActor){
  developmentPublicationOnly();
  return db.transaction(async tx=>{
    const row=await lockedLiveVersion(tx,id);
    if(!actor)throw new ValoProblem(403,"Template unavailable without an authorised workspace.");
    await authorizeWorkspaceWrite(tx,actor);
    await requirePurchaseForPricedMaster(tx,actor,row);
    const a=row.attestations as {exports:Record<"docx"|"pdf",ArtifactRef>};
    return{bytes:await getPublicationArtifact(a.exports[format]),templateId:row.templateId,version:row.version};
  });
}
