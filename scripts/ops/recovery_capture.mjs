// Explicit development capture only. All source transactions are read-only.
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,createHmac} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod,stat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {signJournal,privacyTable} from './recovery_contract.mjs';
import {captureExportRetention} from './export_retention_contract.mjs';
const exec=promisify(execFile),root=resolve(process.env.VALO_RECOVERY_SOURCE_ROOT||'.');
const require=createRequire(join(root,'artifacts/api-server/package.json')),{Client}=require('pg');
const hash=x=>createHash('sha256').update(Buffer.isBuffer(x)||typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const ident=x=>'"'+x.replaceAll('"','""')+'"';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|LANG|LC_ALL|TMP|TEMP|LD_LIBRARY_PATH)$/.test(k)));
async function command(file,args,env=safeEnv){
 try{return await exec(file,args,{cwd:root,env,timeout:180000,maxBuffer:8_000_000});}
 catch{throw Error('CAPTURE_SUBPROCESS_FAILED');}
}
function backupEnvironment(){
 const u=new URL(process.env.DATABASE_URL);assert.ok(['postgres:','postgresql:'].includes(u.protocol));
 return{...safeEnv,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),
  PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGSSLMODE:u.searchParams.get('sslmode')||'prefer',PGOPTIONS:'-c default_transaction_read_only=on'};
}
async function snapshot(c,ownerNames){
  const sql={
    columns:`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,is_generated FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints:`SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
    indexes:`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    triggers:`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions:`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,arguments`,
    grants:`SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY grantee,table_name,privilege_type`,
    columnGrants:`SELECT grantee,table_name,column_name,privilege_type FROM information_schema.role_column_grants WHERE table_schema='public' ORDER BY grantee,table_name,column_name,privilege_type`,
    roles:`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname LIKE 'valo_content_%' ORDER BY rolname`,
    relations:`SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`,
  };
  const result={};for(const [key,q]of Object.entries(sql))result[key]=(await c.query(q)).rows;
  for(const key of ['grants','columnGrants'])result[key]=result[key].map(r=>({...r,grantee:ownerNames.includes(r.grantee)?'$OWNER':r.grantee})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}
async function rows(c,tables){
  const result={};for(const {schema,name}of tables){
    result[schema+'.'+name]=(await c.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${ident(schema)}.${ident(name)} t`)).rows[0];
  }return result;
}
async function capturePrivateObjects(c,boundary,bundle){
  const {Client:Storage}=require('@replit/object-storage');
  const parts=String(process.env.PRIVATE_OBJECT_DIR||'').replace(/^\/+|\/+$/g,'').split('/'),bucket=parts.shift();
  assert.ok(bucket&&/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)&&parts.length&&parts.every(p=>/^[a-zA-Z0-9._-]+$/.test(p)&&p!=='.'&&p!=='..'));
  const prefix=parts.join('/'),storage=new Storage({bucketId:bucket}),inventory=new Map();
  const objectPattern=/^valo\/development\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(docx|pdf|json)$/;
  function add(key,table,metadata,required,checksum,size){
    const item=inventory.get(key)||{key,required:false,sources:[]};item.required ||= required;item.sources.push({table,metadata});
    assert.match(key,objectPattern,'Invalid private object key prevents archive');
    if(checksum){assert.match(checksum,/^[a-f0-9]{64}$/);if(item.checksum)assert.equal(item.checksum,checksum);item.checksum=checksum;}
    if(size!==null&&size!==undefined){const n=Number(size);assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=50*1024*1024);if(item.size!==undefined)assert.equal(item.size,n);item.size=n;}
    inventory.set(key,item);
  }
  for(const row of(await c.query('SELECT id,workspace_id,job_id,object_key,checksum,size,retention_at FROM valo_file_assets ORDER BY object_key')).rows)
    add(row.object_key,'valo_file_assets',row,true,row.checksum,row.size);
  for(const row of(await c.query('SELECT * FROM valo_export_objects ORDER BY object_key')).rows)
    add(row.object_key,'valo_export_objects',row,row.state==='retained');
  for(const row of(await c.query(`SELECT a.*,j.status AS job_status,j.checksum,j.size,j.current_attempt_id=a.id AS current
    FROM valo_workspace_export_attempts a JOIN valo_workspace_exports j ON j.id=a.job_id AND j.workspace_id=a.workspace_id ORDER BY a.object_key`)).rows)
    add(row.object_key,'valo_workspace_export_attempts',row,row.status==='ready'&&!(row.job_status==='expired'&&!row.current&&row.cleanup_checked_at!==null),row.current?row.checksum:undefined,row.current?row.size:undefined);
  assert.ok(inventory.size<=1000,'Bounded development capture required');
  await mkdir(bundle,{mode:0o700});await mkdir(join(bundle,'objects'),{mode:0o700});
  const payloads=new Map();let totalBytes=0,absent=0;
  for(const item of inventory.values()){
    const name=prefix+'/'+item.key,exists=await storage.exists(name);assert.ok(exists.ok,'Object existence check failed');
    if(!exists.value){assert.ok(!item.required,'Required completed object is absent');item.physicalState='absent_nonreadable_reservation';absent++;continue;}
    const read=await storage.downloadAsBytes(name);assert.ok(read.ok,'Private object read failed');const bytes=read.value[0],digest=hash(bytes);
    assert.ok(bytes.length<=50*1024*1024);if(item.checksum)assert.equal(digest,item.checksum);if(item.size!==undefined)assert.equal(bytes.length,item.size);
    // Unknown cleanup/incomplete bytes receive a second read, never a success state.
    if(!item.checksum){const second=await storage.downloadAsBytes(name);assert.ok(second.ok&&hash(second.value[0])===digest,'Unstable nonready object');}
    totalBytes+=bytes.length;assert.ok(totalBytes<=100*1024*1024,'Free-tier rehearsal size limit');
    const relative='objects/'+digest+'.bin';
    if(!payloads.has(relative)){await writeFile(join(bundle,relative),bytes,{mode:0o600,flag:'wx'});payloads.set(relative,{path:relative,sha256:digest,bytes:bytes.length});}
    item.physicalState='captured';item.payload=relative;item.capturedSha256=digest;item.capturedBytes=bytes.length;
  }
  const index={version:1,scope:'development',snapshotCutoff:boundary.cutoff,storageScopeFingerprint:hash(['development',bucket,prefix]),
    consistency:'Completed immutable bytes verified against snapshot checksums; nonready reservations remain nonreadable and require recovery reconciliation',objects:[...inventory.values()]};
  const encoded=JSON.stringify(index)+'\n';await writeFile(join(bundle,'object-index.json'),encoded,{mode:0o600});
  const files=[...payloads.values(),{path:'object-index.json',sha256:hash(encoded),bytes:Buffer.byteLength(encoded)}];
  return{files,logicalKeys:inventory.size,physicalFiles:inventory.size-absent,absentNonreadableReservations:absent,physicalBytes:totalBytes};
}

let client;
try{
 process.umask(0o077);
 const[mode,destination,expectedIdentity,releaseSha]=process.argv.slice(2),out=resolve(destination||'');
 assert.ok(['snapshot','journal'].includes(mode)&&process.argv.length===6,'CAPTURE_ARGUMENTS_INVALID');
 assert.ok(process.env.NODE_ENV==='development'&&!Object.keys(process.env).some(k=>k.startsWith('REPLIT_DEPLOYMENT')&&process.env[k]),'DEVELOPMENT_CAPTURE_ONLY');
 assert.match(expectedIdentity,/^[a-f0-9]{64}$/);assert.match(releaseSha,/^[a-f0-9]{40}$/);
 assert.equal((await command('git',['rev-parse','HEAD'])).stdout.trim(),releaseSha,'PINNED_RELEASE_REQUIRED');
 assert.equal(await realpath(root),root);assert.equal(await realpath(resolve(out,'..')),resolve(out,'..'));
 assert.ok(!(await stat(out).catch(()=>null)),'NEW_CAPTURE_DIRECTORY_REQUIRED');
 await mkdir(out,{mode:0o700});
 client=new Client({connectionString:process.env.DATABASE_URL,application_name:'valo-read-only-recovery-capture',connectionTimeoutMillis:10000});
 client.on('error',()=>{});await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='60s'");await client.query("SET LOCAL lock_timeout='3s'");
 await client.query("SET LOCAL TIME ZONE 'UTC'");
 const identity=(await client.query("SELECT current_database() AS database,current_user AS actor,inet_server_addr()::text AS address,current_setting('server_version_num') AS version,current_setting('transaction_read_only') AS read_only")).rows[0];
 assert.equal(identity.read_only,'on');assert.equal(hash([identity.database,identity.actor,identity.address,identity.version]),expectedIdentity,'SOURCE_IDENTITY_MISMATCH');
 const boundary=(await client.query('SELECT pg_export_snapshot() AS id,clock_timestamp() AS cutoff,pg_current_wal_lsn() AS lsn')).rows[0];
 const tables=(await client.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','valo_jobs','drizzle') AND c.relkind IN('r','p') ORDER BY n.nspname,c.relname")).rows;
 const controlTables=tables.filter(t=>t.schema==='public'&&privacyTable(t.name)),controls={};
 for(const t of controlTables){const result=await client.query(`SELECT to_jsonb(t) AS row FROM ${ident(t.name)} t ORDER BY to_jsonb(t)::text LIMIT 250001`);
  assert.ok(result.rowCount<=250000,'BOUNDED_JOURNAL_REQUIRED');controls[t.name]=result.rows.map(r=>r.row);}
 const key=process.env.SESSION_SECRET;assert.ok(key&&Buffer.byteLength(key)>=32,'INDEPENDENT_SIGNING_KEY_REQUIRED');
 const keys=process.env.VALO_PRIVACY_KEYRING?JSON.parse(process.env.VALO_PRIVACY_KEYRING).keys:{['session-'+hash(key).slice(0,20)]:key,'session-derived-v1':key};
 const regs=(await client.query('SELECT id,fingerprint FROM valo_privacy_key_versions')).rows;
 assert.ok(regs.every(r=>keys[r.id]&&hash(keys[r.id])===r.fingerprint),'PRIVACY_KEY_COVERAGE_REQUIRED');
 if(mode==='journal'){
  const rawFingerprints=await rows(client,controlTables),fingerprints=Object.fromEntries(Object.entries(rawFingerprints).map(([k,v])=>[k.slice(7),v]));
  const exportRetention=await captureExportRetention(client);
  const journal=signJournal({version:1,kind:'current-development-privacy-journal',sourceIdentitySha256:expectedIdentity,releaseSha,cutoff:boundary.cutoff,walCutoff:boundary.lsn,controls,fingerprints,exportRetention},key);
  const encoded=JSON.stringify(journal)+'\n';assert.ok(Buffer.byteLength(encoded)<=20_000_000,'BOUNDED_JOURNAL_REQUIRED');
  await writeFile(join(out,'privacy-journal.json'),encoded,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({version:1,kind:'privacy-journal',sourceIdentitySha256:expectedIdentity,cutoff:boundary.cutoff,sha256:hash(encoded),controlTables:controlTables.length,retentionEntries:exportRetention.entries.length,sourceWrites:0}));
 }else{
  const bundle=join(out,'bundle'),sourceSchema=await snapshot(client,[identity.actor]),sourceRows=await rows(client,tables);
  const sourceRoles=(await client.query("SELECT rolname,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname")).rows;
  const captured=await capturePrivateObjects(client,boundary,bundle),dump=join(bundle,'database.dump');
  await command('pg_dump',['-Fc','--snapshot',boundary.id,'--no-publications','--no-subscriptions','-f',dump],backupEnvironment());await chmod(dump,0o600);
  const dumpBytes=await readFile(dump);assert.ok(dumpBytes.length<=100*1024*1024,'BOUNDED_DUMP_REQUIRED');
  const payload={version:1,kind:'native-development-snapshot-controls',releaseSha,sourceIdentitySha256:expectedIdentity,cutoff:boundary.cutoff,walCutoff:boundary.lsn,
   databaseSha256:hash(dumpBytes),objectIndexSha256:hash(await readFile(join(bundle,'object-index.json'))),privacyControls:controls,sourceSchema,sourceRows,sourceRoles};
  const controlBytes=JSON.stringify({payload,authentication:{algorithm:'HMAC-SHA256',keyId:'session-'+hash(key).slice(0,20),mac:createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex')},latestIndependentJournal:false,independentSigningKeyCustody:false})+'\n';
  await writeFile(join(bundle,'recovery-controls.json'),controlBytes,{mode:0o600,flag:'wx'});
  const manifest={version:1,scope:'development',releaseSha,files:[...captured.files,{path:'database.dump',sha256:hash(dumpBytes),bytes:dumpBytes.length},{path:'recovery-controls.json',sha256:hash(controlBytes),bytes:Buffer.byteLength(controlBytes)}]};
  await writeFile(join(bundle,'manifest.json'),JSON.stringify(manifest)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({version:1,kind:'snapshot',sourceIdentitySha256:expectedIdentity,cutoff:boundary.cutoff,releaseSha,databaseSha256:hash(dumpBytes),tables:tables.length,physicalFiles:captured.physicalFiles,physicalBytes:captured.physicalBytes,sourceWrites:0}));
 }
}catch{console.error('RECOVERY_CAPTURE_FAILED');process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}}
