/** Retain observed results, not acceptance flags manufactured from check names. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {developmentPublicationOnly,publicationWorkspaceRoot} from "../editorial/operational-policy";
developmentPublicationOnly();
const root=publicationWorkspaceRoot(),out=resolve(root,"docs/valo/evidence");
const digest=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");
const tests=[];
for(const[file,label]of[
  ["refund-tests.txt","Refund PostgreSQL scenarios including one suite parent"],
  ["refund-commerce-regression.txt","Commerce PostgreSQL scenarios including one suite parent"],
  ["refund-provider-tests.txt","Controlled native refund transport including one suite parent"],
  ["refund-webhook-regression.txt","Signed HTTP controls including one suite parent"],
  ["refund-api-tests.txt","API regression; one expressly skipped case"],
]){
  const bytes=await readFile(resolve(root,"generated-artifacts/valo-completion",file)),text=bytes.toString();
  const number=(field:string)=>Number(text.match(new RegExp(`ℹ ${field} (\\d+)`))?.[1]??NaN);
  if(!Number.isInteger(number("tests"))||number("fail")!==0)throw Error(`UNSUCCESSFUL_RESULT_${file}`);
  tests.push({label,tests:number("tests"),passed:number("pass"),failed:number("fail"),skipped:number("skipped"),
    rawResult:`docs/valo/evidence/${file}`,sha256:digest(bytes)});
  await mkdir(out,{recursive:true});await writeFile(resolve(out,file),bytes);
}
const typecheck=await readFile(resolve(root,"generated-artifacts/valo-completion/refund-typecheck.txt"));
if(!typecheck.toString().includes("artifacts/api-server typecheck: Done")||
  !typecheck.toString().includes("artifacts/valo typecheck: Done")||typecheck.toString().includes("error TS"))throw Error("TYPECHECK_NOT_PASSED");
const migration=JSON.parse(await readFile(resolve(root,"generated-artifacts/valo-commerce/clean-migrations.json"),"utf8"));
if(!migration.migrationsPassed||migration.failed||migration.invariants.journalledMigrations!==17)throw Error("MIGRATION_PROOF_NOT_PASSED");
const codePaths=["src/lib/valo-refunds.ts","src/lib/valo-refund-provider.ts","src/lib/valo-payment-disputes.ts",
  "src/lib/valo-commerce.ts","src/lib/valo-refunds.integration.test.ts","src/lib/valo-refund-provider.test.ts",
  "src/routes/valo-customer-access.ts","src/workers/export-worker.ts"];
const sourceHashes=[];
for(const path of codePaths)sourceHashes.push({path:`artifacts/api-server/${path}`,sha256:digest(await readFile(resolve(root,"artifacts/api-server",path)))});
const observation=async(path:string)=>{
  const response=await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}${path}`,{redirect:"error"});
  return{httpStatus:response.status,data:await response.json()};
};
const report={
  observedAt:new Date().toISOString(),codeRevision:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
  status:"partial_development_evidence_not_full_acceptance",scope:"Synthetic development data, real PostgreSQL and real SIGKILL; controlled payment responses",
  tests,typecheck:{passed:true,sha256:digest(typecheck)},sourceHashes,migration,
  unauthenticatedFinance:await observation("/api/admin/refunds"),
  catalogue:await observation("/api/public/catalogue"),coverage:await observation("/api/public/coverage"),
  realPaystackTransactions:0,realRefunds:0,realEmailMessagesSent:0,newAiProviderCalls:0,
  sourceRule80AcceptancePassed:false,customerAi60AcceptancePassed:false,editorial60AcceptancePassed:false,
  r1Accepted:false,r2Accepted:false,productionLaunchEnabled:false,livePaymentsEnabled:false,
  browserVerification:{publicMobileScreenshot:true,authenticatedFinanceUiVerified:false,reason:"No real fresh-MFA finance journey executed."},
  initialFailures:[
    {cause:"Dispute scenario reused a tenant which had already reached its ten-per-minute refund limit.",resolution:"Used a distinct fixture tenant and added an explicit durable quota rejection test; cap unchanged."},
    {cause:"Quota snapshot did not list new refund-specific ceilings.",resolution:"Added explicit 10/minute and 50/day assertions; existing ceilings unchanged."},
    {cause:"Append-only financial history prevented destructive test teardown; subsequent retained fixture IDs collided.",resolution:"Retained synthetic FK parents and audit evidence, revoked fixture roles and randomized numeric provider IDs; no trigger disabled."},
  ],
  remaining:["Actual sandbox merchant execution, dispute reconciliation and refund/bank outcome proof",
    "Real fresh-MFA finance browser journey and manual accessibility",
    "Commercial price/refund/licence acceptance separate from explicit development test policy",
    "Provider dispute evidence submission/accept-decline workflow is not implemented",
    "All remaining R1 customer/editor/email/privacy/content/evaluation/operational requirements; gated R2 remains incomplete"],
};
await mkdir(out,{recursive:true});
await writeFile(resolve(out,"refund-lifecycle-checkpoint.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({path:"docs/valo/evidence/refund-lifecycle-checkpoint.json",sha256:digest(JSON.stringify(report,null,2)+"\n"),
  sourceRevision:report.codeRevision,tests:tests.map(({label,tests,passed,failed,skipped})=>({label,tests,passed,failed,skipped}))},null,2));
