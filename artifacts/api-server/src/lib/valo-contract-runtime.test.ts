import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
test("raw Paystack contract checks run with no database or provider credentials",()=>{
  const result=spawnSync(process.execPath,["--import","tsx","--test",
    fileURLToPath(new URL("./valo-paystack-contract.test.ts",import.meta.url))],{
    env:{PATH:process.env.PATH??"",NODE_ENV:"test"},encoding:"utf8",timeout:15000,
  });
  assert.equal(result.status,0,result.stderr+"\n"+result.stdout);
  assert.match(result.stdout,/(?:#|ℹ) pass 2\b/);
  assert.doesNotMatch(result.stdout,/DATABASE_URL must be set|# fail [1-9]/);
});
