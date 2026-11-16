import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  PageNumber,
  WidthType,
} from "docx";
import { chromium } from "playwright";
import { documentInput } from "./valo-validation";
import { GUIDED_PREFIX, guidedRenderableBlocks } from "@workspace/valo-core/guided-runtime";

export const RENDER_VERSION = "manual-draft-1";
export const DRAFT_NOTICE =
  "INCOMPLETE BUSINESS DRAFT — user-provided information. Not verified payment proof, official approval or legal advice.";
export const TEMPLATE_NOTICE =
  "BLANK DEVELOPMENT TEMPLATE — complete with your own business information. Not regulatory guidance or verified business facts.";
export const PURCHASE_NOTICE =
  "VALO DEVELOPMENT PURCHASE RECEIPT — server-verified test transaction record only. Not proof of delivery, bank outcome, a government tax invoice or official approval.";
type RenderMode = "business_draft" | "template_sample" | "purchase_receipt";
export const exportMime = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
export function controlledHtml(raw: unknown, revision: number, mode: RenderMode = "business_draft") {
  const notice =
    mode === "purchase_receipt"
      ? PURCHASE_NOTICE
      : mode === "template_sample"
        ? TEMPLATE_NOTICE
        : DRAFT_NOTICE;
  const { title, content } = documentInput.parse(raw);
  const e = escapeHtml;
  const font = content.formatting.font === "serif" ? "Georgia, serif" : "Arial, sans-serif";
  const colour = content.formatting.accent === "forest" ? "#214d3b" : "#292724";
  const fields = content.blocks.some((b) => b.id.startsWith(GUIDED_PREFIX))
    ? [["Notes", content.fields.notes]]
    : Object.entries(content.fields);
  const blocks = guidedRenderableBlocks(content)
    .map((block) =>
      block.type === "table"
        ? `<table><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
        : block.type === "list"
          ? `<ul>${block.text
              .split("\n")
              .map((line) => `<li>${e(line)}</li>`)
              .join("")}</ul>`
          : `<p>${e(block.text)}</p>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(title)}</title><style>
  @page{size:A4;margin:25mm 18mm}body{font:11pt ${font};color:#292724;overflow-wrap:anywhere}h1{color:${colour};font-size:23pt}p,li,td{white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:14pt 0}td{border:1px solid #aaa;padding:7pt;vertical-align:top}tr{break-inside:avoid}.notice{border:1px solid #b6ac94;padding:10pt;color:#675c3b;font-size:9pt}.field{margin:5pt 0}thead{display:table-header-group}</style></head><body>
  <div class="notice">${notice}</div><h1>${e(title)}</h1><p>Valo · Saved revision ${revision}</p>
  ${fields.map(([key, value]) => `<div class="field"><strong>${e(key)}:</strong> ${e(value || "[Not supplied]")}</div>`).join("")}
  ${blocks}</body></html>`;
}
export async function renderDocument(
  raw: unknown,
  format: "docx" | "pdf",
  revision: number,
  mode: RenderMode = "business_draft",
): Promise<Buffer> {
  const notice =
    mode === "purchase_receipt"
      ? PURCHASE_NOTICE
      : mode === "template_sample"
        ? TEMPLATE_NOTICE
        : DRAFT_NOTICE;
  const { title, content } = documentInput.parse(raw);
  const fields = content.blocks.some((b) => b.id.startsWith(GUIDED_PREFIX))
    ? [["Notes", content.fields.notes]]
    : Object.entries(content.fields);
  if (format === "docx") {
    const children: (Paragraph | Table)[] = [
      new Paragraph({ text: notice }),
      new Paragraph({
        heading: "Title",
        children: [
          new TextRun({ text: title, color: content.formatting.accent === "forest" ? "214d3b" : "292724" }),
        ],
      }),
      new Paragraph(`Valo · Saved revision ${revision}`),
      ...fields.map(
        ([key, value]) =>
          new Paragraph({
            children: [new TextRun({ text: `${key}: `, bold: true }), new TextRun(value || "[Not supplied]")],
          }),
      ),
    ];
    for (const block of guidedRenderableBlocks(content)) {
      if (block.type === "table" && block.rows.length)
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  cantSplit: true,
                  children: (row.length ? row : [""]).map(
                    (text) => new TableCell({ children: [new Paragraph(text)] }),
                  ),
                }),
            ),
          }),
        );
      else if (block.type === "list")
        children.push(...block.text.split("\n").map((text) => new Paragraph({ text, bullet: { level: 0 } })));
      else
        children.push(
          new Paragraph({
            children: block.text.split("\n").flatMap((text, i) => [new TextRun({ text, break: i ? 1 : 0 })]),
          }),
        );
    }
    return Packer.toBuffer(
      new Document({
        creator: "Valo",
        title,
        description: notice,
        styles: {
          default: {
            document: {
              run: { font: content.formatting.font === "serif" ? "Times New Roman" : "Arial", size: 22 },
            },
          },
        },
        sections: [
          {
            properties: {
              page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1200, bottom: 1200, left: 1020, right: 1020 },
              },
            },
            headers: { default: new Header({ children: [new Paragraph(notice)] }) },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    children: [new TextRun("Valo · Page "), new TextRun({ children: [PageNumber.CURRENT] })],
                  }),
                ],
              }),
            },
            children,
          },
        ],
      }),
    );
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
    headless: true,
    timeout: 15000,
  });
  const timeout = setTimeout(() => {
    void browser.close();
  }, 45000);
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.setContent(controlledHtml(raw, revision, mode), { waitUntil: "load", timeout: 15000 });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7px;width:100%;text-align:center">${notice}</div>`,
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center">Valo · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "25mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }
}
