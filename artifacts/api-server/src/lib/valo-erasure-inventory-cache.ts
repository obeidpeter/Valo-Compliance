import {createHash} from "node:crypto";
// Reviewed 0022 migration function body, not a caller-provided assertion.
export const inventoryGuardBodyHash="468f3ac8aa0112fd79bee6d30646544efb0a64ca105fcc03040f762a76beb500";
export const inventoryGuardDefinition="CREATE TRIGGER valo_erasure_inventory_immutable BEFORE INSERT OR DELETE OR UPDATE OF case_id, workspace_id, object_key ON public.valo_privacy_erasure_objects FOR EACH ROW EXECUTE FUNCTION valo_guard_erasure_inventory()";
type Guard={epoch:string;table_oid:string;trigger_oid:string;trigger_revision:string;function_oid:string;
  function_revision:string;enabled:string;definition:string;body:string;security_definer:boolean;
  settings:string[]|null;language:string;function_schema:string};
export function inventoryGuardStamp(g:Guard|undefined){
  if(!g||g.enabled!=="O"||g.security_definer||g.settings!==null||g.language!=="plpgsql"||
    g.function_schema!=="public"||g.definition!==inventoryGuardDefinition||
    createHash("sha256").update(g.body).digest("hex")!==inventoryGuardBodyHash)return null;
  return createHash("sha256").update(JSON.stringify(g)).digest("hex");
}
/** Only cache a completed full check under the exact immutable database guard.
 * A new process, restore epoch, ALTER TRIGGER/function change, changed seal or
 * expiry rechecks all keys. Missing/unknown guards always use the full check.
 * No object bytes or unbounded key sets are retained in memory. */
export class ErasureInventoryAttestations{
  private entries=new Map<string,{seal:string;guard:string;expires:number}>();
  scans=0;hits=0;
  async verify(id:string,seal:string,guard:string|null,full:()=>Promise<void>,fresh=false){
    const old=this.entries.get(id);
    if(!fresh&&guard&&old?.seal===seal&&old.guard===guard&&old.expires>Date.now()){
      this.hits++;this.entries.delete(id);this.entries.set(id,old);return;
    }
    this.entries.delete(id);this.scans++;await full();
    if(guard){
      if(this.entries.size>=64)this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(id,{seal,guard,expires:Date.now()+300_000});
    }
  }
}
