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
import { chromium, type Browser, type BrowserContext } from "playwright";
import { documentInput } from "./valo-validation";
import {
  DRAFT_NOTICE,
  FINISHED_NOTICE,
  GUIDANCE_DRAFT_NOTICE,
  GUIDANCE_NOTICE,
  GUIDE_PART_PREFIX,
  PURCHASE_NOTICE,
  TEMPLATE_NOTICE,
  guidePart,
  printedPage,
  usesFormLayout,
  type PrintedBlock,
  type RenderMode,
} from "@workspace/valo-core/printed-page";
import { chromiumLaunchPath } from "../platform/chromium";

export {
  DRAFT_NOTICE,
  FINISHED_NOTICE,
  GUIDANCE_DRAFT_NOTICE,
  GUIDANCE_NOTICE,
  GUIDE_PART_PREFIX,
  PURCHASE_NOTICE,
  TEMPLATE_NOTICE,
  type PrintedBlock,
};

/** Names how a document is rendered. A file is made once for a saved version, kind and render
 * version, so the name changes whenever the same saved version would print differently. Version 4:
 * a guided document prints an amount in naira under its question's name, without "kobo". Version 5:
 * a customer's own document says "Saved version", names its fields as the editor does, prints a
 * date with the month as a word, and carries the draft notice below. Version 6: a list prints no blank line, as the
 * editor's preview does (docs/architecture/editor.md). Version 7: a table made from questions, a totals
 * table and a customer's table marked so print their first row as a heading row, repeated at the top of
 * each page. */
export const RENDER_VERSION = "manual-draft-7";
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
/** The blocks' HTML, as the page and the PDF print them. Every text is escaped. */
export function blocksHtml(blocks: readonly PrintedBlock[], mode: RenderMode = "business_draft") {
  const e = escapeHtml;
  const cells = (row: string[], tag: "td" | "th") =>
    row.map((cell) => `<${tag}>${e(cell)}</${tag}>`).join("");
  return blocks
    .map((block) =>
      block.type === "heading"
        ? `<h${block.level === 3 ? 3 : 2}>${e(block.text)}</h${block.level === 3 ? 3 : 2}>`
        : block.type === "table"
          ? block.headerRows && block.rows.length
            ? `<table><thead><tr>${cells(block.rows[0]!, "th")}</tr></thead><tbody>${block.rows
                .slice(1)
                .map((row) => `<tr>${cells(row, "td")}</tr>`)
                .join("")}</tbody></table>`
            : `<table><tbody>${block.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table>`
          : block.type === "list"
            ? `<ul>${block.text
                .split("\n")
                .map((line) => `<li>${e(line)}</li>`)
                .join("")}</ul>`
            : ((part) =>
                part ? `<p><strong>${e(part.name)}</strong>${e(part.rest)}</p>` : `<p>${e(block.text)}</p>`)(
                guidePart(mode, block),
              ),
    )
    .join("");
}
/** The styles a form's headings and header rows need, added only to a document that has them. */
const FORM_LAYOUT_STYLE =
  "h2{font-size:14pt;margin:16pt 0 6pt}h3{font-size:12pt;margin:12pt 0 4pt}th{border:1px solid #aaa;padding:7pt;text-align:left;vertical-align:top;background:#f3f0e8}";
export function controlledHtml(raw: unknown, revision: number, mode: RenderMode = "business_draft") {
  const document = documentInput.parse(raw);
  const { content } = document;
  const { notice, title, savedLine, fields, blocks: printed } = printedPage(document, revision, mode);
  const e = escapeHtml;
  const font = content.formatting.font === "serif" ? "Georgia, serif" : "Arial, sans-serif";
  const colour = content.formatting.accent === "forest" ? "#214d3b" : "#292724";
  const blocks = blocksHtml(printed, mode);
  const layout = usesFormLayout(printed) ? FORM_LAYOUT_STYLE : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(title)}</title><style>
  @page{size:A4;margin:25mm 18mm}body{font:11pt/1.25 ${font};color:#292724;overflow-wrap:anywhere}h1{color:${colour};font-size:23pt}p,li,td{white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:14pt 0}td{border:1px solid #aaa;padding:7pt;vertical-align:top}tr{break-inside:avoid}.notice{border:1px solid #b6ac94;padding:10pt;color:#675c3b;font-size:9pt}.field{margin:5pt 0}thead{display:table-header-group}${layout}</style></head><body>
  <div class="notice">${notice}</div><h1>${e(title)}</h1><p>${savedLine}</p>
  ${fields.map(({ name, value }) => `<div class="field"><strong>${e(name)}:</strong> ${e(value)}</div>`).join("")}
  ${blocks}</body></html>`;
}
export async function renderDocument(
  raw: unknown,
  format: "docx" | "pdf",
  revision: number,
  mode: RenderMode = "business_draft",
): Promise<Buffer> {
  const document = documentInput.parse(raw);
  const { content } = document;
  const { notice, title, savedLine, fields, blocks } = printedPage(document, revision, mode);
  if (format === "docx") {
    const children: (Paragraph | Table)[] = [
      new Paragraph({ text: notice }),
      new Paragraph({
        heading: "Title",
        children: [
          new TextRun({ text: title, color: content.formatting.accent === "forest" ? "214d3b" : "292724" }),
        ],
      }),
      new Paragraph(savedLine),
      ...fields.map(
        ({ name, value }) =>
          new Paragraph({
            children: [new TextRun({ text: `${name}: `, bold: true }), new TextRun(value)],
          }),
      ),
    ];
    children.push(...docxBlocks(blocks, mode));
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
  return renderPdf(raw, revision, mode, notice);
}
/** The blocks as Word prints them: a heading in Word's own heading style, and a table's header row
 * marked to repeat at the top of each page. */
export function docxBlocks(blocks: readonly PrintedBlock[], mode: RenderMode = "business_draft") {
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    if (block.type === "heading")
      children.push(
        new Paragraph({ heading: block.level === 3 ? "Heading3" : "Heading2", text: block.text }),
      );
    else if (block.type === "table" && block.rows.length)
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (row, index) =>
              new TableRow({
                cantSplit: true,
                ...(block.headerRows && index === 0 ? { tableHeader: true } : {}),
                children: (row.length ? row : [""]).map(
                  (text) => new TableCell({ children: [new Paragraph(text)] }),
                ),
              }),
          ),
        }),
      );
    else if (block.type === "list")
      children.push(...block.text.split("\n").map((text) => new Paragraph({ text, bullet: { level: 0 } })));
    else {
      const part = guidePart(mode, block);
      children.push(
        new Paragraph({
          children: part
            ? [new TextRun({ text: part.name, bold: true }), new TextRun(part.rest)]
            : block.text.split("\n").flatMap((text, i) => [new TextRun({ text, break: i ? 1 : 0 })]),
        }),
      );
    }
  }
  return children;
}
async function renderPdf(raw: unknown, revision: number, mode: RenderMode, notice: string) {
  await acquirePdfSlot();
  let context: BrowserContext | undefined;
  // A hung render closes only its own context; the shared browser keeps serving others.
  const timeout = setTimeout(() => {
    void context?.close();
  }, RENDER_TIMEOUT_MS);
  try {
    const browser = await sharedBrowser();
    context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
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
    // Best-effort: the context may already be closed by the timeout or a browser crash.
    await context?.close().catch(() => {});
    releasePdfSlot();
  }
}

/*
 * One shared Chromium per process instead of one launch per PDF. Each PDF still gets
 * a fresh, isolated context with JavaScript disabled and all network blocked. At most
 * MAX_PARALLEL_PDF render at once. A crashed or disconnected browser is replaced on
 * the next render, and an idle browser closes itself so short-lived processes exit.
 */
const MAX_PARALLEL_PDF = 5;
const RENDER_TIMEOUT_MS = 45_000;
const IDLE_CLOSE_MS = 1_000;
let browserPromise: Promise<Browser> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let renderingSlots = 0;
const statistics = { launches: 0, peakParallel: 0 };
const waitingForSlot: Array<() => void> = [];

function sharedBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  statistics.launches++;
  const launching = chromium.launch({
    ...chromiumLaunchPath(),
    headless: true,
    timeout: 15000,
  });
  browserPromise = launching;
  launching.then(
    (browser) =>
      browser.on("disconnected", () => {
        if (browserPromise === launching) browserPromise = undefined;
      }),
    () => {
      if (browserPromise === launching) browserPromise = undefined;
    },
  );
  return launching;
}

async function acquirePdfSlot(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (renderingSlots < MAX_PARALLEL_PDF) {
    renderingSlots++;
    statistics.peakParallel = Math.max(statistics.peakParallel, renderingSlots);
    return;
  }
  // The releasing render hands its slot over directly, so the limit is never exceeded.
  await new Promise<void>((resolve) => waitingForSlot.push(resolve));
}

function releasePdfSlot(): void {
  const next = waitingForSlot.shift();
  if (next) return next();
  renderingSlots--;
  if (renderingSlots === 0)
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      void closeRenderer();
    }, IDLE_CLOSE_MS);
}

/** Closes the shared browser, for worker shutdown and idle processes. */
export async function closeRenderer(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // Expected when the browser already exited or failed to launch.
  }
}

/** Browser launches and peak concurrent renders in this process, for tests and diagnostics. */
export function rendererStatistics() {
  return { ...statistics };
}
