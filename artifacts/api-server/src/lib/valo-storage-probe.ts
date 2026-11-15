import {createHash} from "node:crypto";
import {storageProbeName,type StorageScope} from "./valo-storage-scope";
type Result<T>={ok:true;value:T}|{ok:false};
export type ProbeClient={exists(name:string):Promise<Result<boolean>>;
  uploadFromBytes(name:string,bytes:Buffer,options:{compress:false}):Promise<{ok:boolean}>;
  downloadAsBytes(name:string):Promise<Result<[Buffer]>>;
  delete(name:string,options:{ignoreNotFound:true}):Promise<{ok:boolean}>};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
class ProbeFailure extends Error{}
function fail(code:string):never{throw new ProbeFailure(code);}
const privateFailure=(e:unknown)=>e instanceof ProbeFailure?e.message:"PROBE_PROVIDER_UNAVAILABLE";
async function clean(client:ProbeClient,name:string){
  if(!(await client.delete(name,{ignoreNotFound:true})).ok)fail("PROBE_DELETE_FAILED");
  const after=await client.exists(name);if(!after.ok)fail("PROBE_ABSENCE_UNVERIFIED");
  if(after.value)fail("PROBE_DELETE_INCOMPLETE");
}
export async function runStorageProbe(scope:StorageScope,runId:string,mode:"start"|"cleanup",client:ProbeClient,
  anonymous:(bucket:string,name:string)=>Promise<number>){
  const name=storageProbeName(scope,runId);
  const report={version:1,scope:"production-storage-canary",runId,storageFingerprint:scope.fingerprint,mode,
    checkedAt:new Date().toISOString(),roundTrip:false,anonymousDenied:false,cleanupConfirmed:false,passed:false,
    launchReady:false,errorCode:null as string|null};
  let mayHaveWritten=false;
  try{
    if(mode==="cleanup"){await clean(client,name);report.cleanupConfirmed=true;report.passed=true;return report;}
    const initial=await client.exists(name);if(!initial.ok)fail("PROBE_EXISTENCE_UNVERIFIED");
    if(initial.value)fail("PROBE_KEY_ALREADY_EXISTS");
    const bytes=Buffer.from(`Valo synthetic storage readiness canary ${runId}. No customer data.`);
    mayHaveWritten=true;
    if(!(await client.uploadFromBytes(name,bytes,{compress:false})).ok)fail("PROBE_WRITE_FAILED");
    const read=await client.downloadAsBytes(name);if(!read.ok||sha(read.value[0])!==sha(bytes))fail("PROBE_CHECKSUM_MISMATCH");
    report.roundTrip=true;
    const status=await anonymous(scope.bucket,name);
    if(![401,403,404].includes(status))fail("PROBE_ANONYMOUS_READ_NOT_DENIED");
    report.anonymousDenied=true;
  }catch(e){report.errorCode=privateFailure(e);}
  finally{
    if(mayHaveWritten)try{await clean(client,name);report.cleanupConfirmed=true;}catch(e){report.errorCode=privateFailure(e);}
  }
  report.passed=report.roundTrip&&report.anonymousDenied&&report.cleanupConfirmed&&report.errorCode===null;
  return report;
}
