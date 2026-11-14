import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { BusinessNameCandidateBinding } from "@workspace/valo-core/checker-business-name";
import { remainingSourceCandidateIds } from "@workspace/valo-core/checker-source-candidates";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
function requireEvidence(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
const prefix = "docs/content-candidates/source-evidence/";
export function bindRemainingSourceCandidates(now = new Date(),
  read: (path: string) => Buffer = path => readFileSync(join(root, path))) {
  const fileHashes: Record<string, string> = {};
  const readText = (path: string) => {
    const bytes = read(path); fileHashes[path] = sha(bytes); return bytes.toString("utf8");
  };
  const algorithmPath = "lib/valo-core/src/checker-source-candidates.ts";
  const algorithmHash = sha(readText(algorithmPath));
  const corpusHash = sha(readText("docs/evaluation-candidates/checker.json"));
  const results: Record<string, { binding: BusinessNameCandidateBinding; provenance: unknown }> = {};
  const fresh = (at: string, id: string) => {
    const time = Date.parse(at);
    requireEvidence(Number.isFinite(time) && time <= now.getTime() &&
      now.getTime() - time <= 30 * 86_400_000, `Stale/future retained source: ${id}`);
  };
  const add = (id: string, sources: Record<string, string>, passages: unknown[], extra: Record<string, unknown>) => {
    requireEvidence(Object.keys(sources).length && Object.values(sources).every(h => /^[a-f0-9]{64}$/u.test(h)),
      `Source version hashes required: ${id}`);
    const provenance = { mode: "isolated_candidate_validation" as const,
      candidateVersion: `source-family-v1:${algorithmHash}`, sourceVersionHashes: sources,
      supportedAssessmentDates: ["2026-11-13", "2026-11-14"], candidateId: id, corpusHash,
      passages, fileHashes: { ...fileHashes }, publicationApproval: false,
      independentExpectedOutcomeChallenge: "not_executed_by_this_runner", ...extra };
    const binding = { ...provenance, bindingHash: sha(JSON.stringify(provenance)) };
    results[id] = { binding, provenance };
  };

  const privacyPath = prefix + "ndpa-captured-passages.json";
  const privacy = JSON.parse(readText(privacyPath)) as {
    capturedAt: string; rawPdfHash: string; rawPdfBytes: number; pdfPages: number;
    retrievedFrom: string; passages: { id: string; locator: string; exactText: string; hash: string }[];
  };
  const research = JSON.parse(readText("docs/content-candidates/privacy-source-research.json")) as {
    sources: { id: string; sha256: string }[];
  };
  const officialHash = research.sources.find(s => s.id === "ndpc_act_2023")?.sha256;
  requireEvidence(privacy.rawPdfHash === officialHash && privacy.pdfPages === 43 && privacy.rawPdfBytes > 0 &&
    privacy.retrievedFrom === "https://www.ncc.gov.ng/media/1084/view",
  "Retained privacy capture does not match the official NDPC/NCC source binding");
  fresh(privacy.capturedAt, "NDPA-2023");
  for (const id of ["NDPA-2-3", "NDPA-27"]) {
    const p = privacy.passages.find(p => p.id === id);
    requireEvidence(p && p.locator && sha(p.exactText) === p.hash, `Altered/missing privacy passage ${id}`);
  }
  add(remainingSourceCandidateIds[0], { "NDPA-2023": privacy.rawPdfHash },
    privacy.passages.map(({ exactText: _text, ...p }) => p),
    { retainedPassageBytesReverifiedThisRun: true, rawPdfBytesReverifiedThisRun: false,
      rawPdfVerificationCapture: privacyPath });

  const taxPath = prefix + "registration-tax-passages.json";
  const tax = JSON.parse(readText(taxPath)) as {
    sources: Record<string, { rawSHA256: string }>;
    passages: { passageID: string; sourceID: string; locator: string;
      exactExtractedText: string; textSHA256: string }[];
  };
  const taxRetrieval = JSON.parse(readText(prefix + "registration-tax-retrieval.json")) as {
    rawSHA256: string; httpStatus: number; retrievedAt: string;
  }[];
  const taxHashes: Record<string, string> = {};
  for (const id of ["NASS-NTAA-2025", "NRS-NTAA-2025"]) {
    const hash = tax.sources[id]?.rawSHA256;
    const retained = taxRetrieval.find(r => r.rawSHA256 === hash);
    requireEvidence(hash && retained?.httpStatus === 200, `Missing actual tax-source retrieval ${id}`);
    fresh(retained.retrievedAt, id); taxHashes[id] = hash;
  }
  const taxPassages = ["NTAA-11", "NTAA-147-DEFINITIONS"].map(id => {
    const p = tax.passages.find(p => p.passageID === id);
    requireEvidence(p && p.sourceID === "NASS-NTAA-2025" && p.locator &&
      sha(p.exactExtractedText) === p.textSHA256, `Altered/missing tax passage ${id}`);
    return { id, sourceId: p.sourceID, locator: p.locator, hash: p.textSHA256 };
  });
  add(remainingSourceCandidateIds[1], taxHashes, taxPassages,
    { retainedPassageBytesReverifiedThisRun: true, rawPdfBytesReverifiedThisRun: false,
      unresolvedPrintedCommencementDiscrepancy: true,
      smallCompanyThresholdInterpretationIncluded: false });

  const product = JSON.parse(readText(prefix + "nafdac_cap_f33_retrieval.json")) as {
    rawSHA256: string; textSHA256: string; retrievedAt: string; httpStatus: number; pdfPages: number;
    pageTextFiles: { pdfPage: number; textSHA256: string }[];
  };
  const raw = read(prefix + "nafdac_cap_f33.pdf");
  fileHashes[prefix + "nafdac_cap_f33.pdf"] = sha(raw);
  requireEvidence(product.httpStatus === 200 && product.pdfPages === 8 && sha(raw) === product.rawSHA256 &&
    sha(readText(prefix + "nafdac_cap_f33.txt")) === product.textSHA256,
  "Actual NAFDAC PDF/full-text hashes do not match the retained retrieval");
  fresh(product.retrievedAt, "NAFDAC-CAP-F33");
  const productPassages = [2, 7].map(page => {
    const text = readText(prefix + `nafdac_cap_f33_page_${String(page).padStart(2, "0")}.txt`);
    const expected = product.pageTextFiles.find(p => p.pdfPage === page)?.textSHA256;
    requireEvidence(sha(text) === expected, `Altered NAFDAC source page ${page}`);
    return { id: `NAFDAC-F33-PAGE-${page}`, locator: `Cap F33 PDF page ${page}`, hash: sha(text) };
  });
  add(remainingSourceCandidateIds[2], { "NAFDAC-CAP-F33": product.rawSHA256 }, productPassages,
    { retainedPassageBytesReverifiedThisRun: true, rawPdfBytesReverifiedThisRun: true,
      scope: "National product-registration relevance; manufacturing-route uncertainty is separate" });
  return results;
}
