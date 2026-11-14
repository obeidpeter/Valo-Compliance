import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { prepareInventoryRelease } from "../editorial/operational-preparation";
import { withdrawOperationalVersion } from "../editorial/publication-publisher";
import { publicationWorkspaceRoot } from "../editorial/operational-policy";
async function main(){
  if(process.env.VALO_OPERATIONAL_PUBLICATION!=="synthetic-development-only")throw Error("EXPLICIT_DEVELOPMENT_PUBLICATION_FLAG_REQUIRED");
  const action=process.argv[2];
  if(action==="prepare"){
    const report=await prepareInventoryRelease(resolve(publicationWorkspaceRoot(),"generated-artifacts/valo-publication/provider-rights-snapshot.json"));
    const out=resolve(publicationWorkspaceRoot(),`docs/valo/evidence/operational-publication-v${report.version}.json`);
    await writeFile(out,JSON.stringify({executedAt:new Date().toISOString(),...report,
      scope:"Development only; no public launch, sales, R1 acceptance or professional verification"},null,2)+"\n");
    process.stdout.write(JSON.stringify({report:out,id:report.id,version:report.version,decision:report.release.decision,
      eligibility:report.eligibility,reviews:report.reviews})+"\n");
  }else if(action==="withdraw"){
    const id=process.argv[3];if(!id)throw Error("VERSION_ID_REQUIRED");
    process.stdout.write(JSON.stringify(await withdrawOperationalVersion(id,"Development withdrawal drill; preserve historical customer drafts"))+"\n");
  }else throw Error("Use prepare or withdraw VERSION_ID");
}
main().catch(e=>{
  const safe=typeof e.message==="string"&&/^[A-Z_]+(?::[a-z_:,]+)?$/.test(e.message)?e.message:"OPERATIONAL_PUBLICATION_FAILED";
  process.stderr.write(`${safe}\n`);process.exitCode=1;
}).finally(()=>pool.end());
