import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {eq} from "drizzle-orm";
import {db,valoContentVersions} from "@workspace/db";
import {candidateDigest,publicationSchema} from "@workspace/valo-core";
import {requestDigest} from "./inference-budget";
import type {FiniteWork} from "./inference-batch-dispatch";
const root=resolve(import.meta.dirname,"../../../..");
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
/** Bindings are read from the approved durable allowlist, not from request
 * headers. Held source candidates may be challenged in isolation: this is NOT
 * a released-content manifest or customer-rule eligibility check. */
export async function assertFiniteWorkBindings(work:FiniteWork){
  const b=work.bindings;if(!b)throw Error("FINITE_WORK_BINDINGS_MISSING");
  const actualSources:string[]=[];
  for(const f of b.sourceFiles){
    if(!/^docs\/[a-zA-Z0-9_./ -]+$/.test(f.path)||f.path.split("/").some(p=>p===".."||p==="."))
      throw Error("SOURCE_BINDING_PATH_REJECTED");
    const actual=hash(await readFile(resolve(root,f.path)));
    if(actual!==f.sha256)throw Error("SOURCE_BINDING_CHANGED");
    actualSources.push(actual);
  }
  if(b.corpus){
    if(!["editorial","checker","customer-ai"].includes(b.corpus)||!b.caseId)throw Error("CASE_BINDING_REQUIRED");
    const corpus=JSON.parse(await readFile(resolve(root,`docs/evaluation-candidates/${b.corpus}.json`),"utf8")) as
      {cases:Record<string,unknown>[]};
    const row=corpus.cases.find(c=>[c.id,c.caseID,c.scenarioId,c.scenarioID].includes(b.caseId));
    if(!row||requestDigest(row)!==work.caseHash)throw Error("CASE_BINDING_CHANGED");
    if(work.lane==="customer"&&work.candidateHash!==work.caseHash)throw Error("CUSTOMER_CASE_BINDING_CHANGED");
  }else if(work.lane!=="publication")throw Error("EVALUATION_CASE_REQUIRED");
  if(b.candidateVersionId){
    const[row]=await db.select().from(valoContentVersions).where(eq(valoContentVersions.id,b.candidateVersionId));
    if(!row||["withdrawn","superseded"].includes(row.status)||row.reviewBy.getTime()<=Date.now())throw Error("CANDIDATE_UNAVAILABLE_OR_STALE");
    const bundle=publicationSchema.parse(row.bundle);
    if(row.candidateHash!==work.candidateHash||candidateDigest(bundle.candidate)!==work.candidateHash)
      throw Error("CANDIDATE_BINDING_CHANGED");
    actualSources.push(...bundle.sources.map(s=>s.hash));
    if(requestDigest(bundle)!==work.caseHash&&work.lane==="publication")throw Error("PUBLICATION_BUNDLE_CHANGED");
  }else if(work.lane!=="customer")throw Error("CANDIDATE_VERSION_REQUIRED");
  if(work.lane==="checker_challenge"&&!actualSources.length)throw Error("CHECKER_SOURCE_BINDING_REQUIRED");
  if(requestDigest([...actualSources].sort())!==requestDigest([...work.sourceHashes].sort()))throw Error("SOURCE_SET_CHANGED");
}
