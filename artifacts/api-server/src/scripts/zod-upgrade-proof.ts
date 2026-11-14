import {randomUUID,createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createRequire} from "node:module";
import {eq} from "drizzle-orm";
import {db,pool,valoDocumentRevisions} from "@workspace/db";
import {synchronizeFinancialBlocks} from "@workspace/valo-core/money";
import {documentInput,profileInput} from "../lib/valo-validation";
import {serializeRevisionV1} from "../lib/valo-revision-codec";
import {syntheticDocument} from "../lib/valo-test-fixtures";
import {resolveWorkspace,createDocument} from "../lib/valo-store";
import {requestExport,getExport,downloadExport} from "../lib/valo-exports";
import {deletePrivateFile} from "../lib/valo-private-storage";
import {developmentPublicationOnly,publicationWorkspaceRoot} from "../editorial/operational-policy";
const hash=(text:string|Buffer)=>createHash("sha256").update(text).digest("hex");
const dir=resolve(publicationWorkspaceRoot(),"generated-artifacts/valo-zod-upgrade");
const file=resolve(dir,"before.json");
const require=createRequire(import.meta.url);
const version=JSON.parse(await readFile(require.resolve("zod/package.json"),"utf8")).version as string;
developmentPublicationOnly();
if(process.env.VALO_ZOD_UPGRADE_PROOF!=="synthetic-development-only")throw Error("EXPLICIT_SYNTHETIC_PROOF_REQUIRED");
await mkdir(dir,{recursive:true});
try{
  if(process.argv[2]==="before"){
    try{await readFile(file);throw Error("BEFORE_PROOF_ALREADY_EXISTS");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    if(!version.startsWith("3."))throw Error("BEFORE_MUST_CAPTURE_ACTUAL_LEGACY_RUNTIME");
    const documents=[structuredClone(syntheticDocument)];
    documents[0].content.blocks.push({id:"table",type:"table",text:"Synthetic stock rows; no statutory claims",
      rows:Array.from({length:40},(_,i)=>[`Synthetic item ${i+1}`,"₦123,456.78","User-entered test quantity"])});
    for(const kind of["invoice","quotation","payment_reminder","business_proposal"] as const){
      const document=structuredClone(syntheticDocument);
      document.content.financialInput={kind,lines:kind==="payment_reminder"?[]:[{description:"Synthetic work",quantity:"1.5",unitPriceKobo:"10000"}],
        taxAmountKobo:null,taxLabel:"",discountKobo:null,amountDueKobo:kind==="payment_reminder"?"8000":null,
        ...(kind==="payment_reminder"?{paymentRecord:{invoiceAmountKobo:"10000",payments:[{reference:"SYNTHETIC-PARTIAL",amountKobo:"2000"}]}}:{})};
      document.content=synchronizeFinancialBlocks(document.content);documents.push(document);
    }
    const fixtures=documents.flatMap((d,i)=>[d,{...structuredClone(d),title:`Synthetic variant ${i}`,
      content:{...structuredClone(d.content),formatting:{font:"serif" as const,accent:"charcoal" as const}}}])
      .map(input=>({input,legacyHash:hash(JSON.stringify(documentInput.parse(input)))}));
    const actor=await resolveWorkspace(`synthetic-zod-upgrade-${randomUUID()}`);
    const stored=[];
    for(const input of[documents[0],documents[3]]){
      const document=await createDocument(actor,input);
      const[revision]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.documentId,document.id));
      stored.push({documentId:document.id,revisionId:revision.id,contentHash:revision.contentHash});
    }
    await writeFile(file,JSON.stringify({capturedAt:new Date().toISOString(),legacyRuntime:version,actor,fixtures,stored},null,2)+"\n");
    console.log(JSON.stringify({stage:"before",runtime:version,fixtures:fixtures.length,savedLegacyRevisions:stored.length,providerCalls:0}));
  }else if(process.argv[2]==="after"){
    if(version!=="4.6.7")throw Error("PATCHED_NATIVE_RUNTIME_REQUIRED");
    const before=JSON.parse(await readFile(file,"utf8"));
    if(!before.actor.identityId.startsWith("synthetic-zod-upgrade-"))throw Error("OWN_SYNTHETIC_ACTOR_REQUIRED");
    const fixtures=before.fixtures as {input:unknown;legacyHash:string}[];
    const checked=fixtures.map((f,index)=>({index,legacyHash:f.legacyHash,
      actualHash:hash(JSON.stringify(documentInput.parse(f.input))),
      frozenCodecHash:hash(serializeRevisionV1(documentInput.parse(f.input)))}));
    if(checked.some(f=>f.legacyHash!==f.actualHash||f.legacyHash!==f.frozenCodecHash))throw Error("LEGACY_SERIALIZATION_CHANGED");
    const profiles=before.profiles.map((f:{input:unknown;legacyHash:string})=>({
      legacyHash:f.legacyHash,actualHash:hash(JSON.stringify(profileInput.parse(f.input)))}));
    if(profiles.some((f:{legacyHash:string;actualHash:string})=>f.legacyHash!==f.actualHash))throw Error("PROFILE_SERIALIZATION_CHANGED");
    const stored=[...before.stored];
    const fresh=await createDocument(before.actor,fixtures[0].input);
    const[newRevision]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.documentId,fresh.id));
    stored.push({documentId:fresh.id,revisionId:newRevision.id,contentHash:newRevision.contentHash});
    const exports=[];
    for(const item of stored){
      for(const format of["docx","pdf"] as const){
        const job=await requestExport(before.actor,item.documentId,randomUUID(),{revisionId:item.revisionId,format,acknowledgeDraft:true});
        const deadline=Date.now()+90000;
        let ready=await getExport(before.actor,job.id);
        while(!["ready","failed"].includes(ready.job.status)&&Date.now()<deadline){
          await new Promise(resolve=>setTimeout(resolve,500));ready=await getExport(before.actor,job.id);
        }
        if(ready.job.status!=="ready")throw Error("ACTUAL_WORKER_EXPORT_NOT_READY");
        const result=await downloadExport(before.actor,job.id);
        await writeFile(resolve(dir,`${item.revisionId}.${format}`),result.bytes);
        exports.push({revisionId:item.revisionId,format,size:result.bytes.length,sha256:hash(result.bytes),
          privateStorageRead:true,status:ready.job.status});
      }
      const[row]=await db.select().from(valoDocumentRevisions).where(eq(valoDocumentRevisions.id,item.revisionId));
      if(row.contentHash!==item.contentHash)throw Error("HISTORICAL_HASH_REWRITTEN");
    }
    const report={executedAt:new Date().toISOString(),runtime:version,legacyRuntime:before.legacyRuntime,fixtures:checked,profiles,
      actualManagedDevelopmentDatabase:true,actualSeparateWorker:true,exports,oldRevisions:before.stored.length,newRevisions:1,
      historicalHashesRewritten:0,providerCalls:0,productionRecoveryClaimed:false};
    await writeFile(resolve(dir,"after.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({stage:"after",runtime:version,fixtures:checked.length,exports:exports.length,historicalHashesRewritten:0}));
  }else if(process.argv[2]==="cleanup"){
    const before=JSON.parse(await readFile(file,"utf8"));
    const reportPath=resolve(dir,"after.json"),report=JSON.parse(await readFile(reportPath,"utf8"));
    const actor=before.actor;
    if(!actor.identityId.startsWith("synthetic-zod-upgrade-")||report.exports.length!==6||
      report.historicalHashesRewritten!==0)throw Error("COMPLETED_OWN_SYNTHETIC_PROOF_REQUIRED");
    const members=await pool.query("SELECT identity_id FROM valo_memberships WHERE workspace_id=$1",[actor.workspaceId]);
    if(members.rows.length!==1||members.rows[0].identity_id!==actor.identityId)throw Error("OWN_SINGLE_MEMBER_SCOPE_REQUIRED");
    const assets=await pool.query("SELECT object_key FROM valo_file_assets WHERE workspace_id=$1",[actor.workspaceId]);
    for(const row of assets.rows){
      if(!row.object_key.startsWith(`valo/development/${actor.workspaceId}/`))throw Error("OWN_PRIVATE_OBJECT_REQUIRED");
      await deletePrivateFile(row.object_key);
    }
    const connection=await pool.connect();
    try{
      await connection.query("BEGIN");
      for(const table of["valo_export_requests","valo_export_objects","valo_file_assets","valo_export_jobs",
        "valo_document_revisions","valo_documents","valo_events","valo_memberships","valo_workspaces"])
        await connection.query(`DELETE FROM ${table} WHERE ${table==="valo_workspaces"?"id":"workspace_id"}=$1`,[actor.workspaceId]);
      await connection.query("COMMIT");
    }catch(e){await connection.query("ROLLBACK");throw e;}finally{connection.release();}
    report.cleanup={ownSyntheticWorkspaceRemoved:true,ownPrivateObjectsRemoved:assets.rows.length,providerUsageHistoryUntouched:true};
    await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report.cleanup));
  }else throw Error("EXPECTED_BEFORE_AFTER_OR_CLEANUP");
}finally{await pool.end();}
