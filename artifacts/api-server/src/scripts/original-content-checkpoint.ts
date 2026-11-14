import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {unzipSync,strFromU8} from "fflate";
import {digest,sha256} from "@workspace/valo-core";
import {originalSections,industrySections,operationalDocument} from "../editorial/original-content-adapter";
import {publicationWorkspaceRoot} from "../editorial/operational-policy";
import {renderDocument} from "../lib/valo-render";
const exec=promisify(execFile);
async function main(){
  if(process.env.VALO_ORIGINAL_CONTENT_CHECKPOINT!=="synthetic-development-only")throw Error("EXPLICIT_DEVELOPMENT_FLAG_REQUIRED");
  const root=publicationWorkspaceRoot(),out=resolve(root,"generated-artifacts/valo-original-content");
  await mkdir(out,{recursive:true});
  const load=(name:string)=>readFile(resolve(root,`docs/content-candidates/${name}-candidates.md`),"utf8");
  const forms=originalSections(await load("operational-template"));
  const guides=originalSections(await load("practical-guide"));
  const industries=industrySections(await load("industry-content"));
  if(forms.length!==7||guides.length!==12)throw Error("CONTENT_COUNTS_CHANGED");
  const exports=[];
  for(const form of forms){
    const document=operationalDocument(form),revisionHash=digest(document);
    for(const format of ["docx","pdf"] as const){
      const bytes=await renderDocument(document,format,1,"template_sample");
      const path=resolve(out,`${form.id}.${format}`);await writeFile(path,bytes);
      let pages:number|null=null;
      if(format==="docx"){
        const zip=unzipSync(bytes);
        if(!zip["word/document.xml"]||!strFromU8(zip["word/document.xml"]!).includes(form.title))
          throw Error("DOCX_MASTER_TEXT_MISSING");
        if(Object.keys(zip).some(key=>/vbaProject|activeX/i.test(key)))throw Error("ACTIVE_CONTENT_NOT_ALLOWED");
      }else{
        const info=(await exec("pdfinfo",[path])).stdout;
        pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
        const size=info.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)/m);
        if(!pages||!size||Math.abs(Number(size[1])-595.28)>2||Math.abs(Number(size[2])-841.89)>2)
          throw Error("PDF_A4_READER_VALIDATION_FAILED");
        const text=(await exec("pdftotext",[path,"-"])).stdout;
        if(!text.toLowerCase().includes(form.title.toLowerCase()))throw Error("PDF_MASTER_TEXT_MISSING");
      }
      exports.push({templateId:form.id,format,bytes:bytes.length,checksum:sha256(bytes),revision:1,revisionHash,pages,
        status:"rendered-and-parsed",publiclyAvailable:false});
    }
  }
  const report={executedAt:new Date().toISOString(),sourceCommit:process.argv[2]??null,
    scope:"Original content adaptation and automated format checks only; not publication, Word UI inspection or R1 acceptance",
    counts:{forms:forms.length,guides:guides.length,industries:20,packs:6,
      industryTemplateMappings:industries.filter(e=>e.id.startsWith("IND")).reduce((n,e)=>n+e.relatedTemplateIds.length,0),
      packTemplateMappings:industries.filter(e=>e.id.startsWith("PACK")).reduce((n,e)=>n+e.relatedTemplateIds.length,0)},
    candidates:[...forms,...guides,...industries].map(({body,...entry})=>({...entry,bodyHash:sha256(body),
      state:"held",missing:["final-version independent factual and challenge checks","applicable rights evidence and release manifest"]})),
    exports,commercialLicenceAccepted:false,productionLaunchEnabled:false,livePaymentsEnabled:false};
  const reportPath=resolve(root,"docs/valo/evidence/original-content-adaptation.json");
  await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
  process.stdout.write(JSON.stringify({report:reportPath,counts:report.counts,exports:exports.length})+"\n");
}
main().catch(error=>{
  const message=error instanceof Error?error.message:"UNKNOWN_ERROR";
  process.stderr.write(JSON.stringify({code:"ORIGINAL_CONTENT_CHECKPOINT_FAILED",
    reason:/^[A-Z0-9_]+$/.test(message)?message:"RENDER_OR_READER_FAILED"})+"\n");process.exitCode=1;
});
