import {useState} from "react";
import {useReverification} from "@clerk/react";
import {isReverificationCancelledError} from "@clerk/react/errors";
import {customFetch,ApiError} from "@workspace/api-client-react";
import {Link} from "wouter";

export function MfaVerification({onVerified}:{onVerified?:()=>void}={}){
  const[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const verify=useReverification(async()=>{
    try{return await customFetch<{verified:true;checkedAt:string}>("/api/session/mfa",{cache:"no-store"});}
    catch(error){
      if(error instanceof ApiError&&error.status===403&&
        (error.data as {code?:string})?.code==="MFA_REVERIFICATION_REQUIRED")return error.data as {clerk_error:unknown};
      throw error;
    }
  });
  async function check(){
    if(busy)return;setBusy(true);setNotice("");
    try{
      const result=await verify();
      if(!result||!("verified" in result)||result.verified!==true)throw Error("MFA verification did not complete.");
      setNotice("Both sign-in factors were verified recently. Staff permissions are checked separately.");onVerified?.();
    }catch(error){setNotice(isReverificationCancelledError(error)?"Verification cancelled. No permissions changed.":
      error instanceof ApiError?String((error.data as {error?:string})?.error??"Verification could not be completed. Try again."):"Verification could not be completed. Try again.");}
    finally{setBusy(false);}
  }
  return <div className="my-4 space-y-3">
    <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void check()}>{busy?"Verifying…":"Verify MFA"}</button>
    <p className="text-sm">Use your authenticator or another enrolled second factor. <Link href="/workspace/account" className="underline">Manage sign-in security</Link>.</p>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
  </div>;
}
