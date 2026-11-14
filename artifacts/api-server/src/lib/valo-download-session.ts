import {ValoProblem} from "./valo-problem";

type DownloadIdentity={identityId:string;workspaceId:string};
type DownloadClaims={userId:string|null;sessionId:string|null};
type SessionReader={
  session:(id:string)=>Promise<{status:string;userId:string}>;
  user:(id:string)=>Promise<{id:string;banned:boolean;locked:boolean;primaryEmailAddressId:string|null;
    emailAddresses:readonly {id:string;verification:{status:string}|null}[]}>;
};

/** Re-read the original request's session immediately before file release.
 * Never resolve/create a workspace or accept a replacement identity here. */
export async function assertWorkspaceDownloadSession(actor:DownloadIdentity,auth:DownloadClaims,read:SessionReader){
  if(!auth.userId||!auth.sessionId||auth.userId!==actor.identityId)
    throw new ValoProblem(401,"Sign in again before downloading workspace data.");
  const[session,user]=await Promise.all([read.session(auth.sessionId),read.user(auth.userId)]);
  if(session.status!=="active"||session.userId!==actor.identityId||user.id!==actor.identityId)
    throw new ValoProblem(401,"The session changed or ended while the file was prepared. Sign in and request a new download.");
  if(user.banned||user.locked)throw new ValoProblem(403,"The account is suspended or locked. No export was released.");
  const primary=user.emailAddresses.find(email=>email.id===user.primaryEmailAddressId);
  if(primary?.verification?.status!=="verified")
    throw new ValoProblem(403,"Verify your primary email before downloading workspace data.");
}
