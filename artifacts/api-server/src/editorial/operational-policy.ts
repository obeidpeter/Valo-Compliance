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
  const body={
    version:"operational-development-1",ownerApproved:true,
    allowedClasses:["general_template"],jurisdictions:["NG"],risks:["general"],
    officialHosts:["openai.com","help.openai.com"],
    blockedActivities:["regulatory_claims","legal_opinions","tax_rates","legal_validity","sales","public_launch","confidential_customer_data"],
    originalOperationalIds:["TPL-06","TPL-07"],
    authorityRefs:authority.map(({text:_text,...ref})=>ref),developmentOnly:true,
  };
  return{policy:{...body,hash:digest(body)} as PublicationBundle["policy"],authority};
}
