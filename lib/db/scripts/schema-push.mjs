import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Command output may contain connection details. Return codes/categories only. */
export function assessCommand(result) {
  const output=`${result.stdout??""}\n${result.stderr??""}`.replace(/\u001b\[[0-9;]*[A-Za-z]/g,"");
  const categories=[];
  if(result.error||result.signal||result.status!==0)categories.push("PROCESS_FAILED");
  if(/(?:^|\n)\s*(?:error|fatal|panic|DrizzleQueryError|PostgresError|QueryFailedError)(?:\s|:|\[)/im.test(output)||
    /(?:^|\n)\s*(?:code|sqlstate)\s*:\s*['"]?(?!00)[0-9A-Z]{5}\b/im.test(output)||
    /\b(?:permission denied|violates foreign key constraint|current transaction is aborted|relation ["'][^\r\n]+already exists)\b/i.test(output))
    categories.push("SQL_ERROR_REPORTED");
  const completed=/(?:Changes applied|No changes detected)/i.test(output);
  if(!completed)categories.push("COMPLETION_NOT_CONFIRMED");
  return{passed:categories.length===0,categories};
}

export function policyFailure(env,args) {
  if(args.length)return"ARGUMENTS_AND_FORCE_DISABLED";
  if(env.NODE_ENV!=="development"||env.REPLIT_DEPLOYMENT)return"DEVELOPMENT_ONLY";
  if(env.VALO_SCHEMA_PUSH_ACK!=="reviewed-development-only")return"REVIEW_ACK_REQUIRED";
  if(env.VALO_RUN_DB_TESTS!=="synthetic-development-only")return"POSTCONDITION_TEST_ACK_REQUIRED";
  return null;
}

/** A clean tool exit is necessary, not sufficient. Existing application constraints must pass. */
export function guardedPush(env,args,run) {
  const blocked=policyFailure(env,args);
  if(blocked)return{exitCode:2,status:"blocked",categories:[blocked],schemaAcceptance:false};
  let command;
  try{command=run("schema");}catch{return{exitCode:1,status:"failed",categories:["PROCESS_FAILED"],schemaAcceptance:false};}
  const assessment=assessCommand(command);
  if(!assessment.passed)return{exitCode:1,status:"failed_or_partially_applied",categories:assessment.categories,schemaAcceptance:false};
  let verification;
  try{verification=run("verify");}catch{return{exitCode:1,status:"postconditions_failed",categories:["VERIFICATION_FAILED"],schemaAcceptance:false};}
  // node:test can exit zero with every case skipped; that is not constraint proof.
  const results=`${verification.stdout??""}\n${verification.stderr??""}`;
  const passes=Number(results.match(/(?:#|ℹ)\s*pass\s+(\d+)/)?.[1]??0);
  const failures=Number(results.match(/(?:#|ℹ)\s*fail\s+(\d+)/)?.[1]??-1);
  const skips=Number(results.match(/(?:#|ℹ)\s*skipped\s+(\d+)/)?.[1]??-1);
  if(verification.error||verification.signal||verification.status!==0||passes===0||failures!==0||skips!==0)
    return{exitCode:1,status:"postconditions_failed",categories:["VERIFICATION_FAILED"],schemaAcceptance:false};
  return{exitCode:0,status:"development_checks_passed",categories:[],schemaAcceptance:false,
    productionCompatibilityAccepted:false,verifiedRunnerEntries:passes,
    note:"Development command and application postconditions only. No production migration, recovery or clean-staging acceptance."};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=guardedPush(process.env,process.argv.slice(2),stage=>{
    const args=stage==="schema"?["exec","drizzle-kit","push","--config","./drizzle.config.ts"]:
      ["--filter","@workspace/api-server","test:valo-db"];
    return spawnSync("pnpm",args,{cwd:fileURLToPath(new URL("../",import.meta.url)),
      env:{...process.env,CI:"true"},encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024,
      stdio:["ignore","pipe","pipe"]});
  });
  console.log(JSON.stringify(result));
  process.exitCode=result.exitCode;
}
