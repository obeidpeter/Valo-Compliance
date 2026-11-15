import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db,valoPublicationAudit} from "@workspace/db";
import {publishOperationalVersionInTransaction} from "./publication-publisher";
import {developmentPublicationOnly} from "./operational-policy";
export const editorialRestrictedRoles=["valo_content_drafter_dev","valo_content_reviewer_dev"] as const;
function sqlState(error:unknown):string|undefined{
  for(let n=0;n<5&&error;n++){const item=error as {code?:string;cause?:unknown};if(item.code)return item.code;error=item.cause;}
}
/** Actual PostgreSQL role checks followed by separate durable coordinator audit.
 * Neither a denied role nor an AI result is allowed to suppress the audit. */
export async function evaluateEditorialPermissionDenials(versionId:string,runId:string){
  developmentPublicationOnly();
  assert.match(versionId,/^[a-f0-9-]{36}$/);assert.match(runId,/^[a-f0-9-]{36}$/);
  const receipts=[];
  for(const role of editorialRestrictedRoles){
    for(const operation of ["publish_call","publication_update","policy_update"] as const){
      let observed:string|undefined;
      try{await db.transaction(async tx=>{
        await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
        if(operation==="publish_call")await publishOperationalVersionInTransaction(tx,versionId);
        else if(operation==="publication_update")await tx.execute(sql`update valo_content_versions set status=status where id=${versionId}::uuid`);
        else await tx.execute(sql`update valo_publication_policies set hash=hash where false`);
        throw Error("EDITORIAL_DENIAL_NOT_ENFORCED");
      });}catch(error){
        if((error as Error).message==="EDITORIAL_ROLE_CANNOT_PUBLISH")observed="EDITORIAL_ROLE_CANNOT_PUBLISH";
        else observed=sqlState(error);
      }
      const expected=operation==="publish_call"?"EDITORIAL_ROLE_CANNOT_PUBLISH":"42501";
      assert.equal(observed,expected,`Exact ${role}/${operation} boundary must deny; missing roles are not a pass.`);
      const id=randomUUID(),reason=`Evaluation ${runId}; ${role}; ${operation}; observed ${observed}; no mutation committed.`;
      await db.insert(valoPublicationAudit).values({id,versionId,action:"role_action_denied",actor:role,reason});
      const saved=(await db.execute(sql`select id,actor,reason from valo_publication_audit where id=${id}::uuid and version_id=${versionId}::uuid`)).rows[0];
      assert.equal(saved?.actor,role);assert.equal(saved?.reason,reason);
      receipts.push({auditId:id,role,operation,observed});
    }
  }
  return{evaluationRunId:runId,receipts,privateRowsRead:0,publicationChanges:0,policyChanges:0,providerCalls:0};
}
