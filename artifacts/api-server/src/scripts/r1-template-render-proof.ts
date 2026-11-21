/** Actual local rendering of supplied candidates, not content publication,
 * background-queue, Microsoft Word UI or legal-accuracy acceptance. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256, digest } from "@workspace/valo-core";
import {
  readTemplateIntake,
  publicationWorkspaceRoot,
  developmentPublicationOnly,
} from "../modules/publication";
import { renderDocument, TEMPLATE_NOTICE } from "../lib/valo-render";
const exec = promisify(execFile),
  normal = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const xmlText = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
async function main() {
  developmentPublicationOnly();
  const directory = resolve(
    publicationWorkspaceRoot(),
    "generated-artifacts/valo-completion/template-samples",
  );
  await mkdir(directory, { recursive: true });
  const results = [];
  // Two local render pipelines, no provider calls, no public/private customer
  // master release and no bypass of the durable customer-export queue.
  for (let start = 1; start <= 40; start += 2) {
    results.push(
      ...(await Promise.all(
        [start, start + 1].map(async (n) => {
          const started = performance.now(),
            id = `TPL-${String(n).padStart(2, "0")}`;
          const intake = await readTemplateIntake(id);
          const document = {
            ...intake.document,
            content: {
              ...intake.document.content,
              blocks: [
                {
                  id: "authoring-draft-notice",
                  type: "paragraph" as const,
                  text: "Unpublished authoring candidate. No independent AI review or publication is claimed. Not available for customer use. Resolve required facts and applicable legal scope before release.",
                  rows: [],
                },
                ...intake.document.content.blocks,
              ],
            },
          };
          const docx = await renderDocument(document, "docx", 1, "template_sample");
          const pdf = await renderDocument(document, "pdf", 1, "template_sample");
          const path = resolve(directory, id);
          await writeFile(path + ".docx", docx);
          await writeFile(path + ".pdf", pdf);
          const [{ stdout: xml }, { stdout: text }, { stdout: raw }, { stdout: bbox }, { stdout: info }] =
            await Promise.all([
              exec("unzip", ["-p", path + ".docx", "word/document.xml"], { maxBuffer: 2_000_000 }),
              exec("pdftotext", ["-layout", path + ".pdf", "-"], { maxBuffer: 2_000_000 }),
              exec("pdftotext", ["-raw", path + ".pdf", "-"], { maxBuffer: 2_000_000 }),
              exec("pdftotext", ["-bbox", path + ".pdf", "-"], { maxBuffer: 3_000_000 }),
              exec("pdfinfo", [path + ".pdf"], { maxBuffer: 20000 }),
            ]);
          // Layout extraction interleaves wrapped neighbouring cells; raw content
          // order preserves cell text. Both read the SAME bytes. Remove only our
          // exact normalised running matter, which can interrupt page-spanning text.
          const clean = (s: string) =>
            normal(s.replace(/^Valo · \d+ \/ \d+(?=[\r\n\f]|$)/gm, ""))
              .split(normal(TEMPLATE_NOTICE))
              .join("");
          const readings = [clean(text), clean(raw)];
          const segments = document.content.blocks
            .flatMap((b) => (b.type === "table" ? b.rows.flat() : [b.text]))
            .filter((t) => t.trim());
          const missingPDF = segments.filter((s) => !readings.some((t) => t.includes(normal(s))));
          const missingDOCX = segments.filter((s) => !normal(xmlText(xml)).includes(normal(s)));
          const geometry = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/),
            pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
          const a4 =
            !!geometry &&
            Math.abs(Number(geometry[1]) - 595.28) <= 2 &&
            Math.abs(Number(geometry[2]) - 841.89) <= 2;
          const words = [
            ...bbox.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g),
          ];
          const wordBounds =
            words.length > 0 &&
            !!geometry &&
            words.every(
              (w) =>
                Number(w[1]) >= -1 &&
                Number(w[2]) >= -1 &&
                Number(w[3]) <= Number(geometry[1]) + 1 &&
                Number(w[4]) <= Number(geometry[2]) + 1,
            );
          const result = {
            id,
            title: intake.section.title,
            sourcePath: intake.sourcePath,
            sourceHash: intake.sourceHash,
            canonicalHash: digest(document),
            docxHash: sha256(docx),
            pdfHash: sha256(pdf),
            docxBytes: docx.length,
            pdfBytes: pdf.length,
            pages,
            a4,
            wordBounds,
            readerModes: ["layout", "raw"],
            readerOutputHashes: [sha256(text), sha256(raw)],
            segments: segments.length,
            missingPDF: missingPDF.map((s) => ({ hash: sha256(s), prefix: s.slice(0, 90) })),
            missingDOCX: missingDOCX.map((s) => ({ hash: sha256(s), prefix: s.slice(0, 90) })),
            passed: pages > 0 && a4 && wordBounds && missingPDF.length === 0 && missingDOCX.length === 0,
            elapsedMs: Math.round(performance.now() - started),
            publicationStatus: "unpublished_candidate",
            independentReviews: 0,
          };
          console.log(
            JSON.stringify({
              id,
              passed: result.passed,
              pages,
              pdfOmissions: missingPDF.length,
              docxOmissions: missingDOCX.length,
            }),
          );
          return result;
        }),
      )),
    );
  }
  const report = {
    executedAt: new Date().toISOString(),
    scope: "Actual draft render and reader extraction only",
    results,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    providerCalls: 0,
    publishedTemplates: 0,
    professionalReviewClaimed: false,
    r1Accepted: false,
    r2Unlocked: false,
  };
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (report.passed !== 40) process.exitCode = 1;
}
main().catch(() => {
  console.error("R1_DRAFT_RENDER_PROOF_FAILED");
  process.exitCode = 1;
});
