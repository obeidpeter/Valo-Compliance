import test from "node:test";
import assert from "node:assert/strict";
import { build, type Plugin, type BuildOptions } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDevelopmentRuntime, deployedEnvironmentMarkers } from "./valo-development-runtime";
const testedMarkers = [...deployedEnvironmentMarkers, "REPLIT_DEPLOYMENT_FUTURE_MARKER"];

test("explicit development only; empty markers are absent, every nonempty marker rejects", () => {
  assert.doesNotThrow(() => assertDevelopmentRuntime({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertDevelopmentRuntime({ NODE_ENV: "development", REPLIT_DEPLOYMENT: "" }));
  assert.doesNotThrow(() =>
    assertDevelopmentRuntime({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "synthetic.replit.dev" }),
  );
  for (const NODE_ENV of [undefined, "", "production", "test", "staging", "Development", "preview"])
    assert.throws(() => assertDevelopmentRuntime({ NODE_ENV }), { code: "DEVELOPMENT_RUNTIME_REQUIRED" });
  for (const key of testedMarkers)
    for (const value of ["1", "true", "arbitrary-deployment", "0", "false", " "])
      assert.throws(() => assertDevelopmentRuntime({ NODE_ENV: "development", [key]: value }), {
        code: "DEVELOPMENT_RUNTIME_REQUIRED",
      });
});

test("actual export entries and worker startup reject before database, queue or storage effects", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "valo-export-guard-"));
  const zero = { database: 0, authorization: 0, queue: 0, storage: 0, render: 0, services: 0 };
  const files = new Map<string, string>([
    [
      "@workspace/db",
      `const hit=()=>{globalThis.guardEffects.database++;throw Error("DATABASE_EFFECT")};
      export const db=new Proxy({},{get:()=>hit});export const pool={end:hit};export const runInWorkspaceScope=hit;
      export const valoMemberships={},valoDocuments={},valoDocumentRevisions={},valoExportJobs={},
      valoExportRequests={},valoFileAssets={},valoExportObjects={},valoEvents={},valoPrivacyTombstones={},
      valoWorkspaceExports={},valoWorkspaceExportAttempts={},valoWorkspaces={},valoPrivacyCases={},valoPrivacyEvents={};`,
    ],
    [
      "drizzle-orm",
      "export const and=()=>{},or=()=>{},eq=()=>{},ne=()=>{},desc=()=>{},inArray=()=>{},lte=()=>{},lt=()=>{},asc=()=>{},sql=()=>{};",
    ],
    [
      "pg-boss",
      `export class PgBoss{constructor(){globalThis.guardEffects.queue++;}
      on(){} async start(){globalThis.guardEffects.queue++;}async work(){globalThis.guardEffects.queue++;}}`,
    ],
    [
      "@workspace/api-zod",
      "export const CreateDocumentExportBody={strict(){return this},parse(x){return x}},CreateDocumentExportResponse={parse:x=>x},RequestWorkspaceDataExportBody=CreateDocumentExportBody,CancelWorkspaceDataExportBody=CreateDocumentExportBody;",
    ],
    ["@workspace/valo-core", "export const sha256=x=>x;"],
    [
      "valo-store",
      `export class ValoProblem extends Error{constructor(status,message){super(message);this.status=status;}}
      export const authorizeWorkspaceWrite=()=>{globalThis.guardEffects.authorization++;throw Error("AUTHORIZATION_EFFECT")};export const authorizeWorkspaceRead=authorizeWorkspaceWrite;`,
    ],
    [
      "valo-private-storage",
      `const hit=()=>{globalThis.guardEffects.storage++;throw Error("STORAGE_EFFECT")};
      export const readPrivateFile=hit,writePrivateFile=hit,deletePrivateFile=hit,privateWorkspaceObject=hit;`,
    ],
    [
      "valo-operations",
      "export const recordWorkerHeartbeat=async()=>{globalThis.guardEffects.services++},collectOperationalSample=recordWorkerHeartbeat,recordOperationalAlerts=recordWorkerHeartbeat;",
    ],
    [
      "valo-customer-access",
      "export const workspaceDataExport=async()=>{globalThis.guardEffects.services++;throw Error('COLLECTION_EFFECT')};",
    ],
    [
      "valo-privacy",
      "export const readPrivacyCase=async()=>{globalThis.guardEffects.services++;throw Error('PRIVACY_EFFECT')};",
    ],
    [
      "valo-render",
      "export const RENDER_VERSION='controlled';export const exportMime=()=>'';export const renderDocument=()=>{globalThis.guardEffects.render++};export const closeRenderer=async()=>{};",
    ],
    ["valo-validation", "export const documentInput={parse:x=>x};"],
    ["valo-revision-codec", "export const serializeRevision=x=>x;"],
    ["logger", "export const logger={info(){},warn(){},error(){}};"],
    [
      "valo-reminder-worker",
      "export const reconcileDueReminders=async()=>{globalThis.guardEffects.services++};",
    ],
    // The worker reaches every payment, refund and dispute service through the commerce module's index.
    [
      "commerce",
      `const hit=async()=>{globalThis.guardEffects.services++;};
      export const processPaymentEvents=hit,reconcilePayments=hit,processRefundQueue=hit,
      reconcileKnownDisputes=hit,reconcileDisputeActions=hit;`,
    ],
    [
      "valo-operational-dispatch",
      "export const dispatchOperationalJobs=async()=>{globalThis.guardEffects.services++};",
    ],
    [
      "valo-source-monitor",
      "export const reconcileSourceMonitoring=async()=>{globalThis.guardEffects.services++};",
    ],
    [
      "valo-operations",
      `const hit=async()=>{globalThis.guardEffects.services++;};
      export const recordWorkerHeartbeat=hit,collectOperationalSample=hit,recordOperationalAlerts=hit;`,
    ],
    [
      "valo-privacy-erasure",
      `const hit=async()=>{globalThis.guardEffects.services++;throw Error("PRIVACY_SERVICE_EFFECT")};
      export const reconcileErasedObjects=hit,closePrivacyErasureLocks=hit;`,
    ],
  ]);
  const plugin: Plugin = {
    name: "count-effects-only-in-isolated-proof",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const name = files.has(args.path)
          ? args.path
          : args.path
              .replaceAll("\\", "/")
              .split("/")
              .at(-1)!
              .replace(/\.[mc]?[jt]sx?$/, "");
        return files.has(name) ? { path: name, namespace: "controlled-effects" } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "controlled-effects" }, (args) => ({
        contents: files.get(args.path)!,
        loader: "js",
      }));
    },
  };
  const entry = resolve("src/workers/export-worker.ts");
  const source = `import{requestExport,getExport,listExports,retryExport,downloadExport,executeExport}from${JSON.stringify(resolve("src/lib/valo-exports.ts"))};
    import{recoverAbandonedExports,reconcileExportOrphans}from${JSON.stringify(resolve("src/lib/valo-export-recovery.ts"))};
    import{createWorkspaceExport,listWorkspaceExports,getWorkspaceExport,cancelWorkspaceExport,retryWorkspaceExport,executeWorkspaceExport,recoverWorkspaceExports,cleanupWorkspaceExports,pendingWorkspaceExports,withPreparedWorkspaceExport}from${JSON.stringify(resolve("src/lib/valo-workspace-export-jobs.ts"))};
    import{exportQueue}from${JSON.stringify(resolve("src/lib/valo-export-queue.ts"))};
    const actor={workspaceId:"not-accessed",identityId:"not-accessed"};
    const ops=[()=>requestExport(actor,"id","key",{}),()=>getExport(actor,"id"),()=>listExports(actor,"id"),
      ()=>retryExport(actor,"id"),()=>downloadExport(actor,"id"),()=>executeExport("id","ws","queue"),
      ()=>recoverAbandonedExports(),()=>reconcileExportOrphans(),()=>exportQueue(),
      ()=>createWorkspaceExport(actor,"key"),()=>listWorkspaceExports(actor),()=>getWorkspaceExport(actor,"id"),
      ()=>cancelWorkspaceExport(actor,"id",1),()=>retryWorkspaceExport(actor,"id",1),()=>executeWorkspaceExport("id","ws","queue"),
      ()=>recoverWorkspaceExports(),()=>cleanupWorkspaceExports(),()=>pendingWorkspaceExports(),
      ()=>withPreparedWorkspaceExport(actor,"id",new AbortController().signal,async()=>{},async()=>{})];
    let rejected=0;for(const op of ops){try{await op()}catch(e){if(e.status!==503&&e.code!=="DEVELOPMENT_RUNTIME_REQUIRED"&&e.code!=="PRODUCTION_REHEARSAL_CONFIGURATION_REQUIRED"&&e.code!=="PRODUCTION_RUNTIME_NOT_VERIFIED")throw e;rejected++;}}
    if(rejected!==ops.length)throw Error("UNGUARDED_EXPORT_ENTRY");`;
  try {
    const authorizationCanary = `import{authorizeWorkspaceWrite}from${JSON.stringify(resolve("src/lib/valo-store.ts"))};
      try{await authorizeWorkspaceWrite({},{});throw Error("HARNESS_CAPABILITY_NOT_REACHED")}
      catch(e){if(e.message!=="AUTHORIZATION_EFFECT")throw e;}`;
    const entries: [string, BuildOptions][] = [
      ["api", { stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" } }],
      [
        "authorization-canary",
        { stdin: { contents: authorizationCanary, resolveDir: process.cwd(), loader: "ts" } },
      ],
      ["worker", { entryPoints: [entry] }],
    ];
    for (const [name, options] of entries) {
      const result = await build({
        ...options,
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        plugins: [plugin],
        banner: {
          js: `globalThis.guardEffects=${JSON.stringify(zero)};process.on("exit",()=>console.log("GUARD_EFFECTS:"+JSON.stringify(globalThis.guardEffects)));`,
        },
      });
      await writeFile(join(dir, `${name}.mjs`), result.outputFiles![0]!.contents);
    }
    await t.test(
      "controlled workspace-write authorization capability is executable, not a missing-export compile refusal",
      () => {
        const child = spawnSync(process.execPath, [join(dir, "authorization-canary.mjs")], {
          env: { NODE_ENV: "development" },
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        const record = child.stdout.match(/GUARD_EFFECTS:(\{[^\n]+\})/);
        assert.ok(record);
        assert.deepEqual(JSON.parse(record[1]!), { ...zero, authorization: 1 });
      },
    );
    const modes: Record<string, string>[] = [
      {},
      ...["", "production", "test", "staging", "preview"].map((NODE_ENV) => ({ NODE_ENV })),
    ];
    for (const key of testedMarkers)
      for (const v of ["1", "true", "arbitrary-deployment", "0", "false", " "])
        modes.push({ NODE_ENV: "development", [key]: v });
    for (const env of modes)
      await t.test(JSON.stringify(env), () => {
        for (const kind of ["api", "worker"]) {
          const child = spawnSync(process.execPath, [join(dir, `${kind}.mjs`)], {
            env,
            encoding: "utf8",
            timeout: 10000,
          });
          assert.equal(child.error, undefined);
          assert.equal(child.status, kind === "api" ? 0 : 1, child.stderr.slice(0, 1000));
          const record = child.stdout.match(/GUARD_EFFECTS:(\{[^\n]+\})/);
          assert.ok(record, child.stderr);
          assert.deepEqual(JSON.parse(record[1]!), zero);
        }
      });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
