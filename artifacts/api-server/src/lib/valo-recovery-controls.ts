import {createHmac,timingSafeEqual,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
const controlsSchema=z.object({snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),cutoff:z.string().datetime(),
  entries:z.array(z.object({id:z.string().uuid(),workspaceId:z.string().uuid(),identityId:z.string().startsWith("synthetic-recovery-"),
    kind:z.enum(["deletion","revocation"]),recordedAt:z.string().datetime()}).strict()).min(1).max(100)}).strict();
export type RecoveryControls=z.infer<typeof controlsSchema>;
export function signRecoveryControls(input:RecoveryControls,key:Buffer){
  return createHmac("sha256",key).update(JSON.stringify(controlsSchema.parse(input))).digest("hex");
}
export async function assertIsolatedRecoveryTarget(client:PoolClient){
  assertDevelopmentRuntime();
  if(process.env.VALO_ISOLATED_RECOVERY!=="synthetic-local-only")throw Error("EXPLICIT_ISOLATED_RECOVERY_REQUIRED");
  const {rows:[r]}=await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,current_setting('unix_socket_directories') AS sockets");
  if(r.name!=="valo_restore_target"||!r.directory.startsWith("/tmp/valo-recovery-")||
    !r.sockets.startsWith("/tmp/valo-recovery-"))throw Error("LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED");
}
/** Replay only into the guarded disposable target; not a production erasure processor. */
export async function replayRecoveryControls(client:PoolClient,raw:unknown,signature:string,key:Buffer,snapshotHash:string){
  const controls=controlsSchema.parse(raw);
  const expected=Buffer.from(signRecoveryControls(controls,key),"hex"),supplied=Buffer.from(signature,"hex");
  if(key.length<32||supplied.length!==expected.length||!timingSafeEqual(expected,supplied)||controls.snapshotHash!==snapshotHash)
    throw Error("RECOVERY_CONTROL_BINDING_FAILED");
  if(controls.entries.some(e=>Date.parse(e.recordedAt)<Date.parse(controls.cutoff)))throw Error("INVALID_RECOVERY_CONTROL_PERIOD");
  await assertIsolatedRecoveryTarget(client);
  await client.query("BEGIN");
  try{
    for(const e of controls.entries){
      const {rows}=await client.query("SELECT 1 FROM valo_workspaces WHERE id=$1 AND owner_identity_id LIKE 'synthetic-recovery-%'",[e.workspaceId]);
      if(rows.length!==1)throw Error("OWNED_SYNTHETIC_WORKSPACE_REQUIRED");
      await client.query("UPDATE valo_memberships SET active='no' WHERE workspace_id=$1 AND ($2='deletion' OR identity_id=$3)",[e.workspaceId,e.kind,e.identityId]);
      await client.query("UPDATE valo_export_jobs SET status='failed',error_code='RESTORE_ACCESS_QUARANTINED' WHERE workspace_id=$1",[e.workspaceId]);
      if(e.kind==="deletion")await client.query(`INSERT INTO valo_privacy_tombstones
        (id,workspace_id,case_id,identity_hash,phase) VALUES($1,$2,$3,$4,'restore_access_quarantined_purge_pending')
        ON CONFLICT(case_id) DO NOTHING`,[randomUUID(),e.workspaceId,e.id,createHmac("sha256",key).update(e.identityId).digest("hex")]);
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  return{entries:controls.entries.length,accessQuarantined:true,physicalErasureComplete:false,externalEffectsEnabled:false};
}
