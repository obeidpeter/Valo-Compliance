import type {GuidedField as F,GuidedSpec,GuidedTable as T,GuidedTemplateId} from "./guided";

/** Frozen question/layout definitions, NOT released editorial masters. No
 * statutory threshold, contractual default, signature or party is supplied. */
const f=(id:string,label:string,type:F["type"]="text",required=true,extra:Partial<F>={}):F=>({id,label,type,required,...extra});
const long=(id:string,label:string,required=true,extra:Partial<F>={})=>f(id,label,"long_text",required,extra);
const pick=(id:string,label:string,options:[string,string][],extra:Partial<F>={})=>
  f(id,label,"select",true,{options:options.map(([value,label])=>({value,label})),...extra});
const date=(id:string,label:string,required=true,extra:Partial<F>={})=>f(id,label,"date",required,extra);
const money=(id:string,label:string,required=true,extra:Partial<F>={})=>
  f(id,label,"money_kobo",required,{help:"Whole kobo, not naira: 100 kobo = NGN 1.00. No rate is inferred.",...extra});
const table=(id:string,label:string,columns:F[],minRows=1,extra:Partial<T>={}):T=>
  ({id,label,columns,minRows,maxRows:40,...extra});
const yesNo:[string,string][]=[["no","No"],["yes","Yes"]];
const units:[string,string][]=[["each","Each"],["kg","Kilograms"],["g","Grams"],["litre","Litres"],
  ["ml","Millilitres"],["hour","Hours"],["day","Days"],["other","Other, specified below"]];
const unitColumns=[pick("unit","Quantity unit",units),
  f("otherUnit","Other quantity unit","text",true,{when:{field:"unit",equals:"other"}})];
const items=()=>table("items","Goods, work and agreed charges",[
  f("description","Description"),f("quantity","Quantity","quantity"),...unitColumns,
  money("unitPriceKobo","Unit price in whole kobo, for the chosen quantity unit"),
],1,{help:"Use a separate accurately described line for each agreed charge. Do not invent rates or items."});
const header=()=>[f("issuerName","Issuing business legal name"),long("issuerAddress","Issuing business contact/address"),
  f("recipientName","Customer legal name"),long("recipientAddress","Customer contact/address",false),
  f("documentNumber","Document reference"),date("issueDate","Issue date")];
const pricing=()=>[
  pick("taxMode","Include a user-supplied tax amount?",[["none","No tax line supplied"],["supplied","I have the supported amount and label"]]),
  money("taxAmountKobo","Supported tax amount in whole kobo",true,{when:{field:"taxMode",equals:"supplied"}}),
  f("taxLabel","Supported tax label","text",true,{when:{field:"taxMode",equals:"supplied"}}),
  long("taxBasis","Reference/basis for the amount you supplied",true,{when:{field:"taxMode",equals:"supplied"}}),
  pick("discountMode","Include an agreed discount?",[["none","No discount"],["supplied","Supply an agreed amount"]]),
  money("discountKobo","Agreed discount in whole kobo",true,{when:{field:"discountMode",equals:"supplied"}}),
];
const contextNotice="Answers are your business facts and negotiated terms, not legal findings. This question layout is not evidence that a catalogue master has been released.";
function spec(id:GuidedTemplateId,title:string,fields:F[],tables:T[]=[],extra:Partial<GuidedSpec>={}):GuidedSpec{
  return{schemaVersion:1,templateId:id,title,description:"Complete the questions with information you actually know. Unresolved required facts prevent a complete result.",
    fields,tables,sections:[{id:"answers",label:"Document questions",fieldIds:fields.map(f=>f.id)}],
    notices:[contextNotice],...extra};
}
const parties=()=>[
  f("issuerName","First party's full legal name"),long("issuerAddress","First party's address"),
  f("issuerLegalForm","First party's legal form and authority assumptions"),
  f("issuerRegistration","First party's registration reference, if actually known","text",false),
  f("recipientName","Second party's full legal name"),long("recipientAddress","Second party's address"),
  f("recipientLegalForm","Second party's legal form and authority assumptions"),
  f("recipientRegistration","Second party's registration reference, if actually known","text",false),
  f("documentNumber","Agreement reference"),date("issueDate","Draft/agreement date"),
  f("jurisdiction","Relevant Nigerian State/FCT and intended Nigerian-law scope",
    "text",true,{help:"Identify the actual transaction and jurisdiction. No enforceability or cross-border suitability is assessed."}),
];
const term=()=>[
  date("startDate","Agreed commencement date"),
  pick("termType","Agreed duration",[["fixed","Fixed end date"],["open","Open-ended, with specified termination terms"]]),
  date("endDate","Agreed end date",true,{when:{field:"termType",equals:"fixed"}}),
  long("terminationTerms","Complete negotiated termination, notice and exit arrangements"),
];
const commercial=()=>[
  money("feeKobo","Agreed fee in whole kobo"),long("paymentTerms","Payment basis, milestones, currency and due-date arrangement"),
  long("expensesTerms","Expense/extra-work arrangements, including none if agreed"),
  long("taxTreatment","Tax/invoicing responsibilities and unresolved tax questions; do not guess a rate"),
  long("confidentialityTerms","Agreed confidentiality boundaries and permitted disclosures"),
  long("ipTerms","Background/new intellectual-property treatment, permissions and unresolved rights"),
  long("liabilityTerms","Specifically negotiated responsibility, exclusions and liability terms"),
  long("disputeTerms","Agreed escalation/dispute route and relevant location, subject to mandatory rules"),
];
const employment=()=>[
  f("issuerName","Employer's full legal name"),long("issuerAddress","Employer's address"),
  f("recipientName","Employee/candidate's full name"),long("recipientAddress","Employee/candidate's address"),
  f("documentNumber","Document reference"),date("issueDate","Document date"),f("role","Role/job title"),
  f("reportsTo","Reporting role/person"),long("duties","Specific duties or exact attached role-description version"),
  long("workplace","Work location and actual remote/travel arrangements"),
  ...term(),money("grossPayKobo","Gross pay per stated period, in whole kobo"),
  pick("payPeriod","Period for the gross amount",[["hour","Hour"],["day","Day"],["week","Week"],["month","Month"],["year","Year"]]),
  long("payBasis","Salary/hourly basis, cycle, payment method and permitted deductions"),
  long("hours","Working hours, breaks, scheduling and overtime arrangements"),
  long("leaveTerms","Complete validated leave/absence terms or exact accessible schedule"),
  long("benefits","Actual benefits/scheme arrangements or none offered; unresolved obligations must be identified"),
  pick("probation","Is a specifically agreed review/probation provision included?",yesNo),
  long("probationTerms","Separately validated review/probation terms and dates",true,{when:{field:"probation",equals:"yes"}}),
  long("policies","Exact policies/contract schedules and versions incorporated, or none"),
  long("legalChecks","Relevant Nigerian-law scope and any unresolved mandatory employment terms"),
];

export const GUIDED_SPECS_V1:Readonly<Record<GuidedTemplateId,GuidedSpec>>={
  "TPL-01":spec("TPL-01","Invoice",[
    ...header(),date("dueDate","Confirmed invoice payment date"),long("billingBasis","Goods/work supplied and agreed billing basis"),
    ...pricing(),long("paymentInstructions","Issuer-verified payment instructions",false),long("notes","Additional factual notes",false),
  ],[items()],{dateOrder:[{before:"issueDate",after:"dueDate",message:"The confirmed payment date precedes the issue date; correct the dates or billing explanation."}]}),
  "TPL-02":spec("TPL-02","Quotation",[
    ...header(),date("validUntil","Issuer-selected quotation expiry, if offered",false),
    long("scope","Requested goods/work and what is included"),long("exclusions","Actual exclusions/optional extras",false),
    ...pricing(),long("acceptance","Proposed acceptance and delivery arrangements"),long("notes","Additional supplied notes",false),
  ],[items()],{dateOrder:[{before:"issueDate",after:"validUntil",message:"Quotation expiry precedes the issue date."}]}),
  "TPL-03":spec("TPL-03","Receipt",[
    ...header().map(x=>x.id==="recipientName"?{...x,label:"Payer's name"}:x),
    date("paymentDate","Actual payment date"),money("receivedKobo","Amount actually acknowledged, in whole kobo",true,{positive:true}),
    pick("paymentMethod","Recorded payment method",[["cash","Cash"],["transfer","Bank transfer"],["card","Card via another provider"],["other","Other"]]),
    f("paymentReference","Actual payment reference or a clear cash-event description"),
    long("purpose","What the payment was for and any known allocation"),
    f("acknowledgement","I am recording a supplied payment acknowledgement, not independent payment verification","acknowledgement"),
    long("notes","Factual qualifications/discrepancies, if any",false),
  ],[],{notices:[contextNotice,"A receipt is the user's acknowledgement, not bank verification, payment proof or an official tax invoice."]}),
  "TPL-04":spec("TPL-04","Purchase order",[
    ...header().map(x=>x.id==="issuerName"?{...x,label:"Purchasing business legal name"}:
      x.id==="recipientName"?{...x,label:"Supplier legal name"}:x),
    long("deliveryLocation","Agreed delivery or pickup location"),date("deliveryDate","Requested/agreed delivery date"),
    ...pricing(),long("paymentTerms","Agreed payment/acceptance terms"),
    f("authority","Actual purchasing person/role or issuer authority"),
    long("supplierResponse","Actual supplier response/status; do not imply acceptance if not recorded"),
  ],[items()],{dateOrder:[{before:"issueDate",after:"deliveryDate",message:"Delivery date precedes the order date; confirm the intended facts."}]}),
  "TPL-05":spec("TPL-05","Delivery note",[
    ...header(),long("destination","Delivery destination or agreed pickup point"),
    pick("deliveryStatus","Actual delivery status",[["planned","Planned only"],["dispatched","Dispatched"],["received","Received"],["partial","Part received"],["unconfirmed","Not confirmed"]]),
    date("dispatchDate","Actual dispatch date",true,{when:{field:"deliveryStatus",equals:"dispatched"}}),
    date("receivedDate","Actual receipt date",true,{when:{field:"deliveryStatus",equals:"received"}}),
    long("partialDetails","Actual shortfall/damage and event details",true,{when:{field:"deliveryStatus",equals:"partial"}}),
    f("acknowledger","Actual acknowledger name/role, if recorded","text",false),
    long("acknowledgement","Actual recorded acknowledgement, or leave empty",false),
  ],[table("deliveryItems","Items and quantities",[
    f("description","Item description"),f("quantity","Quantity recorded","quantity"),...unitColumns,
    f("condition","Actual condition/status, if recorded","text",false),
  ])],{notices:[contextNotice,"Planned dispatch or receipt is not proof that delivery occurred. No electronic signature is executed."]}),
  "TPL-08":spec("TPL-08","Meeting minutes",[
    f("issuerName","Business/organisation name"),f("meetingTitle","Meeting title and purpose"),date("issueDate","Meeting date"),
    f("location","Actual meeting location/channel"),f("chair","Chair"),f("minuteTaker","Minute taker"),
    pick("meetingType","Kind of meeting",[["staff","Staff"],["management","Management"],["board","Board"],["other","Other"]]),
    long("boardAssumptions","Legal form and actual board/governance authority assumptions",true,{when:{field:"meetingType",equals:"board"}}),
    pick("recordStatus","Status of this record",[["draft","Draft notes"],["circulated","Actually circulated"],["corrected","Corrected version"],["confirmed","Actual recorded confirmation"]]),
    long("confirmation","Actual confirmation details",true,{when:{field:"recordStatus",equals:"confirmed"}}),
    long("nextMeeting","Proposed/agreed next meeting, if any",false),
  ],[table("attendees","Actual attendees",[f("name","Attendee name"),f("role","Role or capacity","text",false)]),
    table("decisions","Discussion and outcomes",[f("topic","Agenda topic"),long("discussion","Factual discussion summary"),
      long("outcome","Actual decision, proposal, deferral or unresolved question")]),
    table("actions","Recorded actions",[f("action","Action"),f("owner","Actual responsible person"),date("dueDate","Confirmed date, if any",false)],0)]),
  "TPL-12":spec("TPL-12","Payment reminder letter",[
    ...header(),date("invoiceIssueDate","Original invoice date"),date("invoiceDueDate","Confirmed invoice due date"),
    date("balanceDate","Date these payment records were checked"),
    long("billingBasis","Original supplied goods/work and invoice reference"),
    money("invoiceAmountKobo","Original invoiced amount in whole kobo"),
    pick("paymentsKnown","Are all allocated payments established?",[["none","Confirmed none recorded"],["listed","Supply the recorded allocations"],["unknown","Unresolved; check first"]]),
    long("dispute","Actual dispute/arrangement or discrepancy, if any",false),
    long("replyContact","Actual reply contact/channel"),
    long("paymentInstructions","Verified payment instructions, if included",false),
  ],[table("payments","Confirmed recorded allocations, not independently verified",
    [f("reference","Allocation reference"),money("amountKobo","Allocated amount in whole kobo")],1,{when:{field:"paymentsKnown",equals:"listed"}})],
  {notices:[contextNotice,"No statutory late charge, due date, payment verification or refund is inferred. Unknown allocation records prevent a complete balance."],
    dateOrder:[{before:"invoiceIssueDate",after:"invoiceDueDate",message:"Invoice due date precedes its issue date."},
      {before:"invoiceIssueDate",after:"balanceDate",message:"Balance-check date precedes the invoice."}]}),
  "TPL-13":spec("TPL-13","Service agreement",[
    ...parties(),...term(),long("scope","Complete agreed service scope and exclusions"),
    ...commercial(),long("changeControl","Change/acceptance process and authorised contacts"),
  ],[table("deliverables","Agreed deliverables",[f("description","Deliverable"),f("acceptance","Acceptance criteria"),f("timing","Agreed timing")])],
  {dateOrder:[{before:"startDate",after:"endDate",message:"The fixed end precedes commencement."}]}),
  "TPL-14":spec("TPL-14","Consultancy agreement",[
    ...parties(),...term(),long("scope","Consultancy scope, methodology and exclusions"),
    long("statusAssumptions","Actual working relationship, authority limits and unresolved classification"),
    ...commercial(),long("dependencies","Client information, access, cooperation and dependencies"),
  ],[table("deliverables","Consultancy outputs",[f("description","Output"),f("acceptance","Review/acceptance criteria"),f("timing","Timing")])],
  {dateOrder:[{before:"startDate",after:"endDate",message:"The fixed end precedes commencement."}]}),
  "TPL-15":spec("TPL-15","Non-disclosure agreement",[
    ...parties(),pick("direction","Disclosure arrangement",[["mutual","Mutual"],["one_way","One-way"]]),
    pick("discloser","Who discloses?",[["first","First party"],["second","Second party"]],{when:{field:"direction",equals:"one_way"}}),
    long("purpose","Narrow permitted discussion/project purpose"),
    date("disclosureStart","Disclosure-period start"),date("disclosureEnd","Disclosure-period end"),
    long("protectedInfo","Information actually covered and marking/oral-disclosure arrangements"),
    long("exclusions","Express exclusions and relevant limits"),
    long("permittedRecipients","Permitted recipients, use and required/compelled disclosure process"),
    long("duration","Agreed confidentiality duration and start event, with no assumed perpetual term"),
    long("returnTerms","Return/deletion arrangements, lawful retention exceptions and feasibility"),
    long("disputeTerms","Agreed escalation/dispute arrangements"),
  ],[],{dateOrder:[{before:"disclosureStart",after:"disclosureEnd",message:"Disclosure end precedes its start."}]}),
  "TPL-16":spec("TPL-16","Employment contract",[
    ...employment(),long("confidentialityTerms","Validated confidentiality/IP and employee-data terms"),
    long("grievanceTerms","Disciplinary/grievance route, contacts and exact policy references"),
    f("termsReviewed","No material employment term is knowingly left unresolved in this draft","acknowledgement"),
  ],[],{dateOrder:[{before:"startDate",after:"endDate",message:"Fixed employment end precedes commencement."}],
    notices:[contextNotice,"No default probation, pay deduction, pension contribution, leave entitlement or dismissal period is supplied. Unresolved material terms require correction."]}),
  "TPL-17":spec("TPL-17","Offer letter",[
    ...employment(),f("contractReference","Employment contract/version and schedules referred to"),
    pick("conditions","Are outstanding offer conditions specified?",[["none","No outstanding conditions recorded"],["listed","Specific conditions below"]]),
    long("conditionDetails","Actual condition, responsible party, evidence and timetable",true,{when:{field:"conditions",equals:"listed"}}),
    date("responseDate","Employer-selected response date, if supplied",false),
    f("responseMethod","Agreed response channel"),
    f("representative","Actual authorised employer representative/contact"),
    long("responseStatus","Actual response, or expressly no response recorded"),
  ],[],{dateOrder:[{before:"startDate",after:"endDate",message:"Fixed employment end precedes commencement."},
    {before:"issueDate",after:"responseDate",message:"Response date precedes the offer date."}],
    notices:[contextNotice,"An offer does not invent acceptance or execution. No signature, employment commencement or legal suitability is confirmed."]}),
};
