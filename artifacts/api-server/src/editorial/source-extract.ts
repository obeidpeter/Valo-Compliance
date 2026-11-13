import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SOURCE_BYTES,SourceFailure } from "./source-fetch";
const execute=promisify(execFile);
export const EXTRACTION_VERSION="source-text-1";
export function checkExtractedText(text:string){
  if(text.trim().length<200)throw new SourceFailure("SOURCE_INSUFFICIENT_TEXT");
  if(/just a moment|verify you are human|checking your browser|access denied|enable javascript and cookies/i.test(text.slice(0,2500)))
    throw new SourceFailure("SOURCE_CHALLENGE_PAGE");
}
export async function extractSource(bytes:Buffer,mime:string){
  if(bytes.length>MAX_SOURCE_BYTES)throw new SourceFailure("SOURCE_TOO_LARGE");
  let text:string,title:string|null=null,locatorKind="extracted_text_lines";
  if(mime==="application/pdf"||bytes.subarray(0,5).toString()==="%PDF-"){
    if(bytes.subarray(0,5).toString()!=="%PDF-")throw new SourceFailure("SOURCE_INVALID_PDF");
    const dir=await mkdtemp(join(tmpdir(),"valo-source-"));
    try{
      const file=join(dir,"source.pdf");await writeFile(file,bytes);
      text=(await execute("pdftotext",["-layout","-enc","UTF-8",file,"-"],
        {timeout:20000,maxBuffer:MAX_SOURCE_BYTES})).stdout;
      locatorKind="pdf_pages_and_extracted_lines";
    }finally{await rm(dir,{recursive:true,force:true});}
  }else if(mime==="text/html"||mime==="application/xhtml+xml"){
    const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH??"/repl/tools/bin/chromium",
      headless:true,timeout:15000,args:["--no-sandbox","--disable-dev-shm-usage"]});
    const timer=setTimeout(()=>{void browser.close();},15000);
    try{
      const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:"block"});
      await context.route("**/*",route=>route.abort());
      const page=await context.newPage();
      await page.setContent(bytes.toString("utf8"),{waitUntil:"domcontentloaded",timeout:10000});
      title=(await page.title()).slice(0,500)||null;
      await page.locator("script,style,template").evaluateAll(nodes=>nodes.forEach(node=>node.remove()));
      const root=page.locator("main").first();
      text=await (await root.count()?root:page.locator("body")).innerText({timeout:5000});
    }finally{clearTimeout(timer);await browser.close();}
  }else if(mime==="text/plain"||mime==="text/markdown"){
    text=bytes.toString("utf8");
  }else throw new SourceFailure("SOURCE_UNSUPPORTED_MIME");
  text=text.replace(/\r\n/g,"\n").trim();
  checkExtractedText(text);
  return{text,title,locators:{kind:locatorKind,lineCount:text.split("\n").length,
    pageCount:locatorKind==="pdf_pages_and_extracted_lines"?text.split("\f").filter(p=>p.trim()).length:null}};
}
