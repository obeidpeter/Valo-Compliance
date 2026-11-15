import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@workspace/db";
import {privacyKey,privacySigner} from "./valo-privacy-keys";
export const removedPrivateText="[Private content removed by verified workspace erasure]";
export const erasureProgressReason="Verified synthetic workspace erasure; per-system exclusions remain recorded.";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type SourceRow={id:string;workspace_id:string;reason:string;[key:string]:unknown};
type Table="valo_privacy_events"|"valo_refund_transitions";
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,entry])=>[key,canonical(entry)]));
  return value;
}
function digest(value:unknown){return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");}
function mac(proof:unknown,key:string){
  return createHmac("sha256",key).update("valo/privacy/redaction/v1\0"+digest(proof)).digest("hex");
}
/** Called only after the current case and, for privacy history, each source
 * case's entire original chain have been verified. Source and witness commit
 * in the same transaction; no old plaintext is kept in the witness. */
export async function redactAuditReason(tx:Tx,table:Table,row:SourceRow){
  if(row.reason===removedPrivateText)return;
  const projection={...row,reason:removedPrivateText},signer=await privacySigner(tx);
  const proof={version:1,table,rowId:row.id,workspaceId:row.workspace_id,
    originalHash:digest(row),originalEventHash:row.event_hash??null,
    projectionHash:digest(projection),keyVersion:signer.version};
  const previous=await tx.execute<{proof:typeof proof;projection:unknown;key_version:string;mac:string}>(sql`
    SELECT proof,projection,key_version,mac FROM valo_privacy_redactions
    WHERE table_name=${table} AND row_id=${row.id}::uuid FOR SHARE`);
  if(previous.rows[0]){
    const old=previous.rows[0],expected=mac(old.proof,await privacyKey(tx,old.key_version));
    if(!/^[a-f0-9]{64}$/.test(old.mac)||!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(old.mac,"hex"))||
      old.proof.table!==table||old.proof.rowId!==row.id||old.proof.workspaceId!==row.workspace_id||
      old.proof.keyVersion!==old.key_version||old.proof.originalHash!==digest(row)||
      old.proof.projectionHash!==digest(projection)||digest(old.projection)!==digest(projection))
      throw Error("PRIVACY_REDACTION_REPLAY_CHANGED");
  }else await tx.execute(sql`INSERT INTO valo_privacy_redactions(table_name,row_id,workspace_id,projection,proof,key_version,mac)
      VALUES(${table},${row.id}::uuid,${row.workspace_id}::uuid,${JSON.stringify(projection)}::jsonb,
        ${JSON.stringify(proof)}::jsonb,${signer.version},${mac(proof,signer.key)})`);
  await tx.execute(sql`UPDATE ${sql.identifier(table)} SET reason=${removedPrivateText}
    WHERE id=${row.id}::uuid AND workspace_id=${row.workspace_id}::uuid`);
}
export async function verifiedPrivacyRedaction(tx:Tx,eventId:string,workspaceId:string,eventHash:string){
  const result=await tx.execute<{proof:Record<string,unknown>;projection:unknown;actual:unknown;key_version:string;mac:string}>(sql`
    SELECT r.proof,r.projection,r.key_version,r.mac,to_jsonb(e) AS actual FROM valo_privacy_redactions r
    JOIN valo_privacy_events e ON e.id=r.row_id AND e.workspace_id=r.workspace_id
    WHERE r.table_name='valo_privacy_events' AND r.row_id=${eventId}::uuid AND r.workspace_id=${workspaceId}::uuid`);
  const row=result.rows[0];if(!row)return false;
  const expected=mac(row.proof,await privacyKey(tx,row.key_version));
  if(!/^[a-f0-9]{64}$/.test(row.mac)||!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(row.mac,"hex"))||
    row.proof.table!=="valo_privacy_events"||row.proof.rowId!==eventId||row.proof.workspaceId!==workspaceId||
    row.proof.originalEventHash!==eventHash||row.proof.keyVersion!==row.key_version||
    row.proof.projectionHash!==digest(row.projection)||digest(row.actual)!==digest(row.projection))
    throw Error("PRIVACY_REDACTION_PROOF_INVALID");
  return true;
}
