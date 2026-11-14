import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { sha256,digest } from "@workspace/valo-core";
import { putPublicationArtifact } from "./publication-artifacts";
import { originalFormSchema,formMarkdown } from "./operational-authoring-contract";
export async function recordOriginalAuthoring(){
  const prompt="Write five short original paragraphs for a blank optional inventory-record form. No copying or quoting any document. Purpose and optional operational instructions for register details, item/unit/location records, stock receipts/issues/adjustments, and physical counts/discrepancies. No invented user facts, names, quantities, computed values, laws, duties, tax, fees, legal validity, ownership assurance, safety certification, provider rights or platform capability statements. Keep instructions optional internal business practice, not legal requirements. Do not introduce a formula or mandatory retention period. All actual facts will be blank fields supplied separately. Return the exact JSON schema.";
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(747105)`);
    const r=await tx.execute(sql`select count(*)::int as total from valo_publication_ai_attempts where role='draft' and created_at >= date_trunc('day',now())`);
    if(Number(r.rows[0]?.total)>=1)throw Error("ORIGINAL_AUTHORING_DAILY_CAP_REACHED");
    await tx.execute(sql`insert into valo_publication_ai_attempts(candidate_hash,role) values(${digest(prompt)} ,'draft')`);
  });
  const schema=z.toJSONSchema(originalFormSchema,{target:"draft-7"});delete schema.$schema;
  const response=await openai.chat.completions.create({
    model:"gpt-5.4-mini",max_completion_tokens:8192,
    messages:[{role:"system",content:"You are a bounded original operational-form author. No tools or customer context. Do not publish, review yourself or change policy."},{role:"user",content:prompt}],
    response_format:{type:"json_schema",json_schema:{name:"original_inventory_prose",strict:true,schema}},
  },{timeout:45000,maxRetries:0});
  if(response.choices[0]?.finish_reason!=="stop")throw Error("AUTHORING_INCOMPLETE");
  const output=originalFormSchema.parse(JSON.parse(response.choices[0].message.content??""));
  if(Object.values(output).some(t=>t.length>1500||/\b(?:must|shall|statutory|tax|legally|copyright|licensed|certified|guaranteed)\b/i.test(t)))
    throw Error("AUTHORING_OUTSIDE_OPERATIONAL_SCHEMA");
  const receipt={role:"draft",model:response.model,providerResponseId:response.id,promptVersion:"original-inventory-authoring-1",
    promptHash:digest(prompt),output,inputTokens:response.usage?.prompt_tokens??null,
    outputTokens:response.usage?.completion_tokens??null,createdAt:new Date(response.created*1000).toISOString(),
    sourceText:JSON.stringify(output)};
  const artifact=await putPublicationArtifact(Buffer.from(JSON.stringify(receipt)),"json");
  return{receipt,artifact,original:formMarkdown(output)};
}
