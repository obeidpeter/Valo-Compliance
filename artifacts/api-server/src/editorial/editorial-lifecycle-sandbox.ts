import {randomUUID} from "node:crypto";
import {Pool} from "pg";

const localHosts=new Set(["localhost","127.0.0.1","[::1]","postgres"]);
export function lifecycleSeedUrl(raw:string|undefined,currentUrl?:string){
  if(!raw)throw Error("ISOLATED_GENUINE_LIFECYCLE_BASELINE_NOT_CONFIGURED");
  let url:URL;try{url=new URL(raw);}catch{throw Error("LIFECYCLE_DATABASE_URL_INVALID");}
  if(!["postgres:","postgresql:"].includes(url.protocol)||!localHosts.has(url.hostname)||
    !/^\/valo_lifecycle_seed_[a-f0-9]{16,32}$/.test(url.pathname)||url.search)
    throw Error("LIFECYCLE_REQUIRES_LOCAL_DEDICATED_SEED_DATABASE");
  if(currentUrl){let current:URL|undefined;try{current=new URL(currentUrl);}catch{/* malformed main URL is not a seed */}
    if(current&&current.hostname===url.hostname&&current.port===url.port&&current.pathname===url.pathname)
      throw Error("LIFECYCLE_SEED_MUST_DIFFER_FROM_APPLICATION_DATABASE");}
  return url;
}

/** Every destructive lifecycle exercise gets its own local database copy.
 * The source database, native app database and retained objects are never edited.
 * Only a database this invocation successfully created may be dropped. */
export async function createLifecycleSandbox(raw:string,currentUrl?:string){
  const seed=lifecycleSeedUrl(raw,currentUrl),seedName=seed.pathname.slice(1),name=`valo_lifecycle_run_${randomUUID().replaceAll("-","")}`;
  const adminUrl=new URL(seed);adminUrl.pathname="/postgres";
  const admin=new Pool({connectionString:adminUrl.href,max:1,connectionTimeoutMillis:5000,query_timeout:15000});
  let created=false;
  try{
    const permissions=await admin.query("select datname,pg_get_userbyid(datdba)=current_user as owned from pg_database where datname=$1",[seedName]);
    if(permissions.rows[0]?.owned!==true)throw Error("LIFECYCLE_SEED_NOT_OWNED_BY_TEST_CONNECTION");
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${seedName}"`);created=true;
    const target=new URL(seed);target.pathname="/"+name;
    return{url:target.href,name,async close(){
      if(!created)return;created=false;
      try{await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);}finally{await admin.end();}
    }};
  }catch(error){await admin.end();throw error;}
}

export function assertLifecycleRunDatabase(raw:string|undefined,actualName:string){
  if(!raw)throw Error("LIFECYCLE_RUN_DATABASE_REQUIRED");
  const u=new URL(raw);
  if(!localHosts.has(u.hostname)||!/^valo_lifecycle_run_[a-f0-9]{32}$/.test(actualName)||u.pathname!=="/"+actualName)
    throw Error("LIFECYCLE_NATIVE_DATABASE_FORBIDDEN");
}
