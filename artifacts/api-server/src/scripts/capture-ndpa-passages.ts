import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const pdfPath = "generated-artifacts/valo-completion/ndpa-ncc-2023.pdf";
const textPath = "generated-artifacts/valo-completion/ndpa-ncc-2023.txt";
const raw = readFileSync(join(root, pdfPath));
const text = readFileSync(join(root, textPath), "utf8");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const research = JSON.parse(readFileSync(join(root, "docs/content-candidates/privacy-source-research.json"), "utf8"));
const original = research.sources.find((s: { id: string }) => s.id === "ndpc_act_2023");
if (sha(raw) !== original.sha256) throw new Error("Retrieved official-mirror PDF differs from the retained NDPC raw hash");
const pages = text.split("\f");
if (!pages.at(-1)?.trim()) pages.pop();
if (pages.length !== 43 || !/Nigeria Data Protection Act, 2023/u.test(pages[6]!) ||
    !/\bA\s+723\b/u.test(pages[6]!) || !/\bA\s+735\b/u.test(pages[18]!))
  throw new Error("Full Act identity/page locators do not match");
const capture = {
  status: "retained_authoritative_source_not_publication",
  capturedAt: new Date().toISOString(),
  sourceId: "NDPA-2023",
  officialOriginalUrl: original.url,
  retrievedFrom: "https://www.ncc.gov.ng/media/1084/view",
  originalRouteObservation: "Direct NDPC fetch returned HTTP 403 in this run.",
  retrievalObservation: "Official NCC body fetched successfully with curl --fail; exact successful HTTP status was not separately retained.",
  downloadedFileModifiedAt: statSync(join(root, pdfPath)).mtime.toISOString(),
  rawPdfHash: sha(raw), rawPdfBytes: raw.length, pdfPages: pages.length,
  fullTextHash: sha(text),
  originalResearchTextHash: original.extracted_text_sha256,
  extraction: "pdftotext -layout",
  rawPdfWorkspacePath: pdfPath,
  sourceBytesMatchOriginalOfficialNdpcResearch: true,
  publicationApproval: false,
  passages: [
    { id: "NDPA-2-3", locator: "Sections 2–3; PDF pages 7–8 / Gazette A723–A724",
      pages: [7, 8] },
    { id: "NDPA-27", locator: "Section 27(1)–(3); PDF pages 18–19 / Gazette A734–A735",
      pages: [18, 19] },
  ].map(p => {
    const exactText = p.pages.map(n => pages[n - 1]!).join("\f");
    return { ...p, exactText, hash: sha(exactText) };
  }),
};
const output = "docs/content-candidates/source-evidence/ndpa-captured-passages.json";
writeFileSync(join(root, output), JSON.stringify(capture, null, 2) + "\n");
console.log(JSON.stringify({ output, rawPdfHash: capture.rawPdfHash, pdfPages: capture.pdfPages,
  retainedPassages: capture.passages.length, publicationApproval: false }));
