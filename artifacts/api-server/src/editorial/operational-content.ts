import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest,sha256,disclosure } from "@workspace/valo-core";
import { documentInput } from "../lib/valo-validation";
import { publicationWorkspaceRoot } from "./operational-policy";
import type { ArtifactRef } from "./publication-artifacts";
import {originalSections,operationalDocument} from "./original-content-adapter";
export type OperationalProvenance={path:string;hash:string;sourceText:string;note:string;noteHash:string;
  authoringRoute:string;transformation:string;templateId:string;version:number;generation?:ArtifactRef};
export async function inventoryCandidate(version:number,now=new Date(),recorded?:{original:string;provenance:OperationalProvenance}){
  const path="docs/content-candidates/operational-template-candidates.md";
  const workspaceRoot=publicationWorkspaceRoot();
  const full=await readFile(resolve(workspaceRoot,path),"utf8");
  const provenance=await readFile(resolve(workspaceRoot,"docs/content-candidates/chatgpt-content-provenance-rights.md"),"utf8");
  if(!provenance.includes(sha256(full)))throw Error("AUTHORING_PROVENANCE_HASH_MISMATCH");
  const original=recorded?.original??full.split("## TPL-07 — Inventory register\n")[1]?.split("\n## TPL-09")[0]?.replace(/\n---\s*$/,"").trim();
  if(!original||!provenance.includes("authored in this ChatGPT conversation"))throw Error("AUTHORING_PROVENANCE_MISSING");
  const scope="Original stock-movement and physical-count record for user-entered business information. Optional operational practice; no legal applicability determination.";
  const limitations="Blank Word/PDF operational aid, not a spreadsheet or accounting system. No ownership, product approval, valuation, statutory duty, tax-rate or legal-validity assurance. No professional review. Synthetic development evaluation only; commercial licence terms are not accepted and sales are disabled.";
  const reviewedAt=now.toISOString(),reviewBy=new Date(+now+90*86400000).toISOString();
   const section=originalSections(`## TPL-07 — Inventory register\n${original}`)[0];
   if(!section)throw Error("OPERATIONAL_CONTENT_SECTION_MISSING");
   const blocks=operationalDocument(section).content.blocks;
  const document=documentInput.parse({title:"Inventory register",content:{
    fields:{issuerName:"",recipientName:"",documentNumber:"",issueDate:"",dueDate:"",notes:""},
    blocks:[{id:"optional-instructions",type:"paragraph",text:"Optional internal working instructions: all suggestions below are stock-recording practices to adapt to your actual workflow, not legal duties or regulatory advice. Enter your own business facts and quantities; blank fields are not verified information.",rows:[]},...blocks,
      {id:"release-scope",type:"paragraph",text:`Scope: ${scope}`,rows:[]},
       {id:"release-limitations",type:"paragraph",text:"Limitations: an internal stock-recording aid, not a spreadsheet, accounting system, product approval, valuation or legal-validity assurance.",rows:[]},
      {id:"release-disclosure",type:"paragraph",text:disclosure,rows:[]},
      {id:"release-source-date",type:"paragraph",text:`Source/provenance checked: ${reviewedAt}. Provider-source and authoring records are retained; this is not an independent legal or regulatory verification.`,rows:[]},
    ],selectedClauses:[],formatting:{font:"sans",accent:"forest"},
  }});
  return{document,scope,limitations,reviewBy,reviewedAt,original,
    provenance:recorded?.provenance??{path,hash:sha256(full),sourceText:full,note:provenance,noteHash:sha256(provenance),
      authoringRoute:"Original ChatGPT prose supplied by coordinator; upstream model and execution ID not established",
      transformation:"Deterministic Markdown-to-canonical-Word/PDF adaptation with original Valo optional-use framing and disclosures; upstream authorship attributed, not independently verified",templateId:"TPL-07",version},
    documentDigest:digest(document)};
}
