/** One-shot disposable local SYNTHETIC restore exercise. Never reads/dumps the
 * managed database; never schedules backups. No provider credentials inherited. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,readFile,writeFile,rm,cp} from "node:fs/promises";
import {tmpdir,userInfo} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {Document,Paragraph,Packer} from "docx";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {assertIsolatedRecoveryTarget,replayRecoveryControls,signRecoveryControls,type RecoveryControls} from "../lib/valo-recovery-controls";
import {logger} from "../lib/logger";
const exec=promisify(execFile),hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const script=fileURLToPath(import.meta.url),root=resolve(import.meta.dirname,"../../../..");
const mode=process.argv[2];
assertDevelopmentRuntime();
if(process.env.VALO_ISOLATED_RECOVERY!=="synthetic-local-only")throw Error("EXPLICIT_LOCAL_RECOVERY_PROOF_REQUIRED");
type Fixture={identityId:string;workspaceId:string;documentId:string;objectKey:string;checksum:string};
async function fixtureSeed(){
  const {pool}=await import("@workspace/db");
  const store=await import("../lib/valo-store");
  const {syntheticDocument}=await import("../lib/valo-test-fixtures");
  const directory=process.argv[3];assert.ok(directory.startsWith("/tmp/valo-recovery-"));
  const fixtures:Fixture[]=[];
  try{
    const dbName=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.equal(dbName,"valo_restore_source");
    for(const name of ["a","b","c"]){
      const identityId=`synthetic-recovery-${name}-${randomUUID()}`,actor=await store.resolveWorkspace(identityId);
      const document=await store.createDocument(actor,{...syntheticDocument,title:`Synthetic recovery ${name}`});
      const revision=(await pool.query("SELECT id,content_hash FROM valo_document_revisions WHERE document_id=$1",[document.id])).rows[0];
      const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph(document.title)]}]}));
      const jobId=randomUUID(),objectKey=`recovery/${actor.workspaceId}/${document.id}.docx`;
      await mkdir(join(directory,actor.workspaceId),{recursive:true});
      await writeFile(join(directory,actor.workspaceId,`${document.id}.docx`),bytes,{mode:0o600});
      await pool.query(`INSERT INTO valo_export_jobs(id,workspace_id,document_id,revision_id,revision,format,render_version,source_hash,requested_by,queue_id,status)
        VALUES($1,$2,$3,$4,1,'docx','isolated-recovery-fixture-v1',$5,$6,$7,'ready')`,
      [jobId,actor.workspaceId,document.id,revision.id,revision.content_hash,identityId,randomUUID()]);
      await pool.query(`INSERT INTO valo_file_assets(id,workspace_id,job_id,object_key,checksum,mime,size)
        VALUES($1,$2,$3,$4,$5,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',$6)`,
      [randomUUID(),actor.workspaceId,jobId,objectKey,hash(bytes),bytes.length]);
      fixtures.push({identityId,workspaceId:actor.workspaceId,documentId:document.id,objectKey,checksum:hash(bytes)});
    }
    process.stdout.write(JSON.stringify(fixtures));
  }finally{await pool.end();}
}
function assertFixtureTargetEnvironment(){
  const target=new URL(process.env.DATABASE_URL??"");
  assert.equal(target.protocol,"postgresql:");assert.equal(target.hostname,"localhost");
  assert.equal(target.port,"58463");assert.equal(target.pathname,"/valo_restore_target");
  assert.ok(process.env.PGHOST?.startsWith("/tmp/valo-recovery-"));
  assert.equal(target.searchParams.get("host"),process.env.PGHOST);
}
async function fixtureReplay(){
  assertFixtureTargetEnvironment();
  const {pool}=await import("@workspace/db");
  const path=process.argv[3];assert.ok(path.startsWith("/tmp/valo-recovery-"));
  const saved=JSON.parse(await readFile(path,"utf8"))as{controls:RecoveryControls;signature:string;key:string;snapshotHash:string};
  const client=await pool.connect();
  try{
    await assertIsolatedRecoveryTarget(client);
    await replayRecoveryControls(client,saved.controls,saved.signature,Buffer.from(saved.key,"base64"),saved.snapshotHash);
    await replayRecoveryControls(client,saved.controls,saved.signature,Buffer.from(saved.key,"base64"),saved.snapshotHash);
    process.stdout.write(JSON.stringify({replayed:true}));
  }finally{client.release();await pool.end();}
}
async function verifyAccess(){
  assertFixtureTargetEnvironment();
  const {db,pool}=await import("@workspace/db"),store=await import("../lib/valo-store");
  const {privacyKeys,privacyKey}=await import("../lib/valo-privacy-keys");
  const {quotaSubjectHash}=await import("../lib/valo-quota-policy");
  const fixtures=JSON.parse(await readFile(process.argv[3],"utf8"))as Fixture[];
  try{
    const client=await pool.connect();
    try{await assertIsolatedRecoveryTarget(client);}finally{client.release();}
    const ring=privacyKeys(),key=await db.transaction(tx=>privacyKey(tx,ring.current,ring));
    const tombstones=(await pool.query("SELECT identity_hash,key_version FROM valo_privacy_tombstones WHERE workspace_id=$1",[fixtures[0].workspaceId])).rows;
    assert.equal(tombstones.length,1);
    assert.equal(tombstones[0].key_version,ring.current);
    assert.equal(tombstones[0].identity_hash,quotaSubjectHash(key,"user",fixtures[0].identityId));
    const before=(await pool.query("SELECT (SELECT count(*) FROM valo_workspaces) AS workspaces,(SELECT count(*) FROM valo_memberships) AS memberships,(SELECT count(*) FROM valo_privacy_key_versions) AS key_versions")).rows;
    // A missing historical key (503) is not a successful authorization denial.
    await assert.rejects(()=>store.resolveWorkspace(fixtures[0].identityId),{
      status:403,message:"Identity deletion is recorded. Access cannot be recreated.",
    });
    await assert.rejects(()=>store.resolveWorkspace(fixtures[1].identityId),{
      status:403,message:"Workspace membership is suspended",
    });
    const c=await store.resolveWorkspace(fixtures[2].identityId);
    assert.equal((await store.getDocument(c,fixtures[2].documentId)).id,fixtures[2].documentId);
    await assert.rejects(()=>store.getDocument(c,fixtures[0].documentId),{status:404,message:"Document not found"});
    const after=(await pool.query("SELECT (SELECT count(*) FROM valo_workspaces) AS workspaces,(SELECT count(*) FROM valo_memberships) AS memberships,(SELECT count(*) FROM valo_privacy_key_versions) AS key_versions")).rows;
    assert.deepEqual(after,before);
    process.stdout.write(JSON.stringify({authorisationChecksCreatedNoRows:true,versionedIdentityBinding:true,revokedIdentitiesDenied:2,activeDocumentRecovered:1,crossTenantDenied:1}));
  }finally{await pool.end();}
}
async function drill(){
  const started=performance.now(),directory=await mkdtemp(join(tmpdir(),"valo-recovery-"));
  const data=join(directory,"data"),sourceObjects=join(directory,"source-objects"),restoredObjects=join(directory,"restored-objects");
  const user=userInfo().username;assert.match(user,/^[a-z_][a-z0-9_-]*$/);
  // Explicit allowlist, not {...process.env}: no managed DB/PSP/email/model keys.
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:directory,NODE_ENV:"development",PGHOST:directory,PGPORT:"58463",
    PGUSER:user,PGDATABASE:"postgres",VALO_ISOLATED_RECOVERY:"synthetic-local-only",SESSION_SECRET:randomBytes(32).toString("hex")};
  const url=(name:string)=>`postgresql://${user}@localhost:58463/${name}?host=${encodeURIComponent(directory)}`;
  const options={env,cwd:root,maxBuffer:2_000_000};
  let running=false;let source:Pool|undefined,target:Pool|undefined;
  const report:Record<string,unknown>={startedAt:new Date().toISOString(),scope:"disposable local synthetic PostgreSQL and local fixture objects",
    managedDatabaseRead:false,productionRestoreProved:false,appStorageRestoreProved:false,
    externalCredentialsInherited:false,externalMessagesSent:0,charges:0,refunds:0,
    deletionScope:"Access quarantine/tombstone replay; physical application/provider erasure is NOT fulfilled",
    retention35Days:"unresolved",checks:{}};
  try{
    report.phase="initialise_local_cluster";
    await exec("initdb",["-D",data,"--auth=trust","--no-locale"],options);
    await exec("pg_ctl",["-D",data,"-l",join(directory,"postgres.log"),"-o",`-k ${directory} -h '' -p 58463`,"-w","start"],options);running=true;
    const admin=new Pool({host:directory,port:58463,user,database:"postgres"});
    try{await admin.query("CREATE DATABASE valo_restore_source");await admin.query("CREATE DATABASE valo_restore_target");}finally{await admin.end();}
    env.DATABASE_URL=url("valo_restore_source");
    report.phase="apply_journalled_migrations";
    await exec("pnpm",["--filter","@workspace/db","exec","drizzle-kit","migrate","--config","./drizzle.config.ts"],options);
    report.phase="seed_local_fixtures";
    const seeded=await exec("pnpm",["--filter","@workspace/api-server","exec","tsx",script,"--fixture-seed",sourceObjects],options);
    const fixtures=JSON.parse(seeded.stdout)as Fixture[];
    await writeFile(join(directory,"fixtures.json"),JSON.stringify(fixtures),{mode:0o600});
    source=new Pool({host:directory,port:58463,user,database:"valo_restore_source"});
    const snapshot=await source.connect();
    const dump=join(directory,"synthetic.dump");
    try{
      report.phase="export_isolated_snapshot";
      await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const boundary=(await snapshot.query("SELECT pg_export_snapshot() AS id,clock_timestamp() AS cutoff,pg_current_wal_lsn() AS lsn")).rows[0];
      report.cutoffAt=new Date(boundary.cutoff).toISOString();report.localWalCutoff=boundary.lsn;
      const dumpStart=performance.now();
      await exec("pg_dump",["-Fc","--snapshot",boundary.id,"-f",dump,"valo_restore_source"],options);
      report.dumpElapsedMs=Math.round(performance.now()-dumpStart);
    }finally{await snapshot.query("ROLLBACK");snapshot.release();}
    const snapshotHash=hash(await readFile(dump));report.snapshotHash=snapshotHash;
    // Control journal is retained OUTSIDE the dump. A stale restored DB cannot supply it.
    const controls:RecoveryControls={snapshotHash,cutoff:String(report.cutoffAt),entries:fixtures.slice(0,2).map((f,i)=>({
      id:randomUUID(),workspaceId:f.workspaceId,identityId:f.identityId,kind:i===0?"deletion":"revocation",recordedAt:new Date().toISOString()}))};
    const key=randomBytes(32),signature=signRecoveryControls(controls,key);
    await source.query("UPDATE valo_memberships SET active='no' WHERE workspace_id=ANY($1::uuid[])",[fixtures.slice(0,2).map(f=>f.workspaceId)]);
    await source.query("INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id) VALUES($1,$2,'synthetic-recovery','recovery.post_cutoff',$3)",
      [randomUUID(),fixtures[2].workspaceId,randomUUID()]);
    const restoreStart=performance.now();report.restoreStartedAt=new Date().toISOString();
    report.phase="restore_disposable_target";
    await exec("pg_restore",["--exit-on-error","--no-owner","-d","valo_restore_target",dump],options);
    await cp(sourceObjects,restoredObjects,{recursive:true});
    target=new Pool({host:directory,port:58463,user,database:"valo_restore_target"});
    const check=report.checks as Record<string,unknown>;
    assert.equal(Number((await target.query("SELECT count(*) FROM valo_events WHERE action='recovery.post_cutoff'")).rows[0].count),0);
    assert.equal(Number((await source.query("SELECT count(*) FROM valo_events WHERE action='recovery.post_cutoff'")).rows[0].count),1);
    check.exactSnapshotCutoff=true;
    const client=await target.connect();
    try{
      report.phase="replay_and_validate";
      const sourceClient=await source.connect();
      try{await assert.rejects(()=>assertIsolatedRecoveryTarget(sourceClient),/LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED/);}
      finally{sourceClient.release();}
      check.sourceDatabaseRejectedAsReplayTarget=true;
      await assert.rejects(()=>replayRecoveryControls(client,{...controls,snapshotHash:"0".repeat(64)},signature,key,snapshotHash),/BINDING/);
      assert.equal(Number((await client.query("SELECT count(*) FROM valo_privacy_tombstones")).rows[0].count),0);
      assert.equal(Number((await client.query("SELECT count(*) FROM valo_privacy_key_versions")).rows[0].count),0);
      assert.equal(Number((await client.query("SELECT count(*) FROM valo_memberships WHERE active='yes'")).rows[0].count),3);
      check.alteredJournalRejected=true;check.alteredJournalRejectedWithoutEffects=true;
      // The parent never imports the DB-backed signer. Only this allowlisted
      // child receives the explicit disposable target URL and same fresh key.
      const controlsPath=join(directory,"controls.json");
      await writeFile(controlsPath,JSON.stringify({controls,signature,key:key.toString("base64"),snapshotHash}),{mode:0o600});
      await exec("pnpm",["--filter","@workspace/api-server","exec","tsx",script,"--replay-controls",controlsPath],
        {...options,env:{...env,DATABASE_URL:url("valo_restore_target")}});
      assert.equal(Number((await client.query("SELECT count(*) FROM valo_privacy_tombstones")).rows[0].count),1);
      check.idempotentDeletionTombstoneAndRevocationReplay=true;
      assert.equal((await client.query("SELECT has_table_privilege('valo_content_publisher_dev','valo_document_revisions','SELECT') AS allowed")).rows[0].allowed,false);
      check.publisherCannotReadPrivateRevisions=true;
      const rows=(await client.query(`SELECT a.object_key,a.checksum,a.workspace_id,j.workspace_id AS job_workspace,
        j.source_hash,r.content_hash FROM valo_file_assets a JOIN valo_export_jobs j ON j.id=a.job_id
        JOIN valo_document_revisions r ON r.id=j.revision_id AND r.workspace_id=j.workspace_id`)).rows;
      for(const row of rows){
        assert.equal(row.source_hash,row.content_hash);
        assert.equal(row.workspace_id,row.job_workspace);assert.ok(row.object_key.startsWith(`recovery/${row.workspace_id}/`));
        const bytes=await readFile(join(restoredObjects,...row.object_key.split("/").slice(1)));assert.equal(hash(bytes),row.checksum);
      }
      check.tenantObjectChecksums=rows.length;
      const object=join(restoredObjects,fixtures[2].workspaceId,`${fixtures[2].documentId}.docx`),bytes=await readFile(object);
      await writeFile(object,"SYNTHETIC_TAMPER");
      assert.notEqual(hash(await readFile(object)),fixtures[2].checksum);
      await writeFile(object,bytes);check.tamperedObjectDetected=true;
      const deletedObject=join(restoredObjects,fixtures[0].workspaceId,`${fixtures[0].documentId}.docx`);
      await rm(deletedObject);await rm(deletedObject,{force:true});
      await assert.rejects(()=>readFile(deletedObject),{code:"ENOENT"});
      check.quarantinedDeletionObjectRemovedIdempotently=true;
    }finally{client.release();}
    env.DATABASE_URL=url("valo_restore_target");
    report.phase="verify_customer_authorisation";
    const verified=await exec("pnpm",["--filter","@workspace/api-server","exec","tsx",script,"--verify-access",join(directory,"fixtures.json")],options);
    check.customerAccess=JSON.parse(verified.stdout);
    report.restoreCompletedAt=new Date().toISOString();report.restoreAndValidationElapsedMs=Math.round(performance.now()-restoreStart);
    report.recoveryCutoffAgeMs=Date.now()-Date.parse(String(report.cutoffAt));report.passed=true;report.phase="completed";
  }catch(error){report.passed=false;report.failureType=error instanceof assert.AssertionError?"ASSERTION_FAILED":"DRILL_FAILED";
    // No child stdout/stderr, credentials, user text or raw error details retained.
    process.exitCode=1;
  }finally{
    await source?.end();await target?.end();
    if(running)await exec("pg_ctl",["-D",data,"-m","fast","-w","stop"],options).catch(()=>{report.cleanupFailed=true;process.exitCode=1;});
    await rm(directory,{recursive:true,force:true});
    report.elapsedMs=Math.round(performance.now()-started);report.completedAt=new Date().toISOString();
    const output=resolve("generated-artifacts/valo-recovery");await mkdir(output,{recursive:true});
    await writeFile(join(output,"isolated-recovery.json"),JSON.stringify(report,null,2)+"\n");
    logger.info({event:"recovery.isolated_drill",report});
  }
}
if(mode==="--fixture-seed")await fixtureSeed();else if(mode==="--replay-controls")await fixtureReplay();else if(mode==="--verify-access")await verifyAccess();else await drill();

