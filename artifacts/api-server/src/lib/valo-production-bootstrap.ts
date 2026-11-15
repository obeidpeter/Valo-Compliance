import {rehearsalConfiguration} from "./valo-runtime-activation";
import {createHash} from "node:crypto";
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
/** Install the reviewed, pinned pg-boss 46 construction only in a fresh empty
 * rehearsal database. The caller's transaction also covers identity assignment. */
export async function prepareEmptyRehearsalQueue(query:Query,env:Record<string,string|undefined>,construction:string){
  const config=rehearsalConfiguration(env);
  if(env.VALO_EMPTY_DATABASE_BOOTSTRAP!=="approved-empty-rehearsal")throw Error("EXPLICIT_EMPTY_DATABASE_BOOTSTRAP_REQUIRED");
  await query("LOCK TABLE valo_workspaces,valo_privacy_cases,valo_orders IN SHARE ROW EXCLUSIVE MODE");
  const marker=await query("SELECT instance_id,environment FROM valo_runtime_identity WHERE singleton=true FOR UPDATE");
  if(marker.rows.length!==1||marker.rows[0].instance_id!==config.databaseId||marker.rows[0].environment!=="development")
    throw Error("NEW_DATABASE_IDENTITY_REQUIRED");
  const contents=await query("SELECT EXISTS(SELECT 1 FROM valo_workspaces) OR EXISTS(SELECT 1 FROM valo_privacy_cases) OR EXISTS(SELECT 1 FROM valo_orders) AS populated");
  if(contents.rows.length!==1||contents.rows[0].populated!==false)throw Error("EMPTY_DATABASE_REQUIRED");
  const existing=await query("SELECT to_regnamespace('valo_jobs') AS installed");
  if(existing.rows[0]?.installed)return; // Existing schemas are checked by preflight, never repaired.
  const sql=construction.replaceAll("\r\n","\n");
  if(createHash("sha256").update(sql).digest("hex")!=="be7a0612df5b9359833f32d2eea50fcdb8a5e60f36667646351c6abbd6f49b50")
    throw Error("PINNED_QUEUE_CONSTRUCTION_REQUIRED");
  const body=sql.trim();
  if(!body.startsWith("BEGIN;")||!body.endsWith("COMMIT;"))throw Error("QUEUE_TRANSACTION_SHAPE_INVALID");
  await query(body.slice("BEGIN;".length,-"COMMIT;".length));
  await query("SELECT valo_jobs.create_queue($1,$2::jsonb)",["valo-manual-export-v1",JSON.stringify({retryLimit:2,retryDelay:5,expireInSeconds:120})]);
  await query("SELECT valo_jobs.create_queue($1,$2::jsonb)",["valo-workspace-data-v1",JSON.stringify({retryLimit:0,expireInSeconds:360})]);
}
/** Caller owns a transaction. Never run automatically at process startup. */
export async function assignEmptyRehearsalDatabase(query:Query,env:Record<string,string|undefined>){
  const config=rehearsalConfiguration(env);
  if(env.VALO_EMPTY_DATABASE_BOOTSTRAP!=="approved-empty-rehearsal")throw Error("EXPLICIT_EMPTY_DATABASE_BOOTSTRAP_REQUIRED");
  await query("LOCK TABLE valo_workspaces,valo_privacy_cases,valo_orders,valo_jobs.job IN SHARE ROW EXCLUSIVE MODE");
  const marker=await query("SELECT instance_id,environment,storage_fingerprint FROM valo_runtime_identity WHERE singleton=true FOR UPDATE");
  if(marker.rows.length!==1||marker.rows[0].instance_id!==config.databaseId||marker.rows[0].environment!=="development"||marker.rows[0].storage_fingerprint!==null)
    throw Error("NEW_DATABASE_IDENTITY_REQUIRED");
  const contents=await query(`SELECT EXISTS(SELECT 1 FROM valo_workspaces) OR EXISTS(SELECT 1 FROM valo_privacy_cases)
    OR EXISTS(SELECT 1 FROM valo_orders) OR EXISTS(SELECT 1 FROM valo_jobs.job) AS populated`);
  if(contents.rows.length!==1||contents.rows[0].populated!==false)throw Error("EMPTY_DATABASE_REQUIRED");
  await query("UPDATE valo_runtime_identity SET environment='production-rehearsal',storage_fingerprint=$1 WHERE singleton=true",[config.storageFingerprint]);
  return {assigned:true,environment:"production-rehearsal",customerTrafficEnabled:false};
}
