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
import { GUIDED_PREFIX, guidedRenderableBlocks } from "@workspace/valo-core/guided-runtime";
import { chromiumLaunchPath } from "../platform/chromium";

export const RENDER_VERSION = "manual-draft-3";
export const DRAFT_NOTICE =
  "INCOMPLETE BUSINESS DRAFT — user-provided information. Not verified payment proof, a government tax invoice, official approval or legal advice.";
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
    ? [["Notes", content.fields.notes] as const]
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
  @page{size:A4;margin:25mm 18mm}body{font:11pt/1.25 ${font};color:#292724;overflow-wrap:anywhere}h1{color:${colour};font-size:23pt}p,li,td{white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:14pt 0}td{border:1px solid #aaa;padding:7pt;vertical-align:top}tr{break-inside:avoid}.notice{border:1px solid #b6ac94;padding:10pt;color:#675c3b;font-size:9pt}.field{margin:5pt 0}thead{display:table-header-group}</style></head><body>
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
    ? [["Notes", content.fields.notes] as const]
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
