import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve,dirname } from "node:path";
import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";
export function publicationWorkspaceRoot(){
  let dir=process.cwd();
  for(let i=0;i<6;i++,dir=dirname(dir))if(existsSync(resolve(dir,"docs/specification/master-execution-prompt.txt")))return dir;
  throw Error("OWNER_AUTHORITY_FILES_UNAVAILABLE");
}
// Production is intentionally not authorised by this policy.
export function developmentPublicationOnly(){
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT)throw Error("DEVELOPMENT_PUBLICATION_ONLY");
}
export async function operationalPolicy(){
  const refs=[
    {path:"docs/specification/master-execution-prompt.txt",quote:"Do not require routine per-item human or professional sign-off."},
    {path:"docs/valo/policies/operational-publication-authority.md",quote:"Regulatory citations are required for regulatory claims, not invented to decorate original non-regulatory fields."},
  ];
  const authority=[];
  for(const ref of refs){
    const text=await readFile(resolve(publicationWorkspaceRoot(),ref.path),"utf8");
    if(!text.includes(ref.quote))throw Error("OWNER_AUTHORITY_EXCERPT_MISSING");
    authority.push({...ref,hash:sha256(text),text});
  }
  const scopeQuote=authority[0]!.text.split(/\r?\n/).find(line=>
    line.includes("The independently permissioned publisher may publish eligible content automatically when all mandatory gates pass."));
  if(!scopeQuote)throw Error("ORIGINAL_MASTER_PUBLICATION_SCOPE_NOT_FOUND");
  const body={
    version:"r1-evidence-gated-development-2",ownerApproved:true,
    allowedClasses:["general_template","sourced_guidance"],jurisdictions:["NG","NG-LA","NG-FC","NG-BY"],
    risks:["general","tax","employment","privacy","governance","contracts","regulated_sector"],
    officialHosts:["openai.com","help.openai.com","icrp.cac.gov.ng","cac.gov.ng","ndpc.gov.ng","www.ncc.gov.ng",
      "www.nrs.gov.ng","nrs.gov.ng","nafdac.gov.ng","son.gov.ng","www.pencom.gov.ng","nipc.gov.ng","www.nipc.gov.ng"],
    blockedActivities:["bespoke_legal_opinions","invented_tax_rates","guaranteed_legal_validity","sales","public_launch","confidential_customer_data","government_filings","payment_movement"],
    originalOperationalIds:Array.from({length:40},(_,i)=>`TPL-${String(i+1).padStart(2,"0")}`),
    authorityRefs:[...authority.map(({text:_text,...ref})=>ref),
      {path:refs[0]!.path,hash:authority[0]!.hash,quote:scopeQuote.trim()}],developmentOnly:true,
  };
  return{policy:{...body,hash:digest(body)} as PublicationBundle["policy"],authority};
}
