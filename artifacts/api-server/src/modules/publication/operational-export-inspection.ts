import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { unzipSync, strFromU8 } from "fflate";
import { candidateDigest, digest, sha256, type PublicationBundle } from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { GUIDANCE_NOTICE, TEMPLATE_NOTICE } from "../../lib/valo-render";
const execFile = promisify(execCallback);
const compact = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const decodeXML = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
/** Actual byte/text/geometry inspection. These are technical export checks,
 * not an assertion that somebody opened Word or certified accessibility.
 *
 * `notice` is the line the renderer prints at the top of every page of the PDF: a template's unless
 * the candidate is a guide. A caller that rendered in another mode names that mode's notice. */
export async function inspectOperationalExports(
  candidate: PublicationBundle["candidate"],
  files: { docx: Buffer; pdf: Buffer },
  notice: string = candidate.contentClass === "sourced_guidance" ? GUIDANCE_NOTICE : TEMPLATE_NOTICE,
) {
  if (candidateDigest(candidate) !== candidate.hash || Buffer.byteLength(candidate.body) > 256 * 1024)
    throw Error("EXPORT_CANDIDATE_BINDING_INVALID");
  const document = documentInput.parse(JSON.parse(candidate.body));
  // A list prints each line as its own item, with a bullet between two of them, so each item is
  // looked for by itself.
  const expected = [
    document.title,
    ...document.content.blocks
      .flatMap((b) => [...(b.type === "list" ? b.text.split("\n") : [b.text]), ...b.rows.flat()])
      .filter((s) => s.trim().length > 0),
  ];
  let docxText = "",
    docxParsed = false,
    docxUnsafe = false;
  if (files.docx.length <= 10 * 1024 * 1024)
    try {
      const archive = unzipSync(files.docx, {
        filter: (entry) => {
          if (/vbaProject|\.exe$|\.js$/i.test(entry.name)) docxUnsafe = true;
          return (
            ["word/document.xml", "word/_rels/document.xml.rels"].includes(entry.name) &&
            entry.originalSize <= 2 * 1024 * 1024
          );
        },
      });
      const xml = archive["word/document.xml"] ? strFromU8(archive["word/document.xml"]) : "";
      const relations = archive["word/_rels/document.xml.rels"]
        ? strFromU8(archive["word/_rels/document.xml.rels"])
        : "";
      docxUnsafe ||= /<!DOCTYPE|<!ENTITY/i.test(xml) || /TargetMode=["']External/i.test(relations);
      docxParsed = /<w:document\b/.test(xml) && /<w:body>/.test(xml) && !docxUnsafe;
      docxText = decodeXML(xml.replace(/<\/w:p>|<\/w:tr>/g, " ").replace(/<[^>]*>/g, ""));
    } catch {
      /* Reader rejection is a failed format result, never a pass. */
    }
  let pdfText = "",
    pdfParsed = false,
    pdfBounds = false,
    pages = 0,
    pageWidth = 0,
    pageHeight = 0,
    rendererFooterLinesIgnored = 0,
    rendererHeaderOccurrencesIgnored = 0;
  if (files.pdf.length <= 10 * 1024 * 1024 && files.pdf.subarray(0, 5).toString() === "%PDF-") {
    const dir = await mkdtemp(join(tmpdir(), "valo-inspect-"));
    try {
      const path = join(dir, "candidate.pdf");
      await writeFile(path, files.pdf);
      const options = { timeout: 10000, maxBuffer: 8 * 1024 * 1024 };
      const info = (await execFile("pdfinfo", [path], options)).stdout;
      pdfText = (await execFile("pdftotext", ["-raw", path, "-"], options)).stdout;
      // A paragraph can cross a page: Poppler inserts our own page-number
      // footer inside its extracted text. Remove only that exact renderer line,
      // never missing source words, notices, business facts or arbitrary text.
      const footer = /^Valo · \d+ \/ \d+(?=[\r\n\f]|$)/gm;
      rendererFooterLinesIgnored = [...pdfText.matchAll(footer)].length;
      pdfText = pdfText.replace(footer, "");
      const withoutHeader = compact(pdfText).split(compact(notice));
      rendererHeaderOccurrencesIgnored = withoutHeader.length - 1;
      pdfText = withoutHeader.join("");
      const bbox = (await execFile("pdftotext", ["-bbox-layout", path, "-"], options)).stdout;
      pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      const geometry = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)"/g)];
      pageWidth = Number(geometry[0]?.[1]);
      pageHeight = Number(geometry[0]?.[2]);
      pdfParsed =
        pages > 0 &&
        pages <= 50 &&
        geometry.length === pages &&
        geometry.every((g) => Math.abs(Number(g[1]) - 595.28) <= 2 && Math.abs(Number(g[2]) - 841.89) <= 2) &&
        !/^Encrypted:\s+yes|^JavaScript:\s+yes/im.test(info);
      const words = [
        ...bbox.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g),
      ];
      pdfBounds =
        words.length > 0 &&
        words.every(
          (w) =>
            Number(w[1]) >= 0 &&
            Number(w[2]) >= 0 &&
            Number(w[3]) <= pageWidth + 2 &&
            Number(w[4]) <= pageHeight + 2,
        );
    } catch {
      /* Invalid/truncated PDFs and reader timeouts stay failed. */
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const textFacts = (text: string, parsed: boolean) => ({
    parsed,
    completeContent: expected.every((s) => compact(text).includes(compact(s))),
    disclosureIncluded: compact(text).includes(compact(candidate.disclosure)),
    scopeIncluded: compact(text).includes(compact(candidate.scope)),
    limitationsIncluded: compact(text).includes(compact(candidate.limitations)),
    sourceDateIncluded: compact(text).includes(compact(candidate.sourceCheckDate)),
    missingTextHashes: expected.filter((s) => !compact(text).includes(compact(s))).map(sha256),
  });
  const formats = { docx: textFacts(docxText, docxParsed), pdf: textFacts(pdfText, pdfParsed) };
  const checks = [
    { name: "docx_reader_and_active_content", passed: docxParsed && !docxUnsafe },
    { name: "pdf_reader_a4_geometry", passed: pdfParsed },
    { name: "pdf_text_within_pages", passed: pdfBounds },
    {
      name: "docx_complete_content_and_disclosures",
      passed: Object.entries(formats.docx).every(([k, v]) => k === "missingTextHashes" || v === true),
    },
    {
      name: "pdf_complete_content_and_disclosures",
      passed: Object.entries(formats.pdf).every(([k, v]) => k === "missingTextHashes" || v === true),
    },
  ];
  return {
    version: "operational-export-inspection-4",
    candidateHash: candidate.hash,
    passed: checks.every((c) => c.passed),
    hashes: { docx: sha256(files.docx), pdf: sha256(files.pdf) },
    formats,
    checks,
    geometry: { pages, width: pageWidth, height: pageHeight, tolerancePoints: 2 },
    readerNormalization: {
      rendererFooterLinesIgnored,
      rendererHeaderOccurrencesIgnored,
      rule: "Only exact renderer-owned template header text and Valo page-number footer lines excluded from content comparison",
    },
    manualWordApplicationReview: false,
    manualAccessibilityReview: false,
  };
}
export async function recheckOperationalExports(
  candidate: PublicationBundle["candidate"],
  files: { docx: Buffer; pdf: Buffer },
  claimed: { version?: string; checks?: unknown; formats?: unknown; hashes?: unknown; passed?: boolean },
) {
  const actual = await inspectOperationalExports(candidate, files);
  if (
    !actual.passed ||
    claimed.passed !== true ||
    claimed.version !== actual.version ||
    digest(claimed.hashes ?? null) !== digest(actual.hashes) ||
    digest(claimed.checks ?? null) !== digest(actual.checks) ||
    digest(claimed.formats ?? null) !== digest(actual.formats)
  )
    throw Error("EXPORT_EXECUTION_ATTESTATION_INVALID");
  return actual;
}
