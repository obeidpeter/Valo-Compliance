import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("actual budget/customer unit files run without a database or native storage", () => {
  const env = { ...process.env, NODE_ENV: "development" };
  for (const key of [
    "DATABASE_URL",
    "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
    "PRIVATE_OBJECT_DIR",
    "PUBLIC_OBJECT_SEARCH_PATHS",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
    "NODE_TEST_CONTEXT",
  ])
    delete (env as Record<string, string | undefined>)[key];
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--test",
      "--test-concurrency=1",
      "src/lib/inference-budget.test.ts",
      "src/lib/valo-customer-ai.test.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
  assert.match(result.stdout, /tests [1-9]\d*/);
  assert.match(result.stdout, /(?:fail 0|"fail":0)/);
  assert.doesNotMatch(result.stdout, /DATABASE_URL must be set|PRIVATE_STORAGE_UNCONFIGURED/);
});

test("disabled managed inference imports no runtime composition and dispatches nothing", () => {
  const env = { ...process.env, NODE_ENV: "development" };
  delete (env as Record<string, string | undefined>).DATABASE_URL;
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  const code = `
    import assert from 'node:assert/strict';
    import {registerHooks} from 'node:module';
    let forbidden=0,network=0;
    registerHooks({resolve(specifier,context,next){
      if(specifier==='@workspace/db'||specifier.startsWith('@workspace/db/')||
        specifier==='openai'||specifier==='./managed-sdk-transport'||
        specifier==='@workspace/integrations-openai-ai-server'){
        forbidden++;throw Error('FORBIDDEN_EAGER_RUNTIME_IMPORT');
      }
      return next(specifier,context);
    }});
    globalThis.fetch=async()=>{network++;throw Error('NETWORK_FORBIDDEN');};
    const {managedCompletion,InferenceHeld}=await import('./src/lib/managed-inference.ts');
    const {customerCompletionRequest}=await import('./src/lib/valo-customer-ai-model.ts');
    assert.equal(typeof customerCompletionRequest,'function');
    assert.equal(Object.hasOwn(process.env,'DATABASE_URL'),false);
    await assert.rejects(()=>managedCompletion('customer',{
      model:'gpt-5.4-mini',max_completion_tokens:8192,messages:[]},
      {timeout:1,maxRetries:0,onOutbound(){network++;}}),InferenceHeld);
    assert.equal(forbidden,0);assert.equal(network,0);
    console.log('NO_DATABASE_NO_RUNTIME_ZERO_DISPATCH');
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 128 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NO_DATABASE_NO_RUNTIME_ZERO_DISPATCH/);
});

test("portable storage detector fails even if an accidental native call is caught", () => {
  const env = { ...process.env, NODE_ENV: "development", VALO_ERASURE_STORAGE_PROOF: "portable" };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  const code = `const {writePrivateFile}=await import('./src/lib/valo-private-storage.ts');
    try{await writePrivateFile('never-sent',Buffer.from('controlled detector'));}catch(error){
      if(error.message!=='NATIVE_STORAGE_FORBIDDEN_IN_PORTABLE_PROOF')throw error;
      console.log('PORTABLE_NATIVE_DETECTOR_REACHED');
    }`;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      import.meta.resolve("tsx"),
      "--import",
      "./src/test-support/portable-storage-guard.ts",
      "--input-type=module",
      "-e",
      code,
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 128 * 1024,
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /PORTABLE_NATIVE_DETECTOR_REACHED/);
});
