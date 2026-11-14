/** Controlled integration harness only. The parent simulates the accepted
 * storage request completing after SIGKILL; no native object write is made. */
import {executeExport} from "../lib/valo-exports";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
assertDevelopmentRuntime();
if(process.env.VALO_RUN_DB_TESTS!=="synthetic-development-only"||
  process.env.VALO_ERASURE_CRASH_CHILD!=="controlled-synthetic-only"||!process.send)
  throw Error("CONTROLLED_ERASURE_CHILD_ONLY");
const[id,workspaceId,queueId]=process.argv.slice(2);
if(!id||!workspaceId||!queueId)throw Error("CONTROLLED_EXPORT_IDS_REQUIRED");
await executeExport(id,workspaceId,queueId,undefined,{
  write:async(key,bytes,onUploading)=>{
    await onUploading?.();process.send!({stage:"upload_accepted",key,bytes:bytes.toString("base64")});
    await new Promise<never>(()=>{});throw Error("CONTROLLED_CHILD_MUST_BE_KILLED");
  },
  remove:async()=>{throw Error("KILLED_CHILD_CANNOT_CLEAN_UP");},
});
