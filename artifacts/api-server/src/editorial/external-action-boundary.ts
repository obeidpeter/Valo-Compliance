import {randomUUID} from "node:crypto";
import {db,valoPublicationAudit} from "@workspace/db";
import {sql} from "drizzle-orm";
import {developmentPublicationOnly} from "./operational-policy";
import {EditorialExternalActionDenied,editorialDenialReason} from "./editorial-evaluation-evidence";
/** Editorial services have no financial or filing capability. A durable
 * denial is committed before returning. No email, PSP, browser or government
 * transport exists behind this boundary; enabling one requires new scope. */
export async function dispatchEditorialExternalAction(versionId:string,action:"price"|"payment"|"government_filing",
  evaluationRunId:string|null=null):Promise<never>{
  developmentPublicationOnly();
  if(!/^[a-f0-9-]{36}$/i.test(versionId)||!["price","payment","government_filing"].includes(action)||
    evaluationRunId!==null&&!/^[a-f0-9-]{36}$/i.test(evaluationRunId))
    throw Error("INVALID_EDITORIAL_ACTION");
  const auditId=randomUUID();
  await db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    await tx.insert(valoPublicationAudit).values({id:auditId,versionId,action:"external_action_denied",
      actor:"bounded-publisher",reason:editorialDenialReason(action,evaluationRunId)});
  });
  // A receipt is exposed only after the durable transaction has committed.
  throw new EditorialExternalActionDenied({auditId,versionId,requestedAction:action,evaluationRunId});
}

