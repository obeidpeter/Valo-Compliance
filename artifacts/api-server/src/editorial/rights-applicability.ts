import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "./operational-policy";
const schema=z.object({
  version:z.string().min(1),status:z.enum(["verified","unverified"]),accountPlan:z.string().min(1),
  accountTerms:z.string().min(1).nullable(),integration:z.literal("replit_managed_openai"),provider:z.literal("openai"),
  commercialUseScope:z.literal("blank_operational_forms_internal_business_licence").nullable(),
  checkedAt:z.string().datetime().nullable(),limitations:z.array(z.string()),
  evidence:z.array(z.object({kind:z.enum(["account","integration","provider"]),url:z.string().url(),
    hash:z.string().regex(/^[a-f0-9]{64}$/),locator:z.string().min(1),quote:z.string().min(1),
    applicabilityEvidence:z.string().min(1)}).strict()),
}).strict();
export function verifiedRightsApplicability(input:unknown,now=new Date()){
  const parsed=schema.safeParse(input);if(!parsed.success)return false;
  const record=parsed.data;
  const age=record.checkedAt?+now-Date.parse(record.checkedAt):Infinity;
  return record.status==="verified"&&record.accountPlan!=="unverified"&&Boolean(record.accountTerms)&&
    record.commercialUseScope!==null&&["account","integration","provider"].every(k=>record.evidence.some(e=>e.kind===k))&&
    age>=0&&age<=90*86400_000;
}
export async function loadRightsApplicability(){
  const bytes=await readFile(resolve(publicationWorkspaceRoot(),"docs/valo/policies/provider-rights-applicability.json"));
  const record=schema.parse(JSON.parse(bytes.toString()));
  return{record,hash:sha256(bytes),verified:verifiedRightsApplicability(record)};
}
