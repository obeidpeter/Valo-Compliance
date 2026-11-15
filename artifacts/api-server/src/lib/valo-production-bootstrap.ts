import {rehearsalConfiguration} from "./valo-runtime-activation";
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
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
