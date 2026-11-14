import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {pool} from "@workspace/db";
import {captureReference} from "../editorial/source-capture";
import {readSourceText} from "../editorial/source-storage";

if(process.env.NODE_ENV!=="development"||process.env.VALO_RUN_SOURCE_RETRIEVAL!=="official-development-only")
  throw Error("Explicit development source acknowledgement required");
const dir=fileURLToPath(new URL("../../../../generated-artifacts/valo-business-name",import.meta.url));
await mkdir(dir,{recursive:true});
const records=[];
try{
  for(const id of ["SV-010","CAC-BN-PROCESS","NIPC-BFA-2022","NCC-COPYRIGHT"]){
    const record=await captureReference(id);
    records.push(record);
    if(record.textChecksum){
      const text=await readSourceText(record.id,record.textChecksum);
      const pages=text.split("\f");
      const selected=id==="SV-010"?pages.slice(404,406).join("\f"):
        id==="NIPC-BFA-2022"?pages.slice(8,13).join("\f"):
        id==="NCC-COPYRIGHT"?pages[7]??"":text;
      await writeFile(`${dir}/${id}-selected.txt`,selected);
    }
    console.log(JSON.stringify({sourceId:id,status:record.status,bytes:record.bytes,failure:record.failureCode}));
  }
  await writeFile(`${dir}/retrieval.json`,JSON.stringify({completedAt:new Date().toISOString(),records,
    issue:"https://github.com/obeidpeter/Valo-Compliance/issues/4",publication:"held",
    currentness:"unverified",note:"Actual immutable private snapshots; selected text is operator research, not a released rule."},null,2)+"\n");
}finally{await pool.end();}
