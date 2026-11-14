import {eq} from "drizzle-orm";
import {db,pool,valoExportJobs} from "@workspace/db";
import {executeExport,type ExportStage} from "../lib/valo-exports";
if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||
  process.env.VALO_RUN_EXPORT_CRASH_TESTS!=="synthetic-development-only"||!process.send)
  throw Error("SYNTHETIC_IPC_CHILD_REQUIRED");
const[id,workspaceId,queueId,target]=process.argv.slice(2);
const [job]=await db.select().from(valoExportJobs).where(eq(valoExportJobs.id,id!));
if(!job||job.workspaceId!==workspaceId||!job.requestedBy.startsWith("synthetic-export-crash-"))
  throw Error("OWNED_SYNTHETIC_JOB_REQUIRED");
try{
  await executeExport(id!,workspaceId!,queueId!,async(stage:ExportStage)=>{
    if(stage===target){process.send!({stage});await new Promise<void>(resolve=>process.once("message",()=>resolve()));}
  });
}finally{await pool.end();}
