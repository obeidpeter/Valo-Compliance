import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod/v4";
import { candidateSchema,reviewSchema,editorialModel,systemPrompt,type EditorialRole } from "./pipeline-contract";
export async function callEditorialModel(role:EditorialRole,input:unknown){
  const schema=role==="draft"?candidateSchema:reviewSchema;
  const jsonSchema=z.toJSONSchema(schema,{target:"draft-7"});delete jsonSchema.$schema;
  const started=performance.now();
  const response=await openai.chat.completions.create({
    model:editorialModel,max_completion_tokens:8192,
    messages:[{role:"system",content:systemPrompt(role)},{role:"user",content:JSON.stringify(input)}],
    response_format:{type:"json_schema",json_schema:{name:role==="draft"?"valo_editorial_candidate":"valo_editorial_review",strict:true,schema:jsonSchema}},
    // No tools or customer/private-workspace context is supplied.
  },{timeout:45000,maxRetries:0});
  if(response.choices[0]?.finish_reason!=="stop"||!response.choices[0]?.message.content)
    throw Error("AI_OUTPUT_INCOMPLETE");
  let output:unknown;
  try{output=schema.parse(JSON.parse(response.choices[0].message.content));}
  catch{throw Error("AI_OUTPUT_SCHEMA_INVALID");}
  return{output,providerResponseId:response.id,providerRequestId:response._request_id??null,
    actualModel:response.model,latencyMs:Math.round(performance.now()-started),
    inputTokens:response.usage?.prompt_tokens??null,outputTokens:response.usage?.completion_tokens??null};
}
