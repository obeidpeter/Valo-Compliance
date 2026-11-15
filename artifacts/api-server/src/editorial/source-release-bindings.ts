import {sql} from "drizzle-orm";
import {allSourceLeads,publicationSchema} from "@workspace/valo-core";
import {readSourceText} from "./source-storage";
import {type SourceTx,type SourceTarget,sourceTargetAllowed,sourceTime} from "../lib/valo-source-state";
/** Server-only evidence binding. A client/staff action cannot bless a snapshot.
 * The ordinary publisher must still pass every existing review/rights/render
 * gate. Exact passages are checked against retained full extracted bytes. */
export async function bindReleasedSources(tx:SourceTx,kind:SourceTarget,id:string,raw:unknown,
 snapshotIds:Record<string,string>={},now=new Date()){
 const bundle=publicationSchema.parse(raw);
 for(const source of bundle.sources){
  if(!allSourceLeads.some(s=>s.url===source.url)||!snapshotIds[source.id])throw Error("SOURCE_SNAPSHOT_BINDING_REQUIRED");
  const snapshot=(await tx.execute(sql`select s.*,w.last_raw_hash,w.checked_at,w.failure_code from valo_source_snapshots s
   join valo_source_watches w on w.source_id=s.source_id where s.id=${snapshotIds[source.id]!}::uuid and s.url=${source.url} and w.url=${source.url}`)).rows[0];
  if(!snapshot||!allSourceLeads.some(s=>s.id===snapshot.source_id&&s.url===source.url)||snapshot.status!=="retrieved_unreviewed"||snapshot.failure_code||!snapshot.raw_object_key||!snapshot.text_object_key||
    snapshot.raw_checksum!==snapshot.last_raw_hash||!snapshot.checked_at||sourceTime(snapshot.checked_at)+86400000<=+now)
   throw Error("SOURCE_CURRENT_CAPTURE_REQUIRED");
  const text=await readSourceText(String(snapshot.id),String(snapshot.text_checksum));
  if(!text.includes(source.text)||bundle.candidate.claims.filter(c=>c.sourceId===source.id).some(c=>!text.includes(c.quote)))
   throw Error("SOURCE_PASSAGE_SNAPSHOT_MISMATCH");
  await tx.execute(sql`insert into valo_source_release_bindings(target_kind,target_id,source_id,bundle_source_id,source_hash,snapshot_id,raw_hash,created_at)
   values(${kind},${id}::uuid,${String(snapshot.source_id)},${source.id},${source.hash},${String(snapshot.id)}::uuid,${String(snapshot.raw_checksum)},clock_timestamp()) on conflict do nothing`);
 }
 if(!await sourceTargetAllowed(tx,kind,id,bundle,now))throw Error("SOURCE_RELEASE_CURRENTNESS_HELD");
}
