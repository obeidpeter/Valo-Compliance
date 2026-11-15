/** Credential-free merge checks. No raw scanner output or matches are printed. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,readFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {randomBytes} from "node:crypto";
import assert from "node:assert/strict";
import {withoutVerifiedSourceHashFindings} from "./security-evidence-exceptions";
import {dependencySummary,secretSummary} from "./security-reports";
const exec=promisify(execFile),root=resolve(import.meta.dirname,"../../../");
const dir=await mkdtemp(join(tmpdir(),"valo-scan-"));
const run=async(command:string,args:string[],cwd=root)=>{
  try{const r=await exec(command,args,{cwd,maxBuffer:16_000_000});return{code:0,stdout:r.stdout};}
  catch(e){const r=e as {code?:number;stdout?:string};return{code:r.code??2,stdout:r.stdout??""};}
};
const report:Record<string,unknown>={recordedAt:new Date().toISOString(),scope:"tracked full Git history and frozen-lock dependency audit",
  rawSecretsRetained:false,detectorCanaries:false};
try{
  // Generated locally, never a valid issued credential, never committed/printed.
  const canary="sk_"+"live_"+randomBytes(24).toString("hex");
  await writeFile(join(dir,"canary.txt"),`payment_key = "${canary}"\n`,{mode:0o600});
  const canaryReport=join(dir,"canary.json");
  const c=await run("gitleaks",["dir",dir,"--no-banner","--redact=100","--report-format=json","--report-path",canaryReport]);
  assert.equal(c.code,1,"SECRET_DETECTOR_CANARY_MUST_FAIL");
  const canaryResult=secretSummary(withoutVerifiedSourceHashFindings(JSON.parse(await readFile(canaryReport,"utf8"))));
  assert.ok(canaryResult.count>0);assert.ok(!JSON.stringify(canaryResult).includes(canary));
  const dependencyCanary=dependencySummary({metadata:{vulnerabilities:{high:1}},advisories:{fixture:{id:0,
    module_name:"synthetic-detector-canary",severity:"high",title:canary}}});
  assert.equal(dependencyCanary.status,"blocked");assert.ok(!JSON.stringify(dependencyCanary).includes(canary));
  // Audit-only lock fixture: never install, import or execute this old package.
  // Exercise pnpm/the registry itself, not just our result formatter.
  const dependencyDir=join(dir,"dependency-canary");await mkdir(dependencyDir);
  await writeFile(join(dependencyDir,"package.json"),JSON.stringify({name:"valo-audit-only-canary",private:true,dependencies:{lodash:"4.17.20"}}));
  await writeFile(join(dependencyDir,"pnpm-lock.yaml"),"lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      lodash:\n        specifier: 4.17.20\n        version: 4.17.20\npackages:\n  lodash@4.17.20:\n    resolution: {}\nsnapshots:\n  lodash@4.17.20: {}\n");
  const engineCanary=await run("pnpm",["audit","--json"],dependencyDir);
  const engineResult=dependencySummary(JSON.parse(engineCanary.stdout));
  assert.notEqual(engineCanary.code,0,"DEPENDENCY_ENGINE_CANARY_MUST_FAIL");
  assert.equal(engineResult.status,"blocked","REGISTRY_MUST_DETECT_KNOWN_VULNERABLE_LOCK_FIXTURE");
  report.dependencyEngineCanary={detected:true,scope:"audit-only generated lock; no package installed",counts:engineResult.counts};
  report.detectorCanaries=true;
  const audit=await run("pnpm",["audit","--json"]);
  report.dependencies=dependencySummary(JSON.parse(audit.stdout));
  const secretPath=join(dir,"git.json");
  const secrets=await run("gitleaks",["git",root,"--log-opts=--all","--ignore-gitleaks-allow",
    "--no-banner","--redact=100","--report-format=json","--report-path",secretPath]);
  if(![0,1].includes(secrets.code))throw Error("SECRET_SCANNER_EXECUTION_FAILED");
  const findings=JSON.parse(await readFile(secretPath,"utf8")),remaining=withoutVerifiedSourceHashFindings(findings);
  report.reviewedSourceHashExceptions={count:findings.length-remaining.length,scope:"Two exact immutable source-binding findings independently verified; no general hash/path exclusion"};
  report.secrets=secretSummary(remaining);
  report.passed=(report.dependencies as {status:string}).status==="pass"&&(report.secrets as {status:string}).status==="pass";
}catch{
  report.passed=false;report.error="SCAN_OR_CANARY_FAILED_NO_RAW_OUTPUT_RETAINED";
}finally{
  const out=join(root,"generated-artifacts/valo-security");await mkdir(out,{recursive:true});
  await writeFile(join(out,"merge-security.json"),JSON.stringify(report,null,2)+"\n");
  await rm(dir,{recursive:true,force:true});console.log(JSON.stringify(report));
  if(!report.passed)process.exitCode=1;
}

