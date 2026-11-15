import {chromium} from "playwright";
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export type ReceiptSnapshot={reference:string;transactionId:string;amountKobo:number;title:string;createdAt:string;taxTreatment:string;licenceVersion:string};
/** Only immutable financial fields. No draft/document, claimed delivery fact,
 * remote resource, customer bank/card details, or arbitrary uploaded bytes. */
export async function renderDisputeReceipt(s:ReceiptSnapshot){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||"/repl/tools/bin/chromium",timeout:15000});
 const watchdog=setTimeout(()=>{void browser.close();},30000);
 try{const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:"block"});await context.route("**/*",route=>route.abort());
 const page=await context.newPage();await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>Test purchase receipt</title><style>body{font:14px sans-serif;color:#17252b}h1{font-size:24px}dt{font-weight:700;margin-top:16px}dd{margin:4px 0;overflow-wrap:anywhere}</style></head><body><h1>Valo — test purchase receipt</h1><p>TEST TRANSACTION. This records a verified application purchase. It does not certify delivery, tax compliance or a bank's dispute decision.</p><dl>${Object.entries({"Order reference":s.reference,"Provider transaction":s.transactionId,"Purchase time":s.createdAt,"Item":s.title,"Paid amount":`NGN ${(s.amountKobo/100).toFixed(2)}`,"Recorded tax treatment":s.taxTreatment,"Licence version":s.licenceVersion}).map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("")}</dl></body></html>`,{waitUntil:"load",timeout:10000});
 return await page.pdf({format:"A4",printBackground:true,margin:{top:"20mm",bottom:"20mm",left:"20mm",right:"20mm"}});
 }finally{clearTimeout(watchdog);await browser.close();}
}
