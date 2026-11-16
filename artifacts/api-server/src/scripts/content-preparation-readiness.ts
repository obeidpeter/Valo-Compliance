import {mkdir,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {contentPreparationReadiness} from "../editorial/content-intake-preparation";
import {publicationWorkspaceRoot} from "../editorial/operational-policy";

const report=await contentPreparationReadiness();
const path=resolve(publicationWorkspaceRoot(),"generated-artifacts/valo-completion/content-preparation-readiness.json");
await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({packageId:report.packageId,totals:report.totals,providerCalls:0,publicationActions:0,
  path:"generated-artifacts/valo-completion/content-preparation-readiness.json"}));
if(report.totals.intakeFailures)process.exitCode=1;
