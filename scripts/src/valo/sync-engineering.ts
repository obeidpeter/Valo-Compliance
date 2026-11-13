import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../",import.meta.url);
const sourcePath = "docs/specification/VALO-TRD-001-v1.1.txt";
const source = await readFile(new URL(sourcePath,root),"utf8");
const headings = [...source.matchAll(/^(\d{2}) \/ ([^\r\n]+)$/gm)];
const selected = [15,16,17,18,19,24,25];
const sections = selected.map(number=>{
  const index = headings.findIndex(match=>Number(match[1])===number);
  if(index<0)throw new Error("Missing original engineering section "+number);
  const heading = headings[index]!;
  const start = heading.index!;
  const end = headings[index+1]?.index ?? source.length;
  const exactContract = source.slice(start,end).trim();
  return {id:`CTX-${number}`,title:heading[2],sourcePath,
    sourceStartLine:source.slice(0,start).split("\n").length,
    sourceEndLine:source.slice(0,end).split("\n").length-1,
    exactContract,status:"specification_recorded_not_accepted",
    sha256:createHash("sha256").update(exactContract).digest("hex")};
});
const conflicts = JSON.parse(await readFile(new URL("docs/registers/conflicts-and-assumptions.json",root),"utf8"));
const register = {
  sourcePath,sourceSha256:createHash("sha256").update(source).digest("hex"),sections,
  note:"Engineering context supplements the existing 127 formal IDs. Exact excerpts are not implementation, live regulatory evidence or owner approval.",
  ownerDecisions:conflicts.owner_decisions.map((decision:object)=>({...decision,status:"no_gate_approval_recorded"})),
};
await writeFile(new URL("docs/registers/engineering-context.json",root),JSON.stringify(register,null,2)+"\n");
console.log("Retained seven exact engineering/operations context sections and D01–D07; no gate or sensitive approval accepted.");
