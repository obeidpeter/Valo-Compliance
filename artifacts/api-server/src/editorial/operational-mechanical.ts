import {candidateDigest,digest,disclosure,mandatoryMechanicalChecks,publicationSchema,sha256,
  type PublicationBundle} from "@workspace/valo-core";
import {documentInput} from "../lib/valo-validation";
type Provenance={hash:string;sourceText:string;note:string;noteHash:string;templateId:string;version:number};
type Rights={applicabilityHash:string;provenanceHash:string;validUntil:string;
  permissions:{url:string;hash:string;quote:string}[]};
type Snapshot={retrievedAt:string;pages:{url:string;text:string;truncated:boolean}[]};

/** Re-executable checks for this narrow blank operational form. No model
 * verdict, check-name list or generic digest stands in for a measured result.
 * Legal claims/rules are NOT supported by this validator. */
export function operationalMechanicalChecks(input:{
  candidate:PublicationBundle["candidate"];policy:PublicationBundle["policy"];
  provenance:Provenance;provenanceArtifactHash:string;rights:Rights;
  applicability:{verified:boolean;hash:string};snapshot:Snapshot;now?:Date;
}):PublicationBundle["mechanicalChecks"]{
  const {candidate:c,policy:p,provenance:v,rights:r,snapshot:s,applicability:a}=input;
  const now=+(input.now??new Date());
  let raw:unknown;try{raw=JSON.parse(c.body);}catch{raw=null;}
  const parsed=documentInput.safeParse(raw);
  const schema=publicationSchema.shape.candidate.safeParse(c);
  const sourceBound=sha256(v.sourceText)===v.hash&&sha256(v.note)===v.noteHash&&
    v.templateId===c.id&&v.version===c.version;
  const originalScope=c.id==="TPL-07"&&c.contentClass==="general_template"&&c.risk==="general"&&
    c.evidenceMode==="original_operational"&&c.legalScopeStatus==="not_applicable"&&c.claims.length===0;
  const scope=originalScope&&p.ownerApproved&&p.developmentOnly===true&&
    Boolean(p.originalOperationalIds?.includes(c.id))&&p.allowedClasses.includes(c.contentClass)&&
    p.jurisdictions.includes(c.jurisdiction)&&p.risks.includes(c.risk);
  const passages=r.permissions.map(e=>{
    const page=s.pages.find(page=>page.url===e.url);
    return {url:e.url,hash:e.hash,found:Boolean(page&&page.truncated===false&&e.quote.trim()&&
      e.url.startsWith("https://")&&sha256(page.text)===e.hash&&page.text.includes(e.quote))};
  });
  const checked=Date.parse(c.sourceCheckDate),expiry=Date.parse(c.reviewBy??"");
  const fetched=Date.parse(s.retrievedAt);
  const dates=Number.isFinite(checked)&&Number.isFinite(expiry)&&Number.isFinite(fetched)&&
    checked<=now&&expiry>now&&expiry>checked&&fetched<=checked&&checked-fetched<=86400000&&
    r.validUntil===c.reviewBy;
  const blankFields=parsed.success&&Object.values(parsed.data.content.fields).every(value=>value==="");
  const text=parsed.success?parsed.data.content.blocks.map(b=>b.text).join("\n"):"";
  // Integer-scaled quantities, including a negative balance and values beyond
  // JS's safe integer limit. These are operational controls, NOT legal fixtures.
  const fixtures=[
    {previous:"1000",received:"250",issued:"500",adjustment:"-100",expected:"650"},
    {previous:"0",received:"0",issued:"1",adjustment:"0",expected:"-1"},
    {previous:"9007199254740993",received:"1",issued:"0",adjustment:"0",expected:"9007199254740994"},
  ].map(f=>({...f,actual:(BigInt(f.previous)+BigInt(f.received)-BigInt(f.issued)+BigInt(f.adjustment)).toString()}));
  const facts={
    schema:{pass:schema.success&&parsed.success&&candidateDigest(c)===c.hash&&digest(parsed.data)===digest(raw),
      documentParsed:parsed.success,canonicalHash:c.hash},
    source_locators:{pass:sourceBound&&passages.length>0&&passages.every(e=>e.found),sourceBound,passages},
    dates:{pass:dates,checked:c.sourceCheckDate,reviewBy:c.reviewBy,providerFetchedAt:s.retrievedAt},
    scope:{pass:scope,template:c.id,policy:p.version,originalScope},
    numeric_extraction:{pass:originalScope&&blankFields,legalClaimCount:c.claims.length,blankBusinessFields:blankFields,
      applicability:"No regulatory numbers or claims; user facts must remain blank in this reusable master"},
    rights:{pass:a.verified&&r.applicabilityHash===a.hash&&r.provenanceHash===input.provenanceArtifactHash,
      providerPermissionVerified:a.verified,applicabilityHash:a.hash,provenanceArtifactHash:input.provenanceArtifactHash},
    required_fields:{pass:blankFields&&parsed.success&&parsed.data.title==="Inventory register"&&
      parsed.data.content.blocks.length>=5&&text.includes("Scope:")&&text.includes("Limitations:"),
      blankReusableMaster:blankFields,blockCount:parsed.success?parsed.data.content.blocks.length:0},
    disclosures:{pass:c.disclosure===disclosure&&text.includes(disclosure)&&
      text.includes(c.sourceCheckDate)&&text.includes("two separate automated AI checks")&&
      text.includes("not legal or regulatory verification"),requiredNotice:disclosure},
    arithmetic:{pass:fixtures.every(f=>f.actual===f.expected),fixtures},
    rule_fixtures:{pass:originalScope,legalClaimCount:c.claims.length,legalScopeStatus:c.legalScopeStatus,
      applicability:"No legal rules in this original operational master; this does not pass RUL-008"},
  };
  return mandatoryMechanicalChecks.map(name=>({name,candidateHash:c.hash,
    result:facts[name].pass?"pass":"fail",evidenceHash:digest({validator:"operational-mechanical-1",name,...facts[name]})}));
}
