import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
assertDevelopmentRuntime();
const mode=process.argv[2],sql=await readFile(new URL("../../../../lib/db/drizzle/0029_privacy_copy_redaction.sql",import.meta.url),"utf8");
const previous=await readFile(new URL("../../../../lib/db/drizzle/0028_workspace_export_cleanup.sql",import.meta.url),"utf8");
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const c=await pool.connect();
try{
  await c.query("BEGIN");await c.query("SET LOCAL statement_timeout='10000ms'");
  if(mode==="--verify-isolated"){
    const schema="privacy_ddl_"+randomUUID().replaceAll("-","");
    await c.query(`CREATE SCHEMA "${schema}"`);await c.query(`SET LOCAL search_path="${schema}",public`);
    await c.query(`CREATE TABLE valo_refund_transitions(id uuid,workspace_id uuid,reason text,amount integer)`);
    await c.query(`CREATE FUNCTION valo_financial_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$`);
    await c.query(`CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON valo_refund_transitions FOR EACH ROW EXECUTE FUNCTION valo_financial_history_immutable()`);
    for(const part of sql.split("--> statement-breakpoint"))if(part.trim())await c.query(part);
    const id=randomUUID(),workspaceId=randomUUID();
    await c.query("INSERT INTO valo_refund_transitions VALUES($1,$2,$3,100)",[id,workspaceId,"OWNED_SYNTHETIC_PRIVATE_REASON"]);
    await c.query("SAVEPOINT denied");
    try{await c.query("UPDATE valo_refund_transitions SET reason='wrong' WHERE id=$1",[id]);throw Error("MUTATION_WAS_NOT_DENIED");}
    catch(e){if((e as {code?:string}).code!=="P0001")throw e;await c.query("ROLLBACK TO SAVEPOINT denied");}
    const marker="[Private content removed by verified workspace erasure]";
    await c.query(`INSERT INTO valo_privacy_redactions VALUES('valo_refund_transitions',$1,$2,
      jsonb_build_object('id',$1::uuid,'workspace_id',$2::uuid,'reason',$3::text,'amount',100),'{}','controlled','controlled')`,[id,workspaceId,marker]);
    await c.query("UPDATE valo_refund_transitions SET reason=$1 WHERE id=$2",[marker,id]);
    await c.query("ROLLBACK");
    console.log(JSON.stringify({isolatedMigrationPassed:true,sourceHash:hash(sql),rolledBack:true,ownerDataChanged:false}));
  }else if(mode==="--apply-reviewed-development-untracked-baseline"){
    // The existing development database has an empty Drizzle journal despite
    // installed objects. Do NOT fabricate adoption rows or claim the old SQL ran.
    await c.query("SELECT pg_advisory_xact_lock(93540291)");
    const checked=(await c.query(`SELECT
      (SELECT count(*) FROM drizzle.__drizzle_migrations)::int AS old_journal_rows,
      to_regclass('valo_privacy_redactions')::text AS already_installed,
      to_regclass('valo_workspace_export_attempts')::text AS attempts,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='valo_workspace_export_attempts'
        AND table_schema='public' AND column_name='cleanup_checked_at') AS cleanup_column,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='valo_refund_transition_immutable'
        AND tgrelid='valo_refund_transitions'::regclass) AS audit_guard`)).rows[0];
    if(checked.old_journal_rows!==0||checked.already_installed||!checked.attempts||!checked.cleanup_column||!checked.audit_guard)
      throw Error("MEASURED_DEVELOPMENT_BASELINE_CHANGED");
    for(const part of sql.split("--> statement-breakpoint"))if(part.trim())await c.query(part);
    await c.query("COMMIT");
    const receipt={migration:"0029_privacy_copy_redaction",sourceHash:hash(sql),checked,
      developmentOnly:true,existingRowsChanged:0,legacyHistoryAdopted:false,drizzleJournalRowsWritten:0,
      limitation:"Reviewed development-only DDL operation. Full legacy schema-history adoption remains unresolved.",completedAt:new Date().toISOString()};
    const dir=new URL("../../../../generated-artifacts/valo-completion/",import.meta.url);
    await mkdir(dir,{recursive:true});await writeFile(new URL("privacy-copy-migration.json",dir),JSON.stringify(receipt,null,2)+"\n");
    console.log(JSON.stringify(receipt));
  }else if(mode==="--apply-reviewed-development"){
    await c.query("SELECT pg_advisory_xact_lock(93540291)");
    const latest=await c.query('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1');
    if(latest.rows[0]?.hash===hash(sql)){await c.query("ROLLBACK");console.log("ALREADY_APPLIED");}
    else{
      if(latest.rows[0]?.hash!==hash(previous)||latest.rows[0]?.created_at!=="1794702000003")
        throw Error("EXPECTED_REVIEWED_PREDECESSOR_REQUIRED");
      for(const part of sql.split("--> statement-breakpoint"))if(part.trim())await c.query(part);
      await c.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)",[hash(sql),1794705000000]);
      await c.query("COMMIT");
      console.log(JSON.stringify({migration:"0029_privacy_copy_redaction",hash:hash(sql),developmentOnly:true,existingRowsChanged:0}));
    }
  }else throw Error("EXPLICIT_MIGRATION_ACTION_REQUIRED");
}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();await pool.end();}
