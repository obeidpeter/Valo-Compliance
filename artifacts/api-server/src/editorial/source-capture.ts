import { randomUUID,createHash } from "node:crypto";
import { db,valoSourceSnapshots } from "@workspace/db";
import { fetchOfficialSource,referenceFor,SourceFailure } from "./source-fetch";
import { extractSource,EXTRACTION_VERSION } from "./source-extract";
import { storeSourceSnapshot } from "./source-storage";
export async function captureReference(id:string){
  if(process.env.NODE_ENV!=="development")throw Error("SOURCE_CAPTURE_DEVELOPMENT_ONLY");
  const lead=referenceFor(id);
  const row:typeof valoSourceSnapshots.$inferInsert={
    id:randomUUID(),sourceId:lead.id,url:lead.url,attemptedAt:new Date(),
    status:"held_transport",extractionVersion:EXTRACTION_VERSION,
    metadata:{declaredTitle:lead.title,rights:"unassessed",issuingBody:null,jurisdiction:null,
      effectiveFrom:null,effectiveTo:null,sourceCheckedAt:null,aiReviewedAt:null,publishedAt:null,
      publication:"held",untrustedInput:true},
  };
  try{
    const response=await fetchOfficialSource(id);
    Object.assign(row,{finalUrl:response.finalUrl,fetchedAt:response.fetchedAt,httpStatus:response.status,
      mime:response.mime,bytes:response.bytes.length,
      rawChecksum:createHash("sha256").update(response.bytes).digest("hex")});
    row.status="held_storage";
    const raw=await storeSourceSnapshot(row.id,"raw",response.bytes);row.rawObjectKey=raw.key;
    if(response.status<200||response.status>=300){
      row.status="held_http";row.failureCode=`SOURCE_HTTP_${response.status}`;
    }else{
      row.status="held_extraction";
      const extracted=await extractSource(response.bytes,response.mime);
      row.status="held_storage";
      const text=await storeSourceSnapshot(row.id,"text",Buffer.from(extracted.text));
      row.textChecksum=text.checksum;row.textObjectKey=text.key;
      row.status="retrieved_unreviewed";
      row.metadata={...row.metadata,retrievedTitle:extracted.title,locators:extracted.locators,
        textCharacters:extracted.text.length};
    }
  }catch(error){
    row.failureCode=error instanceof SourceFailure?error.code:
      row.status==="held_storage"?"SOURCE_STORAGE_FAILED":
      row.status==="held_extraction"?"SOURCE_EXTRACTION_FAILED":"SOURCE_TRANSPORT_FAILED";
  }
  await db.insert(valoSourceSnapshots).values(row);
  return{id:row.id,sourceId:row.sourceId,status:row.status,failureCode:row.failureCode??null,
    httpStatus:row.httpStatus??null,fetchedAt:row.fetchedAt?.toISOString()??null,
    rawChecksum:row.rawChecksum??null,textChecksum:row.textChecksum??null,
    rawStored:Boolean(row.rawObjectKey),textStored:Boolean(row.textObjectKey),publication:"held" as const};
}
