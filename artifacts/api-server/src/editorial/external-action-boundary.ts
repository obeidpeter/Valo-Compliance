import {randomUUID} from "node:crypto";
import {db,valoPublicationAudit} from "@workspace/db";
import {sql} from "drizzle-orm";
import {developmentPublicationOnly} from "./operational-policy";
/** Editorial services have no financial or filing capability. A durable
 * denial is committed before returning. No email, PSP, browser or government
 * transport exists behind this boundary; enabling one requires new scope. */
export async function dispatchEditorialExternalAction(versionId:string,action:"price"|"payment"|"government_filing"):Promise<never>{
  developmentPublicationOnly();
  if(!/^[a-f0-9-]{36}$/i.test(versionId)||!["price","payment","government_filing"].includes(action))
    throw Error("INVALID_EDITORIAL_ACTION");
  await db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    await tx.insert(valoPublicationAudit).values({id:randomUUID(),versionId,action:"external_action_denied",
      actor:"bounded-publisher",reason:`Editorial scope excludes ${action}; no external action dispatched.`});
  });
  throw Error("EDITORIAL_EXTERNAL_ACTION_FORBIDDEN");
}
