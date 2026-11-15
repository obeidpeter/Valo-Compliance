import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
try{
  assertDevelopmentRuntime();
  if(process.env.VALO_APPLY_DISPUTE_SCHEMA!=="reviewed-additive-development-only")throw Error("EXPLICIT_DEVELOPMENT_REVIEW_REQUIRED");
  const migration=process.argv.includes("--category")?"0026_dispute_category":"0025_dispute_merchant";
  const source=await readFile(new URL(migration==="0026_dispute_category"?
    "../../../../lib/db/drizzle/0026_dispute_category.sql":"../../../../lib/db/drizzle/0025_dispute_merchant.sql",import.meta.url),"utf8");
  await db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(747115)`);
    await tx.execute(sql.raw(source));});
  console.log(JSON.stringify({migration,sha256:createHash("sha256").update(source).digest("hex"),
    developmentApplied:true,productionApplied:false,baselineAdopted:false}));
}finally{await pool.end();}
