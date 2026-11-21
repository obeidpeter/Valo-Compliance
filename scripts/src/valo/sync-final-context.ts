import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../", import.meta.url);
const trdPath = "docs/specification/VALO-TRD-001-v1.1.txt";
const roadmapPath = "docs/specification/VALO-ROADMAP-001-v1.1.txt";
const trd = await readFile(new URL(trdPath, root), "utf8");
const roadmap = await readFile(new URL(roadmapPath, root), "utf8");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function sections(source: string, path: string, numbers: number[]) {
  const headings = [...source.matchAll(/^(\d{2}) \/ ([^\r\n]+)$/gm)];
  return numbers.map((n) => {
    const i = headings.findIndex((h) => Number(h[1]) === n);
    if (i < 0) throw Error("Missing source section " + n);
    const h = headings[i]!,
      start = h.index!,
      end = headings[i + 1]?.index ?? source.length;
    const exactContract = source.slice(start, end).trim();
    return {
      id: `ROADMAP-${h[1]}`,
      title: h[2],
      sourcePath: path,
      exactContract,
      sha256: hash(exactContract),
      sourceStartLine: source.slice(0, start).split("\n").length,
      status: "planning_assumption_not_accepted",
    };
  });
}
const references = [
  ...trd.matchAll(
    /^S(\d{2})  ([^\n]+)\n(https:\/\/[^\n]+)\n([\s\S]*?)(?=\nS\d{2}  |\nREFERENCE REGISTER|\nSource citations|\nResearch boundary|$)/gm,
  ),
].map((m) => ({
  id: `S${m[1]}`,
  title: m[2]!,
  url: m[3]!,
  baselineNotes: m[4]!.trim(),
  category: Number(m[1]) <= 9 ? "regulatory" : Number(m[1]) <= 17 ? "platform" : "quality",
  sourceLocator: `${trdPath}:L${trd.slice(0, m.index!).split("\n").length}`,
  exactBaseline: m[0].trim(),
  baselineSha256: hash(m[0].trim()),
}));
if (references.length !== 24 || new Set(references.map((r) => r.id)).size !== 24)
  throw Error("Expected 24 unique references");
const retentionBlock = trd.split("DATA CLASS | PROPOSED RETENTION / DELETION RULE\n")[1]?.split("\n\n")[0];
if (!retentionBlock) throw Error("Missing retention contract");
const retentionProposals = retentionBlock.split("\n").map((line, i) => {
  const split = line.indexOf(" | ");
  if (split < 0) throw Error("Invalid retention row");
  return {
    id: `RET-P${String(i + 1).padStart(2, "0")}`,
    dataClass: line.slice(0, split),
    exactProposal: line.slice(split + 3),
    status: "proposal_requires_G0_approval",
    statutoryPeriod: false,
    approved: false,
    enforced: false,
  };
});
if (retentionProposals.length !== 7) throw Error("Expected seven retention proposals");
const register = {
  sourceHashes: { [trdPath]: hash(trd), [roadmapPath]: hash(roadmap) },
  roadmapSections: sections(roadmap, roadmapPath, [2, 3, 4, 5]),
  references,
  retentionProposals,
  interpretation:
    "Dates, staffing, weeks and budgets are assumptions, not commitments. R1 precedes gated R2; R3 is excluded. Retrieval is not source/rights/AI approval. No retention duration is enacted by this intake.",
  approvals: { productLaunch: false, livePayments: false, liveCustomerData: false, retentionSchedule: false },
};
await writeFile(
  new URL("docs/registers/final-source-context.json", root),
  JSON.stringify(register, null, 2) + "\n",
);
await writeFile(
  new URL("lib/valo-core/src/reference-leads.generated.ts", root),
  "// Generated from retained original TRD/roadmap by sync-final-context.ts. Discovery only.\nexport const finalSourceContext = " +
    JSON.stringify(register, null, 2) +
    " as const;\n",
);
console.log(
  "Retained four exact roadmap sections, seven unapproved retention proposals and all 24 original reference leads.",
);
