import {GUIDED_SPECS_V1} from "./guided-specs-v1";
import type {GuidedData,GuidedField,GuidedSpec,GuidedTemplateId} from "./guided";
import {financialBlocks,formatKobo,recordedBalance,type FinancialInput} from "./money";
export const GUIDED_PREFIX="valo-guided-v1:";
export type GuidedBlock={id:string;type:"paragraph"|"list"|"table";text:string;rows:string[][]};
type Content={fields:{issuerName:string;recipientName:string;documentNumber:string;issueDate:string;dueDate:string;notes:string};
  blocks:GuidedBlock[];financialInput?:FinancialInput;selectedClauses:string[];formatting:{font:"serif"|"sans";accent:"forest"|"charcoal"}};
export const guidedVisible=(f:{when?:{field:string;equals:string}},v:Record<string,string>)=>!f.when||v[f.when.field]===f.when.equals;
export function guidedCalendarDate(v:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(`${v}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;
}
export function guidedFieldIssue(f:GuidedField,raw:string|undefined){
  const value=(raw??"").trim();
  if(!value)return f.required?"This answer is required.":null;
  if(value.length>(f.type==="long_text"?4000:["issuerName","recipientName"].includes(f.id)?160:f.id==="documentNumber"?80:400))
    return"Shorten this answer; it exceeds the supported field length.";
  if(f.required&&/^(unknown|unanswered|not_applicable|not supplied|\[[^\]]+\])$/i.test(value))return"Resolve this required fact or keep an incomplete draft.";
  if(f.type==="date")return guidedCalendarDate(value)?null:"Enter a real date (YYYY-MM-DD).";
  if(f.type==="integer")return /^(0|[1-9]\d{0,8})$/.test(value)?null:"Enter a whole number without separators.";
  if(f.type==="quantity")return /^(0|[1-9]\d{0,6})(\.\d{1,3})?$/.test(value)&&Number(value)>0?null:"Enter a positive quantity with up to three decimal places.";
  if(f.type==="money_kobo"){
    if(!/^(0|[1-9]\d{0,23})$/.test(value))return"Enter whole kobo, not naira or a guessed rate.";
    if(f.positive&&BigInt(value)===0n)return"This acknowledged amount must be positive.";
  }
  if(f.type==="select"&&!f.options?.some(o=>o.value===value))return"Choose a listed option.";
  if(f.type==="acknowledgement"&&value!=="yes")return"Confirm this statement explicitly.";
  return null;
}
export function emptyGuidedData(templateId:GuidedTemplateId):GuidedData{
  if(!Object.hasOwn(GUIDED_SPECS_V1,templateId))throw Error("UNSUPPORTED_GUIDED_TEMPLATE");
  const s=GUIDED_SPECS_V1[templateId];if(!s)throw Error("UNSUPPORTED_GUIDED_TEMPLATE");
  return{schemaVersion:1,templateId,values:Object.fromEntries(s.fields.map(f=>[f.id,""])),
    tables:Object.fromEntries(s.tables.map(t=>[t.id,Array.from({length:t.minRows},()=>Object.fromEntries(t.columns.map(c=>[c.id,""])))]))};
}
export function guidedDataIssues(spec:GuidedSpec,data:GuidedData):Record<string,string>{
  const issues:Record<string,string>={};
  if(data.schemaVersion!==1||data.templateId!==spec.templateId)return{form:"Answers belong to another form/version."};
  for(const field of spec.fields)if(guidedVisible(field,data.values)){
    const issue=guidedFieldIssue(field,data.values[field.id]);if(issue)issues[field.id]=issue;
  }
  for(const table of spec.tables)if(guidedVisible(table,data.values)){
    const rows=data.tables[table.id]??[];
    if(rows.length<table.minRows||rows.length>table.maxRows)issues[table.id]=`Supply ${table.minRows}–${table.maxRows} rows.`;
    rows.forEach((row,index)=>table.columns.forEach(column=>{
      if(!guidedVisible(column,{...data.values,...row}))return;
      const issue=guidedFieldIssue(column,row[column.id]);if(issue)issues[`${table.id}:${index}:${column.id}`]=issue;
    }));
  }
  for(const check of spec.dateOrder??[]){
    const before=spec.fields.find(f=>f.id===check.before),after=spec.fields.find(f=>f.id===check.after);
    if(before&&after&&guidedVisible(before,data.values)&&guidedVisible(after,data.values)&&
      guidedCalendarDate(data.values[check.before]??"")&&guidedCalendarDate(data.values[check.after]??"")&&
      data.values[check.after]<data.values[check.before])issues[check.after]=check.message;
  }
  if(spec.templateId==="TPL-12"&&data.values.paymentsKnown==="unknown")issues.paymentsKnown="Confirm which payments are allocated; an unknown allocation is not zero.";
  try{calculatedBlocks(data);}catch{issues.calculation="Resolve the financial amounts, duplicate allocations or discount before completing the document.";}
  return issues;
}
function financialData(data:GuidedData):FinancialInput|null{
  if(!["TPL-01","TPL-02","TPL-04","TPL-12"].includes(data.templateId))return null;
  const s=GUIDED_SPECS_V1[data.templateId],v=data.values;
  if(data.templateId==="TPL-12"){
    if(guidedFieldIssue(s.fields.find(f=>f.id==="invoiceAmountKobo")!,v.invoiceAmountKobo)||
      !["none","listed"].includes(v.paymentsKnown))return null;
    const table=s.tables[0],rows=v.paymentsKnown==="listed"?data.tables.payments??[]:[];
    if(v.paymentsKnown==="listed"&&(!rows.length||rows.some(r=>table.columns.some(c=>guidedFieldIssue(c,r[c.id])))))return null;
    const paymentRecord={invoiceAmountKobo:v.invoiceAmountKobo.trim(),payments:rows.map(r=>({reference:r.reference,amountKobo:r.amountKobo.trim()}))};
    const b=recordedBalance(paymentRecord);
    return{kind:"payment_reminder",lines:[],taxAmountKobo:null,taxLabel:"",discountKobo:null,
      amountDueKobo:b.amountDueKobo,paymentRecord};
  }
  const table=s.tables.find(t=>t.id==="items")!,rows=data.tables.items??[];
  if(!rows.length||rows.some(r=>table.columns.some(c=>guidedVisible(c,{...v,...r})&&guidedFieldIssue(c,r[c.id]))))return null;
  for(const key of["taxMode","discountMode","taxAmountKobo","taxLabel","taxBasis","discountKobo"]){
    const field=s.fields.find(f=>f.id===key)!;
    if(guidedVisible(field,v)&&guidedFieldIssue(field,v[key]))return null;
  }
  return{kind:data.templateId==="TPL-02"?"quotation":"invoice",
    lines:rows.map(r=>({description:`${r.description} (${r.unit==="other"?r.otherUnit:r.unit})`,
      quantity:r.quantity.trim(),unitPriceKobo:r.unitPriceKobo.trim()})),
    taxAmountKobo:v.taxMode==="supplied"?v.taxAmountKobo.trim():null,taxLabel:v.taxMode==="supplied"?v.taxLabel:"",
    discountKobo:v.discountMode==="supplied"?v.discountKobo.trim():null,amountDueKobo:null};
}
function calculatedBlocks(data:GuidedData):GuidedBlock[]{
  const input=financialData(data);
  return input?financialBlocks(input).map(b=>({...b,id:`${GUIDED_PREFIX}${data.templateId}:calc:${b.id}`})):[];
}
const block=(id:string,text:string):GuidedBlock=>({id,type:"paragraph",text,rows:[]});
function questionBlocks(data:GuidedData):GuidedBlock[]{
  const spec=GUIDED_SPECS_V1[data.templateId],prefix=`${GUIDED_PREFIX}${data.templateId}:`;
  return[block(prefix+"form",spec.title),
    ...spec.fields.map(f=>block(prefix+"field:"+f.id,`${f.label}\n${data.values[f.id]??""}`)),
    ...spec.tables.map(t=>({id:prefix+"table:"+t.id,type:"table" as const,text:t.label,
      rows:[t.columns.map(c=>c.label),...(data.tables[t.id]??[]).map(row=>t.columns.map(c=>row[c.id]??""))]}))];
}
/** Answers use versioned existing canonical blocks, not a new unversioned hash
 * field. Internal IDs are not rendered. Legacy v1 document hashes stay frozen. */
export function guidedDataFromBlocks(blocks:readonly GuidedBlock[]):GuidedData|null{
  const tagged=blocks.filter(b=>b.id.startsWith(GUIDED_PREFIX));
  if(!tagged.length)return null;
  const markers=tagged.filter(b=>b.id.endsWith(":form"));
  if(markers.length!==1)throw Error("GUIDED_FORM_MARKER_REQUIRED");
  const id=markers[0].id.slice(GUIDED_PREFIX.length,-":form".length) as GuidedTemplateId;
  const spec=GUIDED_SPECS_V1[id];if(!spec||markers[0].type!=="paragraph"||markers[0].text!==spec.title)throw Error("UNSUPPORTED_GUIDED_VERSION");
  const prefix=`${GUIDED_PREFIX}${id}:`,data=emptyGuidedData(id),allowed=new Set([prefix+"form"]);
  for(const field of spec.fields){
    const key=prefix+"field:"+field.id;allowed.add(key);
    const matches=tagged.filter(b=>b.id===key);
    if(matches.length!==1||matches[0].type!=="paragraph"||!matches[0].text.startsWith(field.label+"\n")||matches[0].rows.length)
      throw Error("GUIDED_FIELD_STRUCTURE_CHANGED");
    data.values[field.id]=matches[0].text.slice(field.label.length+1);
  }
  for(const table of spec.tables){
    const key=prefix+"table:"+table.id;allowed.add(key);
    const matches=tagged.filter(b=>b.id===key),b=matches[0];
    if(matches.length!==1||b.type!=="table"||b.text!==table.label||
      JSON.stringify(b.rows[0])!==JSON.stringify(table.columns.map(c=>c.label))||
      b.rows.length>table.maxRows+1||b.rows.slice(1).some(r=>r.length!==table.columns.length))throw Error("GUIDED_TABLE_STRUCTURE_CHANGED");
    data.tables[table.id]=b.rows.slice(1).map(row=>Object.fromEntries(table.columns.map((c,i)=>[c.id,row[i]])));
  }
  for(const key of Object.keys(data.values))if(data.values[key].length>4400)throw Error("GUIDED_ANSWER_TOO_LONG");
  for(const b of tagged)if(!allowed.has(b.id)&&!b.id.startsWith(prefix+"calc:"))throw Error("UNKNOWN_GUIDED_BLOCK");
  return data;
}
export function compileGuidedContent(data:GuidedData,previous?:Content):Content{
  if(!Object.hasOwn(GUIDED_SPECS_V1,data.templateId))throw Error("UNSUPPORTED_GUIDED_VERSION");
  const spec=GUIDED_SPECS_V1[data.templateId];if(!spec||data.schemaVersion!==1)throw Error("UNSUPPORTED_GUIDED_VERSION");
  if(Object.keys(data.values).some(k=>!spec.fields.some(f=>f.id===k))||
    Object.keys(data.tables).some(k=>!spec.tables.some(t=>t.id===k)))throw Error("UNKNOWN_GUIDED_ANSWER");
  for(const t of spec.tables)for(const row of data.tables[t.id]??[])
    if(Object.keys(row).some(k=>!t.columns.some(c=>c.id===k)))throw Error("UNKNOWN_GUIDED_COLUMN");
  let calculations:GuidedBlock[]=[];try{calculations=calculatedBlocks(data);}catch{/* Persist raw invalid answers; completion validation blocks them. */}
  const v=data.values,plain=(k:string,max=160)=>(v[k]??"").length<=max?v[k]??"":"";
  const issueDate=guidedCalendarDate(v.issueDate??"")?v.issueDate:"",
    dueDate=data.templateId==="TPL-01"&&guidedCalendarDate(v.dueDate??"")&&(!issueDate||v.dueDate>=issueDate)?v.dueDate:"";
  const generated=[...questionBlocks(data),...calculations],byId=new Map(generated.map(b=>[b.id,b]));
  const seen=new Set<string>(),updating=previous?.blocks.some(b=>b.id.startsWith(GUIDED_PREFIX));
  const preserved=updating?previous!.blocks.flatMap(b=>{
    if(!b.id.startsWith(GUIDED_PREFIX))return b.id.startsWith("financial-")?[]:[b];
    const next=byId.get(b.id);if(!next)return[];seen.add(b.id);return[next];
  }):(previous?.blocks??[]).filter(b=>!b.id.startsWith("financial-"));
  const blocks=updating?[...preserved,...generated.filter(b=>!seen.has(b.id))]:
    [...questionBlocks(data),...preserved,...calculations];
  return{fields:{issuerName:plain("issuerName"),recipientName:plain("recipientName"),documentNumber:plain("documentNumber",80),
      issueDate,dueDate,notes:previous?.fields.notes??"Private business draft from user-entered answers; no professional review, payment verification or signature execution is claimed."},
    blocks,
    selectedClauses:[],formatting:previous?.formatting??{font:"serif",accent:"forest"}};
}
const blockDigest=(blocks:readonly GuidedBlock[])=>JSON.stringify(blocks.map(b=>[b.id,b.type,b.text,b.rows]));
export function guidedContentConsistent(content:Content){
  const data=guidedDataFromBlocks(content.blocks);if(!data)return true;
  if(content.financialInput)throw Error("GUIDED_RAW_AMOUNTS_MUST_USE_THE_BOUND_QUESTION_MODEL");
  const expected=compileGuidedContent(data,content);
  return blockDigest(expected.blocks.filter(b=>b.id.startsWith(GUIDED_PREFIX)))===
    blockDigest(content.blocks.filter(b=>b.id.startsWith(GUIDED_PREFIX)))&&
    ["issuerName","recipientName","documentNumber","issueDate","dueDate"].every(k=>
      content.fields[k as keyof Content["fields"]]===expected.fields[k as keyof Content["fields"]]);
}
/** Shared preview/Word/PDF projection of the exact same saved answers. */
export function guidedRenderableBlocks(content:Content):GuidedBlock[]{
  const data=guidedDataFromBlocks(content.blocks);if(!data)return content.blocks;
  if(!guidedContentConsistent(content))throw Error("GUIDED_CONTENT_TAMPERED");
  const s=GUIDED_SPECS_V1[data.templateId],prefix=`${GUIDED_PREFIX}${data.templateId}:`;
  const hasCalc=content.blocks.some(b=>b.id.startsWith(prefix+"calc:"));
  return content.blocks.flatMap(b=>{
    if(!b.id.startsWith(GUIDED_PREFIX))return[b];
    if(b.id===prefix+"form")return[];
    const field=s.fields.find(f=>b.id===prefix+"field:"+f.id);
    if(field){
      if(!guidedVisible(field,data.values)||!data.values[field.id]?.trim())return[];
      let value=data.values[field.id];
      if(field.type==="money_kobo"&&!guidedFieldIssue(field,value))value=`${formatKobo(value.trim())} (${value.trim()} kobo entered)`;
      if(field.type==="select")value=field.options?.find(o=>o.value===value)?.label??value;
      if(field.type==="acknowledgement")value=value==="yes"?"Confirmed by the user; not independently verified":value;
      return[{...b,text:`${field.label}\n${value}`}];
    }
    const table=s.tables.find(t=>b.id===prefix+"table:"+t.id);
    if(table){
      if(!guidedVisible(table,data.values)||(table.id==="items"&&hasCalc)||b.rows.length===1)return[];
      const columns=table.columns.map((c,i)=>({c,i})).filter(({c})=>!c.when||
        (data.tables[table.id]??[]).some(row=>guidedVisible(c,{...data.values,...row})));
      return[{...b,rows:b.rows.map((row,index)=>columns.map(({c,i})=>{
        const value=row[i];if(index===0)return c.type==="money_kobo"?value.replace(/whole kobo/g,"NGN displayed from supplied kobo"):value;
        const context={...data.values,...(data.tables[table.id]?.[index-1]??{})};
        if(!guidedVisible(c,context))return"";
        if(c.type==="money_kobo"&&!guidedFieldIssue(c,value))return formatKobo(value.trim());
        return c.type==="select"?c.options?.find(o=>o.value===value)?.label??value:value;
      }))}];
    }
    return[b];
  });
}
