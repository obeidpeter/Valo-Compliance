import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@workspace/db";
import {referenceFor} from "../editorial/source-fetch";
import {lockSourceState,sourceTime,type SourceTx} from "./valo-source-state";
import {impactSourceDependants,processSourceDependencyJob,processSourceImpact,queueExpiredSourceReviews} from "./valo-source-corrections";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
export async function registerSourceWatch(tx:SourceTx,id:string){
 const source=referenceFor(id); // No request URL or newly discovered domain is fetched.
 await tx.execute(sql`insert into valo_source_watches(source_id,url,risk) values(${source.id},${source.url},'high') on conflict(source_id) do nothing`);
}
export async function scheduleSourceChecks(now=new Date()){
 return db.transaction(async tx=>{
  const sources=await tx.execute(sql`select source_id from valo_source_watches where next_check_at<=${now} order by next_check_at,source_id for update skip locked limit 10`);
  for(const source of sources.rows){
   await tx.execute(sql`insert into valo_source_check_jobs(id,source_id,day,status) values(${randomUUID()}::uuid,${String(source.source_id)},${now.toISOString().slice(0,10)}::date,'pending') on conflict(source_id,day) do nothing`);
   await tx.execute(sql`update valo_source_watches set next_check_at=${new Date(+now+86400000)} where source_id=${String(source.source_id)}`);
  }
 });
}
type Claim={id:string;source_id:string;token:string};
export async function claimSourceCheck(now=new Date()):Promise<Claim|null>{
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(7502602)`);
  if((await tx.execute(sql`select id from valo_source_check_jobs where status='running' and lease_until>${now} limit 1`)).rows.length)return null;
  const row=(await tx.execute(sql`select id,source_id,attempts from valo_source_check_jobs
   where status='pending' or (status='running' and lease_until<=${now}) order by created_at,id for update skip locked limit 1`)).rows[0];
  if(!row)return null;
  if(Number(row.attempts)>=3){
   await tx.execute(sql`update valo_source_check_jobs set status='complete',result='SOURCE_ATTEMPT_LIMIT',lease_token=null,lease_until=null where id=${String(row.id)}::uuid`);
   await tx.execute(sql`update valo_source_watches set failure_code='SOURCE_ATTEMPT_LIMIT' where source_id=${String(row.source_id)}`);
   return null;
  }
  const token=randomUUID();
  // Source fetch/extraction/storage has its own finite transport limits. The
  // five-minute lease bounds abandoned jobs; late results cannot win a new lease.
  await tx.execute(sql`update valo_source_check_jobs set status='running',attempts=attempts+1,lease_token=${token}::uuid,lease_until=${new Date(+now+300000)} where id=${String(row.id)}::uuid`);
  return{id:String(row.id),source_id:String(row.source_id),token};
 });
}
export async function completeSourceCheck(claim:Claim,snapshotId:string|null,now=new Date()){
 return db.transaction(async tx=>{
  await lockSourceState(tx,true);
  const job=(await tx.execute(sql`select * from valo_source_check_jobs where id=${claim.id}::uuid for update`)).rows[0];
  if(!job||job.status!=="running"||job.lease_token!==claim.token||!job.lease_until||sourceTime(job.lease_until)<=+now)return false;
  const prior=(await tx.execute(sql`select * from valo_source_watches where source_id=${claim.source_id} for update`)).rows[0]!;
  const snapshot=snapshotId?(await tx.execute(sql`select * from valo_source_snapshots where id=${snapshotId}::uuid and source_id=${claim.source_id}`)).rows[0]:null;
  const okay=!!snapshot&&snapshot.status==="retrieved_unreviewed"&&snapshot.raw_checksum&&snapshot.text_checksum&&snapshot.raw_object_key&&snapshot.text_object_key;
  const failure=okay?null:String(snapshot?.failure_code??"SOURCE_CAPTURE_UNCONFIRMED");
  await tx.execute(sql`update valo_source_check_jobs set status='complete',snapshot_id=${snapshot?String(snapshot.id):null}::uuid,
   result=${failure??(prior.last_raw_hash&&prior.last_raw_hash!==snapshot!.raw_checksum?"SOURCE_CHANGED":"SOURCE_CAPTURED")},lease_token=null,lease_until=null where id=${claim.id}::uuid`);
  await tx.execute(sql`update valo_source_watches set checked_at=${now},failure_code=${failure},
   last_snapshot_id=case when ${Boolean(okay)} then ${snapshot?String(snapshot.id):null}::uuid else last_snapshot_id end,
   last_raw_hash=case when ${Boolean(okay)} then ${snapshot?String(snapshot.raw_checksum):null} else last_raw_hash end where source_id=${claim.source_id}`);
  if(!okay||prior.last_raw_hash&&prior.last_raw_hash!==snapshot!.raw_checksum)
   await impactSourceDependants(tx,claim.source_id,okay?"The official source bytes changed; claims require fresh review.":"The official source could not be verified by the daily check.",`check:${claim.id}`,snapshot?String(snapshot.id):null);
  return true;
 });
}
let captureInFlight:Promise<string>|null=null;
export async function reconcileSourceMonitoring(){
 assertDevelopmentRuntime();
 await scheduleSourceChecks();
 // One bounded source fetch per wake-up. No provider review or external message
 // is performed; required review work remains explicitly held for authorization.
 const claim=captureInFlight?null:await claimSourceCheck();
 if(claim){
  let id:string|null=null,timer:ReturnType<typeof setTimeout>|undefined;
  const capture=(async()=>(await (await import("../editorial/source-capture")).captureReference(claim.source_id)).id)();
  captureInFlight=capture;
  void capture.finally(()=>{if(captureInFlight===capture)captureInFlight=null;}).catch(()=>{});
  try{id=await Promise.race([capture,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("SOURCE_CAPTURE_TIMEOUT")),180000);})]);}
  catch{/* Unconfirmed capture is held; a late artifact cannot complete this job. */}
  finally{if(timer)clearTimeout(timer);}
  await completeSourceCheck(claim,id);
 }
 await queueExpiredSourceReviews();
 for(let n=0;n<8;n++){const dependencies=await processSourceDependencyJob(),impact=await processSourceImpact();if(!dependencies&&!impact)break;}
}
