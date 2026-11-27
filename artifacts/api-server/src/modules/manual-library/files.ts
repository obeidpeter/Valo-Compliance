import { execFile } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { ValoProblem } from "../../platform/valo-problem";

export const fileLimit = 2 * 1024 * 1024;
export type EditorialFile = { format: "docx" | "pdf"; bytes: Buffer };
const run = promisify(execFile);
const invalid = (message: string) => new ValoProblem(422, message);
const xmlEscape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const textEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function readEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity in textEntities) return textEntities[entity]!;
    const point = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff)
      throw invalid("The Word document contains invalid text.");
    return String.fromCodePoint(point);
  });
}
/** Generate a self-contained Word template. Fixed ZIP timestamps make retries byte-identical. */
export function wordFromText(title: string, body: string): EditorialFile {
  const paragraphs = [title, ...body.split("\n")]
    .map((line) => '<w:p><w:r><w:t xml:space="preserve">' + xmlEscape(line) + "</w:t></w:r></w:p>")
    .join("");
  const zip = zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          paragraphs +
          "<w:sectPr/></w:body></w:document>",
      ),
    },
    { mtime: new Date(2000, 0, 1), level: 6 },
  );
  return { format: "docx", bytes: Buffer.from(zip) };
}
function wordText(bytes: Buffer): string {
  let expanded = 0;
  const names = new Set<string>();
  try {
    const entries = unzipSync(bytes, {
      filter(entry) {
        expanded += entry.originalSize;
        if (
          expanded > 12 * 1024 * 1024 ||
          names.size >= 300 ||
          names.has(entry.name) ||
          entry.name.split("/").includes("..") ||
          entry.name.includes("\\") ||
          entry.name.startsWith("/") ||
          /vbaProject|activeX\/|embeddings\/|\.(exe|js|vbs|bin)$/i.test(entry.name)
        )
          throw invalid("Upload a standard Word document without macros or embedded programs.");
        names.add(entry.name);
        return (
          entry.name === "word/document.xml" ||
          entry.name === "[Content_Types].xml" ||
          entry.name.endsWith(".rels")
        );
      },
    });
    const xml = strFromU8(entries["word/document.xml"] ?? new Uint8Array());
    const types = strFromU8(entries["[Content_Types].xml"] ?? new Uint8Array());
    if (
      !/<w:document\b/.test(xml) ||
      !/wordprocessingml\.document\.main\+xml/.test(types) ||
      /macroEnabled|<!DOCTYPE|<!ENTITY/i.test(xml + types) ||
      Object.entries(entries).some(
        ([key, value]) =>
          key.endsWith(".rels") &&
          /<Relationship\b[^>]*TargetMode\s*=\s*["']External["'][^>]*>/gi.test(
            strFromU8(value).replace(/<Relationship\b(?=[^>]*Type=["'][^"']*\/hyperlink["'])[^>]*>/gi, ""),
          ),
      )
    )
      throw invalid("Upload a self-contained .docx document.");
    return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g), (paragraph) =>
      Array.from(
        paragraph[1]!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:tab|br)\b[^>]*\/>/g),
        (part) => (part[1] === undefined ? " " : readEntities(part[1])),
      ).join(""),
    ).join("\n");
  } catch (error) {
    if (error instanceof ValoProblem) throw error;
    throw invalid("Valo could not read this Word document. Upload a .docx file or paste its text.");
  }
}
async function pdfText(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw invalid("Upload a valid PDF document.");
  const directory = await mkdtemp(join(tmpdir(), "valo-manual-pdf-"));
  const file = join(directory, "upload.pdf");
  try {
    await writeFile(file, bytes, { mode: 0o600 });
    const options = { timeout: 8000, maxBuffer: 512 * 1024, windowsHide: true, encoding: "utf8" as const };
    const info = (await run("pdfinfo", [file], options)).stdout;
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (
      !pages ||
      pages > 100 ||
      /^Encrypted:\s+yes/im.test(info) ||
      /^JavaScript:\s+yes/im.test(info) ||
      !/^0 embedded files\b/i.test((await run("pdfdetach", ["-list", file], options)).stdout.trim())
    )
      throw invalid("Upload a PDF with up to 100 pages, without encryption, scripts or embedded files.");
    return (await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], options)).stdout.replaceAll(
      "\f",
      "\n",
    );
  } catch (error) {
    if (error instanceof ValoProblem) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ValoProblem(503, "PDF reading is unavailable. Paste the text or upload a Word document.");
    throw invalid("Valo could not read this PDF. Upload a readable PDF or paste its text.");
  } finally {
    try {
      await unlink(file);
    } finally {
      await rmdir(directory);
    }
  }
}
export async function readEditorialUpload(format: EditorialFile["format"], base64: string) {
  if (base64.length > Math.ceil(fileLimit / 3) * 4)
    throw new ValoProblem(413, "Files must be 2 MB or smaller.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > fileLimit || bytes.toString("base64") !== base64)
    throw invalid("Choose a valid file of up to 2 MB.");
  return { file: { format, bytes }, text: format === "docx" ? wordText(bytes) : await pdfText(bytes) };
}
