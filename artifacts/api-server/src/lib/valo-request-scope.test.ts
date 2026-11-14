import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
type RequestScope={signal:AbortSignal;isCurrent:()=>boolean;onUnauthorized?:()=>void};
function scope(){const controller=new AbortController();let active=true;
  return{scope:{signal:controller.signal,isCurrent:()=>active}as RequestScope,
    end(){active=false;controller.abort();}};}
test("account transport boundaries",async t=>{
  const original=globalThis.fetch;
  // Compile the real browser transport in isolation; don't add browser source
  // files/DOM globals to the API server's TypeScript project.
  const dir=await mkdtemp(join(tmpdir(),"valo-account-transport-"));
  const source=resolve("../../lib/api-client-react/src"),entry=join(dir,"transport.mjs");
  const bundle=await build({stdin:{contents:`export{customFetch}from${JSON.stringify(join(source,"custom-fetch.ts"))};
    export{installRequestScopeProvider}from${JSON.stringify(join(source,"request-scope.ts"))};`,resolveDir:source},
    bundle:true,write:false,format:"esm",platform:"node"});
  await writeFile(entry,bundle.outputFiles![0]!.contents);
  const {customFetch,installRequestScopeProvider}=await import(pathToFileURL(entry).href) as {
    customFetch:(input:string,options?:RequestInit)=>Promise<unknown>;
    installRequestScopeProvider:(provider:()=>RequestScope)=>()=>void;
  };
  try{
    await t.test("expired scope cannot dispatch a mutation",async()=>{
      const a=scope();a.end();const uninstall=installRequestScopeProvider(()=>a.scope);let sends=0;
      globalThis.fetch=async()=>{sends++;return Response.json({});};
      try{await assert.rejects(customFetch("https://example.invalid/profile",{method:"PATCH",body:'{"name":"PRIVATE_A"}'}),{name:"AbortError"});assert.equal(sends,0);}
      finally{uninstall();}
    });
    await t.test("late A response after B installation is discarded even when transport ignores abort",async()=>{
      const a=scope(),b=scope();const unA=installRequestScopeProvider(()=>a.scope);
      let resolve!:(r:Response)=>void;let sentSignal:AbortSignal|null|undefined;
      globalThis.fetch=async(_input,options)=>{sentSignal=options?.signal;return new Promise(r=>{resolve=r;});};
      const result=customFetch("https://example.invalid/profile",{method:"PATCH",body:'{"name":"PRIVATE_A"}'});
      a.end();const unB=installRequestScopeProvider(()=>b.scope);unA();
      assert.equal(sentSignal?.aborted,true);resolve(Response.json({name:"PRIVATE_A"}));
      await assert.rejects(result,{name:"AbortError"});
      globalThis.fetch=async()=>Response.json({name:"PRIVATE_B"});
      assert.deepEqual(await customFetch("https://example.invalid/profile"),{name:"PRIVATE_B"});
      unB();
    });
    await t.test("late body parsing cannot return previous-account data",async()=>{
      const a=scope();const uninstall=installRequestScopeProvider(()=>a.scope);
      let release!:()=>void;const ready=new Promise<void>(r=>{release=r;});
      globalThis.fetch=async()=>new Response(new ReadableStream({async start(c){
        await ready;c.enqueue(new TextEncoder().encode('{"name":"PRIVATE_A"}'));c.close();
      }}),{headers:{"content-type":"application/json"}});
      const result=customFetch("https://example.invalid/profile");await new Promise(r=>setImmediate(r));
      a.end();release();await assert.rejects(result,{name:"AbortError"});uninstall();
    });
    await t.test("current 401 invalidates current UI scope once",async()=>{
      const a=scope();let invalidations=0;a.scope.onUnauthorized=()=>{invalidations++;a.end();};
      const uninstall=installRequestScopeProvider(()=>a.scope);globalThis.fetch=async()=>Response.json({}, {status:401});
      await assert.rejects(customFetch("https://example.invalid/profile"),{name:"AbortError"});
      assert.equal(invalidations,1);uninstall();
    });
    await t.test("late A 401 cannot invalidate B",async()=>{
      const a=scope(),b=scope();let invalidations=0;let release!:(v:Response)=>void;
      a.scope.onUnauthorized=b.scope.onUnauthorized=()=>invalidations++;
      const unA=installRequestScopeProvider(()=>a.scope);
      globalThis.fetch=async()=>new Promise(r=>{release=r;});
      const result=customFetch("https://example.invalid/profile");a.end();
      const unB=installRequestScopeProvider(()=>b.scope);release(Response.json({}, {status:401}));
      await assert.rejects(result,{name:"AbortError"});assert.equal(invalidations,0);assert.equal(b.scope.isCurrent(),true);
      unA();unB();
    });
    await t.test("caller cancellation composes with account cancellation without adding browser bearer credentials",async()=>{
      const a=scope(),caller=new AbortController();const uninstall=installRequestScopeProvider(()=>a.scope);
      let sent:AbortSignal|null|undefined;globalThis.fetch=async(_input,options)=>{
        sent=options?.signal;assert.equal(new Headers(options?.headers).has("authorization"),false);
        return Response.json({ok:true});
      };
      await customFetch("https://example.invalid/profile",{signal:caller.signal});
      assert.equal(sent?.aborted,false);caller.abort();
      // Disposed listeners must not keep completed requests subscribed.
      assert.equal(sent?.aborted,false);uninstall();
    });
  }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
