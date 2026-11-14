import {createHash} from "node:crypto";
import {referenceFor} from "./source-fetch";

export const businessNameSourceIds=["SV-010","CAC-BN-PROCESS","NIPC-BFA-2022","NCC-COPYRIGHT"] as const;
type SourceId=typeof businessNameSourceIds[number];
export type CapturedText={id:string;sourceId:SourceId;text:string;textChecksum:string;fetchedAt:string};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const norm=(s:string)=>s.replace(/\s+/g," ").trim();
function requireText(condition:unknown,code:string):asserts condition{
  if(!condition)throw Error(code);
}
function pdfPages(source:CapturedText,from:number,to:number,printedFrom:number,printedTo:number){
  const pages=source.text.split("\f").slice(from-1,to);
  requireText(pages.length===to-from+1&&new RegExp(`\\bA\\s*${printedFrom}\\b`).test(pages[0]!)&&
    new RegExp(`\\bA\\s*${printedTo}\\b`).test(pages.at(-1)!),"PRINTED_PDF_LOCATION_MISMATCH");
  return pages.join("\f");
}
function section(text:string,n:number,next:number){
  const start=text.search(new RegExp(`\\b${n}\\.\\s*[—–-]\\s*\\(1\\)`));
  const end=text.search(new RegExp(`\\b${next}\\.\\s*[—–-]\\s*\\(1\\)`));
  requireText(start>=0&&end>start,"SECTION_BOUNDARY_MISSING");
  // Exclude marginal text on the next section's line as well as its body.
  return text.slice(start,text.lastIndexOf("\n",end)).trimEnd();
}
export function validateBusinessNamePassages(p:{cama814:string;cama20:string;bfaPartI:string;copyright3b:string;process:string}){
  const text=norm(p.cama814);
  const [conditions,exceptions]=text.split(/\(2\)\s+Notwithstanding subsection \(1\)/);
  requireText(conditions&&exceptions,"CAMA814_SUBSECTIONS_REQUIRED");
  // The printed marginal title intervenes between these lines; retain original quote bytes.
  requireText(/having a place of business/i.test(conditions)&&
    /in Nigeria and carrying on business under a business name/i.test(conditions),
    "CAMA814_NIGERIA_BUSINESS_SCOPE_MISSING");
  for(const pattern of [/true surname of all partners/i,/case of an individual/i,/corporate name without any addition/i])
    requireText(pattern.test(conditions),"CAMA814_NAME_COMPOSITION_MISSING");
  for(const pattern of [/succession to a former owner/i,/addition of an [“"]s[”"] at the end/i,
    /receiver or manager appointed by any court/i])
    requireText(pattern.test(exceptions),"CAMA814_EXCEPTION_MISSING");
  requireText(/addition merely indicates/i.test(exceptions)&&
    /two or more individual partners have the same surname/i.test(exceptions)&&
    /shall not of itself render registration necessary/i.test(exceptions),"CAMA814_EXCEPTION_CONDITION_MISSING");
  requireText(!/\b815\b|28 days|within \d+ days/i.test(text),"OUT_OF_SCOPE_DEADLINE");
  requireText(/sections 281 and 283/i.test(norm(p.cama20)),"CAMA20_DEPENDENCY_MISSING");
  requireText(/Amendment of section 283/i.test(norm(p.bfaPartI))&&
    /person removed under section 288/i.test(norm(p.bfaPartI)),"BFA283_AMENDMENT_MISSING");
  requireText(/official texts of a legislative or administrative nature/i.test(norm(p.copyright3b))&&
    /except their compilations/i.test(norm(p.copyright3b)),"STATUTORY_RIGHTS_EXCEPTION_MISSING");
  requireText(/Check for availability/i.test(p.process)&&/Complete pre-registration form/i.test(p.process)&&
    /Individual\/Proprietors can register business names without/i.test(p.process),"CAC_PROCESS_PASSAGE_MISSING");
  return true;
}
export function buildBusinessNameEvidence(inputs:CapturedText[],now=new Date()){
  const sources=new Map(inputs.map(s=>[s.sourceId,s]));
  requireText(inputs.length===4&&sources.size===4,"EXACT_SOURCE_SET_REQUIRED");
  for(const id of businessNameSourceIds){
    const s=sources.get(id);
    requireText(s&&s.textChecksum===hash(s.text),"SOURCE_HASH_MISMATCH");
    requireText(Number.isFinite(Date.parse(s.fetchedAt))&&Date.parse(s.fetchedAt)<=now.getTime()&&
      now.getTime()-Date.parse(s.fetchedAt)<=30*86400000,"SOURCE_RETRIEVAL_STALE");
  }
  const cama=sources.get("SV-010")!,bfa=sources.get("NIPC-BFA-2022")!,
    rights=sources.get("NCC-COPYRIGHT")!,process=sources.get("CAC-BN-PROCESS")!;
  const cama814=section(pdfPages(cama,405,406,405,406),814,815);
  const cama20=section(cama.text,20,21);
  const bfaPages=pdfPages(bfa,9,13,103,107);
  const partStart=bfaPages.indexOf("PART I"),partEnd=bfaPages.indexOf("PART II");
  requireText(partStart>=0&&partEnd>partStart,"BFA_PART_BOUNDARY_MISSING");
  const copyrightPage=pdfPages(rights,8,8,184,184);
  const rightsStart=copyrightPage.indexOf("(b) official texts");
  const rightsEnd=copyrightPage.indexOf("(c)",rightsStart);
  requireText(rightsStart>=0&&rightsEnd>rightsStart,"COPYRIGHT3B_BOUNDARY_MISSING");
  const processStart=process.text.indexOf("Registration steps for Business Names");
  const processEnd=process.text.indexOf("Ready to Register?",processStart);
  requireText(processStart>=0&&processEnd>processStart,"CAC_PROCESS_BOUNDARY_MISSING");
  const passages={cama814,cama20,bfaPartI:bfaPages.slice(partStart,partEnd).trimEnd(),
    copyright3b:copyrightPage.slice(rightsStart,rightsEnd).trimEnd(),
    process:process.text.slice(processStart,processEnd).trimEnd()};
  validateBusinessNamePassages(passages);
  const references=inputs.map(s=>({snapshotId:s.id,sourceId:s.sourceId,url:referenceFor(s.sourceId).url,
    fetchedAt:s.fetchedAt,textChecksum:s.textChecksum}));
  const body={candidateId:"CAC-BUSINESS-NAME-814",version:1,
    scope:"Business-name registration conditionality under section 814 only",
    excluded:["Section 815 deadlines","Company formation capacity","Tax or other SME duties",
      "Guarantees of registration or universal exemption"],
    references,
    passages:Object.entries(passages).map(([id,text])=>({id,text,hash:hash(text)})),
    locators:{cama814:"CAMA814(1) and814(2); printed A405–A406; PDF405–406",
      cama20:`CAMA20; starts PDF${cama.text.slice(0,cama.text.indexOf(cama20)).split("\f").length}; dependency context only`,
      bfaPartI:"Schedule Part I; printed A103–A107; PDF9–13; amendment to CAMA283",
      copyright3b:"Copyright Act3(b); printed A184; PDF8",
      process:"CAC business-name service: registration steps and individual/proprietor self-registration"},
    amendmentReview:{reviewedInstrument:"NIPC-BFA-2022",partIContains814:/\b814\b/.test(passages.bfaPartI),
      formationDependency:"CAMA20 cross-refers to283, amended in BFA Part I; formation capacity excluded from this candidate",
      currentness:"unverified",note:"Review of one amendment instrument is not proof no later amendment or controlling judgment exists."},
    rightsEvidence:{source:"NCC-COPYRIGHT",section:"3(b)",scope:"Official statutory passages only",
      excludes:["Compilations","Website design or copy","Third-party commentary","AI provider output or account terms"],
      status:"scoped_passage_evidence_not_final_rights_clearance"},
    requiredFacts:["placeOfBusinessInNigeria","carryingOnBusinessUnderName","individualFirmOrCorporation",
      "nameComposition","successionOnlyAddition","sharedSurnamePluralOnlyAddition","courtAppointedReceiverOrManager"],
    missingFactBehavior:"Unknown, unanswered and not-applicable are distinct; missing facts never establish an exemption",
    negativeResultScope:"A negative result concerns this candidate only, never all registrations or SME obligations",
    checks:{passages:"pass",independentFactualReview:"not_run",independentChallenge:"not_run",
      amendmentCurrentness:"unverified",rightsAssessment:"unverified",releaseManifest:"absent"},
    publication:"held",customerUseEligible:false};
  return {...body,bundleHash:hash(JSON.stringify(body))};
}
