import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=async(path:string)=>readFile(join(root,path),"utf8");
const digest=(body:string|Buffer)=>createHash("sha256").update(body).digest("hex");
const raw=await read("generated-artifacts/valo-customer-ux/browser-support-details.json");
const browser=JSON.parse(raw);
assert.equal(browser.selection,"managed-identity-support-details-and-privacy-scope");
assert.equal(browser.actualManagedIdentityUsed,true);
assert.equal(browser.cleanupErrors,0);
assert.equal(browser.realEmailDeliveryClaimed,false);
assert.equal(browser.actualNewPublications,0);
assert.equal(browser.checks.length,3);
assert(browser.checks.every((c:{status:string})=>c.status==="pass"));
assert(browser.fixtureDisclosure.includes("ONLY the staff display payload was intercepted"));
const typecheckRaw=await read("generated-artifacts/valo-completion/support-scope-typecheck.json");
const typecheck=JSON.parse(typecheckRaw);
assert.equal(typecheck.exitCode,0);
assert.equal(typecheck.command,"pnpm run typecheck");
const typecheckLog=await read("generated-artifacts/valo-completion/support-scope-typecheck.txt");
assert(typecheckLog.includes("artifacts/api-server typecheck: Done"));
assert(typecheckLog.includes("artifacts/valo typecheck: Done"));
assert(!typecheckLog.includes("error TS"));
const prior=JSON.parse(await read("generated-artifacts/valo-completion/support-details-browser-harness-failure.json"));
assert(prior.checks.some((c:{status:string})=>c.status==="fail"));
const codeHashes:Record<string,string>={};
for(const path of[
  "artifacts/valo/src/components/support-records.tsx",
  "artifacts/valo/src/screens/staff.tsx",
  "artifacts/valo/src/screens/account.tsx",
  "artifacts/api-server/src/lib/valo-customer-access.ts",
  "artifacts/api-server/src/scripts/customer-experience-journey.ts",
])codeHashes[path]=digest(await read(path));
const domain=process.env.REPLIT_DEV_DOMAIN;
assert(domain,"Development proxy domain is required");
async function publicJson(path:string){
  const response=await fetch(`https://${domain}${path}`);
  assert(response.ok,`Public observation failed: ${response.status}`);
  return response.json();
}
const [coverage,catalogue]=await Promise.all([publicJson("/api/public/coverage"),publicJson("/api/public/catalogue?page=1")]);
assert(catalogue&&typeof catalogue==="object"&&"total" in catalogue&&typeof catalogue.total==="number",
  "Public catalogue did not return an actual numeric total");
const result={
  preparedAt:new Date().toISOString(),developmentOnly:true,
  codeHashes,
  browserEvidence:{sha256:digest(raw),...browser},
  typecheck:{...typecheck,metadataSha256:digest(typecheckRaw),outputSha256:digest(typecheckLog),output:typecheckLog},
  retainedIntermediateHarnessFailure:{
    disposition:"Superseded by the final passing run. A locator observation used an arrow-function string instead of an invoked browser callback; this is not evidence of a product focus failure.",
    report:prior,
  },
  publicObservation:{observedAt:new Date().toISOString(),catalogue,coverage},
  scope:{
    realCustomerVerificationAndPrivateJsonDownload:true,
    realStaffApiDeniedCustomer:true,
    supportDisplayUsesControlledPayload:true,
    actualAuthorisedStaffMfaSession:false,
    privacyVerificationAssignmentOrFulfilmentCompleted:false,
    externalProviderExportCompleted:false,
    erasureOrTombstoneWorkflowCompleted:false,
    modelPaymentOrEmailCalls:0,
  },
  r1Accepted:false,r2Accepted:false,publicLaunchEnabled:false,livePaymentsEnabled:false,
};
const path="docs/valo/evidence/support-privacy-scope.json";
const body=JSON.stringify(result,null,2)+"\n";
await writeFile(join(root,path),body);
console.log(JSON.stringify({path,sha256:digest(body),browserGroups:browser.checks.length,
  cleanupErrors:browser.cleanupErrors,typecheckExitCode:typecheck.exitCode,
  catalogueTotal:catalogue.total,r1Accepted:false,r2Accepted:false},null,2));
