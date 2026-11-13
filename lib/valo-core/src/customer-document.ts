import { financialBlocks,type FinancialInput } from "./money";
export type CustomerTask=FinancialInput["kind"];
export type CustomerDraftInput={
  task:CustomerTask;tone:"neutral"|"polite"|"firm";issuerName:string;recipientName:string;documentNumber:string;
  issueDate:string;dueDate:string;contextLines:string[];financialInput:FinancialInput;
};
export type CustomerPlan={opening:"none"|"please_review"|"for_consideration"|"outstanding_record";
  sections:{heading:"overview"|"scope"|"deliverables"|"next_steps"|"notes";lineIndexes:number[]}[]};
const titles:Record<CustomerTask,string>={invoice:"Invoice",quotation:"Quotation",
  payment_reminder:"Payment reminder",business_proposal:"Business proposal"};
const openings:Record<CustomerPlan["opening"],string>={none:"",
  please_review:"Please review the supplied details below.",for_consideration:"For your consideration and review.",
  outstanding_record:"Please review the outstanding amount recorded below. This is not independently verified payment evidence."};
const headings:Record<CustomerPlan["sections"][number]["heading"],string>={
  overview:"Overview",scope:"Scope",deliverables:"Deliverables",next_steps:"Next steps",notes:"Notes",
};
/** The model only selects structure and approved connective wording. All facts remain verbatim inputs. */
export function buildBusinessDraft(input:CustomerDraftInput,plan:CustomerPlan|null){
  const narrative:{id:string;type:"paragraph";text:string;rows:string[][]}[]=[];
  if(plan){
    const indexes=plan.sections.flatMap(s=>s.lineIndexes);
    if(indexes.length!==input.contextLines.length||new Set(indexes).size!==indexes.length||
      indexes.some(i=>!Number.isInteger(i)||i<0||i>=input.contextLines.length))
      throw Error("AI_PLAN_MUST_PRESERVE_EVERY_SUPPLIED_LINE_ONCE");
    if(plan.opening==="outstanding_record"&&input.task!=="payment_reminder")throw Error("AI_OPENING_OUTSIDE_TASK");
    if(openings[plan.opening])narrative.push({id:"draft-opening",type:"paragraph",text:openings[plan.opening],rows:[]});
    plan.sections.forEach((s,i)=>{
      const text=`${headings[s.heading]}\n${s.lineIndexes.map(index=>input.contextLines[index]).join("\n")}`;
      if(text.length>8000)throw Error("AI_SECTION_TOO_LONG");
      if(s.lineIndexes.length)narrative.push({id:`draft-section-${i}`,type:"paragraph",text,rows:[]});
    });
  }else input.contextLines.forEach((text,i)=>narrative.push({id:`draft-manual-${i}`,type:"paragraph",text,rows:[]}));
  if(narrative.length===0)narrative.push({id:"draft-manual-empty",type:"paragraph",text:"",rows:[]});
  const content={fields:{issuerName:input.issuerName,recipientName:input.recipientName,
    documentNumber:input.documentNumber,issueDate:input.issueDate,dueDate:input.dueDate,
    notes:plan?"AI organised supplied facts; not professionally reviewed. No statutory tax rate or payment verification is implied.":
      "Business draft prepared from supplied fields; no AI completion or professional review is claimed."},
    blocks:[...narrative,...financialBlocks(input.financialInput)],selectedClauses:[] as string[],
    formatting:{font:"serif" as const,accent:"forest" as const},financialInput:input.financialInput};
  return{title:`${titles[input.task]}${input.documentNumber?` — ${input.documentNumber}`:""}`.slice(0,160),content};
}
