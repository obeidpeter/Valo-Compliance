import {realpath,lstat} from "node:fs/promises";
import {resolve,basename,join} from "node:path";
import type {PoolClient} from "pg";
/** Windows is an additional disposable target, never a generic remote-DB override. */
export function windowsRecoveryBinding(state:{name:string;directory:string;port:string;address:string;user:string},connection:URL,root:string){
  const normalize=(p:string)=>p.replaceAll("\\","/").toLowerCase();
  if(state.name!=="valo_restore_target"||state.user!=="valo_recovery_owner"||state.address!=="127.0.0.1"||
    state.port!=="55439"||normalize(state.directory)!==normalize(join(root,"data"))||
    connection.protocol!=="postgresql:"||connection.hostname!=="127.0.0.1"||connection.port!==state.port||
    connection.username!==state.user||connection.pathname!=="/valo_restore_target"||connection.search||!connection.password)
    throw Error("LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED");
}
export async function assertWindowsRecoveryTarget(client:PoolClient){
  const root=process.env.VALO_RECOVERY_WINDOWS_ROOT??"";
  if(process.platform!=="win32"||!/^valo-recovery-[a-f0-9-]{36}$/.test(basename(root))||
    resolve(root)!==root||await realpath(root)!==root||(await lstat(root)).isSymbolicLink())
    throw Error("LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED");
  const state=(await client.query(`SELECT current_database() AS name,current_user AS "user",
    current_setting('data_directory') AS directory,current_setting('port') AS port,host(inet_server_addr()) AS address`)).rows[0];
  windowsRecoveryBinding(state,new URL(process.env.DATABASE_URL??""),root);
  const {rows}=await client.query("SELECT EXISTS(SELECT 1 FROM valo_workspaces WHERE owner_identity_id NOT LIKE 'synthetic-recovery-%') AS unsafe");
  if(rows.length!==1||rows[0].unsafe!==false)throw Error("OWNED_SYNTHETIC_RECOVERY_DATABASE_REQUIRED");
}
