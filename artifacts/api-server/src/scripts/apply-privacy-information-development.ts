import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
try{
  assertDevelopmentRuntime();
  if(process.env.VALO_APPLY_PRIVACY_INFORMATION!=="reviewed-additive-development-only")throw Error("EXPLICIT_DEVELOPMENT_REVIEW_REQUIRED");
  const source=await readFile(new URL("../../../../lib/db/drizzle/0022_privacy_information.sql",import.meta.url),"utf8");
  await db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(747112)`);
    const r=await tx.execute(sql`SELECT to_regclass('public.valo_privacy_messages') AS object`);
    if(r.rows[0]?.object)throw Error("PRIVACY_INFORMATION_TABLE_ALREADY_EXISTS");
    await tx.execute(sql.raw(source.replaceAll("--> statement-breakpoint","")));
  });
  console.log(JSON.stringify({migration:"0022_privacy_information",sha256:createHash("sha256").update(source).digest("hex"),
    developmentApplied:true,productionApplied:false,baselineAdopted:false,secretsChanged:false}));
}finally{await pool.end();}
