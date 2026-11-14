import {createHash,createHmac,timingSafeEqual,randomUUID} from "node:crypto";
export type ErasureSigner={version:string;key:string};
function privacyMac(value:unknown,key:string){
  if(key.length<32)throw Error("PRIVACY_KEY_REQUIRED");
  return createHmac("sha256",key).update("valo/privacy/erasure/v2\0"+JSON.stringify(value)).digest("hex");
}
function equalPrivacyMac(a:string,b:string){return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&
  timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));}
export type ErasureSeal={version:2;caseId:string;workspaceId:string;identityHash:string;identityKeyVersion:string;
  scope:"development-application-content-erasure-v2";synthetic:true;inventoryHash:string|null;inventoryCount:number;
  completedEventHash:string|null;keyVersion:string;mac:string};
export type ReplayState={version:1;cycleId:string;mode:"objects"|"application";phase:"objects"|"done"|number;
  cursor:string;sealHash:string;keyVersion:string;mac:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
function sealPayload(s:ErasureSeal){return[s.version,s.caseId,s.workspaceId,s.identityHash,s.identityKeyVersion,s.scope,s.synthetic,
  s.inventoryHash,s.inventoryCount,s.completedEventHash,s.keyVersion];}
function replayPayload(s:ReplayState){return[s.version,s.cycleId,s.mode,s.phase,s.cursor,s.sealHash,s.keyVersion];}
export function assertErasureObjectScope(workspaceId:string,key:string){
  if(!uuid.test(workspaceId)||!key.startsWith(`valo/development/${workspaceId}/`)||
    !/^valo\/development\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(docx|pdf)$/.test(key))throw Error("ERASURE_OBJECT_SCOPE_INVALID");
}
export function inventoryHasher(workspaceId:string){
  const h=createHash("sha256").update("valo/privacy/inventory/v2\0"+workspaceId+"\0");let last="",count=0;
  return{add(key:string){assertErasureObjectScope(workspaceId,key);if(key<=last)throw Error("ERASURE_INVENTORY_ORDER_INVALID");
    h.update(JSON.stringify(key)+"\n");last=key;count++;},finish(){return{hash:h.digest("hex"),count};}};
}
export function signErasureSeal(input:Omit<ErasureSeal,"keyVersion"|"mac">,signer:ErasureSigner):ErasureSeal{
  const s={...input,keyVersion:signer.version,mac:""};s.mac=privacyMac(sealPayload(s),signer.key);return s;
}
export function verifyErasureSeal(raw:unknown,binding:{caseId:string;workspaceId:string;identityHash:string;identityKeyVersion:string},key:string):ErasureSeal{
  const s=raw as ErasureSeal;
  if(!s||s.version!==2||!uuid.test(s.caseId)||!uuid.test(s.workspaceId)||!digest.test(s.identityHash)||
    s.caseId!==binding.caseId||s.workspaceId!==binding.workspaceId||s.identityHash!==binding.identityHash||
    s.identityKeyVersion!==binding.identityKeyVersion||s.scope!=="development-application-content-erasure-v2"||s.synthetic!==true||
    !Number.isSafeInteger(s.inventoryCount)||s.inventoryCount<0||s.inventoryHash!==null&&!digest.test(s.inventoryHash)||
    s.inventoryHash===null&&(s.inventoryCount!==0||s.completedEventHash!==null)||
    s.completedEventHash!==null&&!digest.test(s.completedEventHash)||typeof s.keyVersion!=="string"||typeof s.mac!=="string"||
    !equalPrivacyMac(s.mac,privacyMac(sealPayload(s),key)))throw Error("ERASURE_SEAL_INVALID");
  return s;
}
export const erasureSealHash=(s:ErasureSeal)=>createHash("sha256").update(JSON.stringify([...sealPayload(s),s.mac])).digest("hex");
export function assertSealedInventory(seal:ErasureSeal,actual:{hash:string;count:number}){
  if(!seal.inventoryHash||seal.inventoryHash!==actual.hash||seal.inventoryCount!==actual.count)
    throw Error("ERASURE_INVENTORY_CHANGED");
}
export function signReplayState(input:Omit<ReplayState,"keyVersion"|"mac">,signer:ErasureSigner):ReplayState{
  const s={...input,keyVersion:signer.version,mac:""};s.mac=privacyMac(replayPayload(s),signer.key);return s;
}
export function startReplay(seal:ErasureSeal,mode:ReplayState["mode"],signer:ErasureSigner):ReplayState{
  return signReplayState({version:1,cycleId:randomUUID(),mode,phase:"objects",cursor:"",sealHash:erasureSealHash(seal)},signer);
}
export function verifyReplayState(raw:unknown,seal:ErasureSeal,phaseCount:number,key:string):ReplayState{
  const s=raw as ReplayState;
  if(!s||s.version!==1||!uuid.test(s.cycleId)||!["objects","application"].includes(s.mode)||
    !(s.phase==="objects"||s.phase==="done"||Number.isSafeInteger(s.phase)&&Number(s.phase)>=0&&Number(s.phase)<phaseCount)||
    s.mode==="objects"&&typeof s.phase==="number"||
    typeof s.cursor!=="string"||s.sealHash!==erasureSealHash(seal)||typeof s.keyVersion!=="string"||typeof s.mac!=="string"||
    !equalPrivacyMac(s.mac,privacyMac(replayPayload(s),key)))throw Error("ERASURE_REPLAY_STATE_INVALID");
  if(s.cursor)assertErasureObjectScope(seal.workspaceId,s.cursor);
  return s;
}
