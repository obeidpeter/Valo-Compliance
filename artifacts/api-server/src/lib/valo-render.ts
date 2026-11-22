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
  DOCUMENT_FIELD_LABELS,
  GUIDED_PREFIX,
  guidedRenderableBlocks,
  printedCalendarDate,
} from "@workspace/valo-core/guided-runtime";
import { chromiumLaunchPath } from "../platform/chromium";
import {
  GUIDANCE_DRAFT_NOTICE,
  GUIDANCE_NOTICE,
  GUIDE_PART_PREFIX,
  PRACTICAL_GUIDE_NOTICE,
} from "./valo-guide-notices";

/** Names how a document is rendered. A file is made once for a saved version, kind and render
 * version, so the name changes whenever the same saved version would print differently. Version 4:
 * a guided document prints an amount in naira under its question's name, without "kobo". Version 5:
 * a customer's own document says "Saved version", names its fields as the editor does, prints a
 * date with the month as a word, and carries the draft notice below. */
export const RENDER_VERSION = "manual-draft-5";
/** Printed at the top of a customer's own document and on every page of it. The file may be read by
 * someone the customer sends it to, so it speaks of "the business". It still says what the notice
 * before it said: an incomplete draft (EDT-005), details nobody verified, and not proof of payment
 * or a government tax invoice (PAY-009), an official approval or legal advice. */
export const DRAFT_NOTICE =
  "INCOMPLETE DRAFT — details as the business entered them. Not proof of payment, a government tax invoice, an official approval or legal advice.";
export const TEMPLATE_NOTICE =
  "BLANK DEVELOPMENT TEMPLATE — complete with your own business information. Not regulatory guidance or verified business facts.";
export const PURCHASE_NOTICE =
  "VALO DEVELOPMENT PURCHASE RECEIPT — server-verified test transaction record only. Not proof of delivery, bank outcome, a government tax invoice or official approval.";
export { GUIDANCE_NOTICE, GUIDANCE_DRAFT_NOTICE, GUIDE_PART_PREFIX };
type RenderMode =
  | "business_draft"
  | "template_sample"
  | "purchase_receipt"
  | "guidance"
  | "guidance_draft"
  | "practical_guide";
const guide = (mode: RenderMode) =>
  mode === "guidance" || mode === "guidance_draft" || mode === "practical_guide";
/** A named part's name and the rest of its text, or nothing when the block is not one. */
function guidePart(mode: RenderMode, block: { id: string; type: string; text: string }) {
  if (!guide(mode) || block.type !== "paragraph" || !block.id.startsWith(GUIDE_PART_PREFIX)) return null;
  const end = block.text.indexOf(":");
  return end > 0 && end <= 40
    ? { name: block.text.slice(0, end + 1), rest: block.text.slice(end + 1) }
    : null;
}
const noticeFor = (mode: RenderMode) =>
  mode === "purchase_receipt"
    ? PURCHASE_NOTICE
    : mode === "template_sample"
      ? TEMPLATE_NOTICE
      : mode === "practical_guide"
        ? PRACTICAL_GUIDE_NOTICE
        : mode === "guidance"
          ? GUIDANCE_NOTICE
          : mode === "guidance_draft"
            ? GUIDANCE_DRAFT_NOTICE
            : DRAFT_NOTICE;
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
type Fields = Record<keyof typeof DOCUMENT_FIELD_LABELS, string>;
/** The line under a document's title. A customer's own document says "version", as the site does. A
 * template sample and a purchase receipt are left as they were: their words belong with the
 * templates' own review and with the purchases screen's. A guide names its own version. */
const savedLine = (mode: RenderMode, revision: number) =>
  guide(mode)
    ? `Valo · Guide version ${revision}`
    : mode === "business_draft"
      ? `Valo · Saved version ${revision}`
      : `Valo · Saved revision ${revision}`;
/**
 * A document's own fields as its file prints them, each with its name. A document made from
 * questions prints its note alone: its other fields are answers, printed with their questions.
 *
 * A customer's own document names each field as the editor does and prints a date with the month
 * as a word. A template sample and a purchase receipt are left as they were. A guide is something
 * to read, with no business details to fill in, so it prints none of them.
 */
function printedFields(fields: Fields, guided: boolean, mode: RenderMode): (readonly [string, string])[] {
  if (guide(mode)) return [];
  if (mode !== "business_draft") return guided ? [["Notes", fields.notes]] : Object.entries(fields);
  const names = guided
    ? (["notes"] as const)
    : (["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate", "notes"] as const);
  return names.map((name) => [
    DOCUMENT_FIELD_LABELS[name],
    name === "issueDate" || name === "dueDate" ? printedCalendarDate(fields[name]) : fields[name],
  ]);
}
export function controlledHtml(raw: unknown, revision: number, mode: RenderMode = "business_draft") {
  const notice = noticeFor(mode);
  const { title, content } = documentInput.parse(raw);
  const e = escapeHtml;
  const font = content.formatting.font === "serif" ? "Georgia, serif" : "Arial, sans-serif";
  const colour = content.formatting.accent === "forest" ? "#214d3b" : "#292724";
  const fields = printedFields(
    content.fields,
    content.blocks.some((b) => b.id.startsWith(GUIDED_PREFIX)),
    mode,
  );
  const blocks = guidedRenderableBlocks(content)
    .map((block) =>
      block.type === "table"
        ? `<table><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(title)}</title><style>
  @page{size:A4;margin:25mm 18mm}body{font:11pt/1.25 ${font};color:#292724;overflow-wrap:anywhere}h1{color:${colour};font-size:23pt}p,li,td{white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:14pt 0}td{border:1px solid #aaa;padding:7pt;vertical-align:top}tr{break-inside:avoid}.notice{border:1px solid #b6ac94;padding:10pt;color:#675c3b;font-size:9pt}.field{margin:5pt 0}thead{display:table-header-group}</style></head><body>
  <div class="notice">${notice}</div><h1>${e(title)}</h1><p>${savedLine(mode, revision)}</p>
  ${fields.map(([key, value]) => `<div class="field"><strong>${e(key)}:</strong> ${e(value || "[Not supplied]")}</div>`).join("")}
  ${blocks}</body></html>`;
}
export async function renderDocument(
  raw: unknown,
  format: "docx" | "pdf",
  revision: number,
  mode: RenderMode = "business_draft",
): Promise<Buffer> {
  const notice = noticeFor(mode);
  const { title, content } = documentInput.parse(raw);
  const fields = printedFields(
    content.fields,
    content.blocks.some((b) => b.id.startsWith(GUIDED_PREFIX)),
    mode,
  );
  if (format === "docx") {
    const children: (Paragraph | Table)[] = [
      new Paragraph({ text: notice }),
      new Paragraph({
        heading: "Title",
        children: [
          new TextRun({ text: title, color: content.formatting.accent === "forest" ? "214d3b" : "292724" }),
        ],
      }),
      new Paragraph(savedLine(mode, revision)),
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
