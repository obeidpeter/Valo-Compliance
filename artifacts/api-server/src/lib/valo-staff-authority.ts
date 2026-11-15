import {and,eq,or,isNull,sql} from "drizzle-orm";
import {db,valoStaffAssignments} from "@workspace/db";
import {ValoProblem} from "./valo-problem";
export type StaffActor={identityId:string;recentMfa:boolean;verifiedAt:number};
/** Use the database wall clock, including after row-lock waits. Expiry never
 * depends on a worker sweep or a caller-supplied time. */
export function activeStaffAssignment(){
 return and(eq(valoStaffAssignments.active,true),or(isNull(valoStaffAssignments.expiresAt),
   sql`${valoStaffAssignments.expiresAt} > clock_timestamp()`));
}
export function requireFreshStaffSession(actor:StaffActor){
 if(!actor.recentMfa||!Number.isFinite(actor.verifiedAt)||actor.verifiedAt>Date.now()+1000||Date.now()-actor.verifiedAt>30_000)
  throw new ValoProblem(403,"A recently server-verified staff session with fresh MFA is required.");
}

/** A row may have expired while FOR SHARE waited behind a writer. Re-evaluate
 * only after that lock is held, using a fresh database wall-clock statement. */
export async function assertStaffAssignmentCurrent(tx:Parameters<Parameters<typeof db.transaction>[0]>[0],id:string){
 const[current]=await tx.select({id:valoStaffAssignments.id}).from(valoStaffAssignments).where(and(eq(valoStaffAssignments.id,id),activeStaffAssignment()));
 if(!current)throw new ValoProblem(403,"Staff permission has expired or was revoked. Obtain a new authorised assignment.");
}
