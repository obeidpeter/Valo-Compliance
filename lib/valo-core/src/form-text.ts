/**
 * Form text, grammar 1 (forms v2, docs/architecture/forms-v2.md): a template's own wording with its
 * placeholders named, so a form's answers can fill it. It is Markdown cut down to what a business
 * document needs and nothing that could carry markup or a link:
 *
 * - `# Title` on the first line, `## ` and `### ` headings, paragraphs (lines separated by a blank
 *   line), bullet lists (`- `), and pipe tables whose first row is the header and whose second row is
 *   the separator (`| --- |`);
 * - a slot, the placeholder as printed and then its name: `[ ]{=agreementReference}`;
 * - a span, text kept only for one answer to a choice: `{?term=fixed}…{/?}` inline, the same marks
 *   alone on their own lines around whole blocks, or around a whole table row, opening at the start of
 *   its first cell and closing at the end of its last. `{?term=}` keeps its text only while the choice
 *   is unanswered, and `{?notes}` only while the question `notes` has an answer. Spans do not nest;
 * - a repeating table row, `| {*deliverables} [ ]{=deliverables.item} | … |`, printed once for each
 *   row of the form's table of that name, and a repeating group of blocks, between `{*topics}` and
 *   `{/*}` alone on their own lines, printed once for each row of that table. A group holds no span
 *   or other group around blocks.
 *
 * Anything else in braces, an HTML tag, a link, an image or emphasis marks is refused, so released
 * wording can only ever print as plain text. The grammar is frozen with the v2 forms: a change to it
 * makes a new version.
 */
export const FORM_TEXT_GRAMMAR = 1;

/** A passage kept for one answer to a choice (`option`), while the choice is unanswered (`""`), or
 * while a question has an answer (`null`). */
export type FormSpan = { question: string; option: string | null };
export type FormInline =
  | { kind: "text"; text: string }
  | { kind: "slot"; name: string; placeholder: string }
  | { kind: "span"; span: FormSpan; parts: FormInline[] };
export type FormRow = { repeat: string | null; span: FormSpan | null; cells: FormInline[][] };
export type FormNode =
  | { kind: "heading"; level: 2 | 3; parts: FormInline[] }
  | { kind: "paragraph"; lines: FormInline[][] }
  | { kind: "list"; items: FormInline[][] }
  | { kind: "table"; header: FormInline[][]; rows: FormRow[] }
  | { kind: "span"; span: FormSpan; nodes: FormNode[] }
  | { kind: "repeat"; table: string; nodes: FormNode[] };
export type FormText = { title: string; nodes: FormNode[] };

export class FormTextError extends Error {
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`Form text line ${line}: ${reason}`);
    this.name = "FormTextError";
  }
}

const NAME = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)?$/;
const QUESTION = /^[a-z][A-Za-z0-9]*$/;
const OPTION = /^[a-z0-9_]*$/;
/** At most what the contract can hold, with room: 8,000 characters a block, 100 blocks. */
const MAX_SOURCE = 60_000;
/** A span's opening mark: `{?question=option}`, `{?question=}` or `{?question}`. */
const SPAN_OPEN = /^\{\?([^=}]*)(=([^}]*))?\}/;
const TABLE_NAME = /^[a-z][A-Za-z0-9]*$/;

function spanOf(mark: RegExpExecArray, line: number): FormSpan {
  const question = mark[1]!,
    option = mark[2] === undefined ? null : mark[3]!;
  if (!QUESTION.test(question) || (option !== null && !OPTION.test(option)))
    throw new FormTextError(
      line,
      `"${mark[0]}" is not a span mark: {?question=option}, {?question=} or {?question}`,
    );
  return { question, option };
}

/** Reads one line's inline marks: text, slots and inline spans. */
function inline(source: string, line: number, allowSpan = true): FormInline[] {
  const parts: FormInline[] = [];
  let text = "";
  const flush = () => {
    if (text) parts.push({ kind: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    // A slot: [placeholder]{=name}
    const slot = /^\[([^\][{}]*)\]\{=([^}]*)\}/.exec(rest);
    if (slot) {
      const name = slot[2]!;
      if (!NAME.test(name)) throw new FormTextError(line, `"${name}" is not a slot name`);
      flush();
      parts.push({ kind: "slot", name, placeholder: `[${slot[1]!}]` });
      i += slot[0].length;
      continue;
    }
    const open = SPAN_OPEN.exec(rest);
    if (open) {
      if (!allowSpan) throw new FormTextError(line, "spans do not nest");
      const span = spanOf(open, line);
      const close = rest.indexOf("{/?}", open[0].length);
      if (close < 0) throw new FormTextError(line, `"${open[0]}" is not closed on its line`);
      flush();
      parts.push({ kind: "span", span, parts: inline(rest.slice(open[0].length, close), line, false) });
      i += close + "{/?}".length;
      continue;
    }
    const character = source[i]!;
    if (character === "{" || character === "}")
      throw new FormTextError(line, "braces are used only for slots and spans");
    if (character === "<" && /^<[A-Za-z/!?]/.test(rest)) throw new FormTextError(line, "no markup");
    if (character === "!" && rest.startsWith("![")) throw new FormTextError(line, "no images");
    if (character === "]" && rest.startsWith("](")) throw new FormTextError(line, "no links");
    if (rest.startsWith("**") || rest.startsWith("__")) throw new FormTextError(line, "no emphasis marks");
    if (character === "`") throw new FormTextError(line, "no code marks");
    text += character;
    i++;
  }
  flush();
  return parts;
}

const cellsOf = (row: string, line: number) => {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|"))
    throw new FormTextError(line, "a table row starts and ends with |");
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
};

/** A table row's cells, with a repeat mark and a span around the whole row read off. */
function tableRow(raw: string, line: number, columns: number, inSpan: boolean): FormRow {
  const cells = cellsOf(raw, line);
  if (cells.length !== columns) throw new FormTextError(line, "every row has as many cells as the header");
  const repeat = /^\{\*([a-z][A-Za-z0-9]*)\}\s*/.exec(cells[0]!);
  if (repeat) cells[0] = cells[0]!.slice(repeat[0].length);
  const last = cells.length - 1,
    open = SPAN_OPEN.exec(cells[0]!);
  // A span opening at the start of the first cell and closing at the end of the last keeps the row.
  const wrapsRow =
    open !== null &&
    cells[last]!.endsWith("{/?}") &&
    (last === 0
      ? cells[0]!.split("{/?}").length === 2
      : !cells[0]!.includes("{/?}") && !cells[last]!.includes("{?"));
  let span: FormSpan | null = null;
  if (wrapsRow) {
    if (repeat)
      throw new FormTextError(line, "a repeating row is printed for each row of its table: it takes no span");
    if (inSpan) throw new FormTextError(line, "spans do not nest");
    span = spanOf(open, line);
    cells[0] = cells[0]!.slice(open[0].length).trim();
    cells[last] = cells[last]!.slice(0, -"{/?}".length).trim();
  }
  return {
    repeat: repeat?.[1] ?? null,
    span,
    cells: cells.map((cell) => inline(cell, line, span === null)),
  };
}

/** Parses form text, or throws `FormTextError` naming the first line it cannot read. */
export function parseFormText(source: string): FormText {
  if (source.length > MAX_SOURCE) throw new FormTextError(1, "the text is too long");
  // Control characters, and the two Unicode separators that end a line in JavaScript source.
  for (let i = 0; i < source.length; i++) {
    const n = source.charCodeAt(i);
    if ((n < 32 && n !== 10 && n !== 13 && n !== 9) || n === 0x7f || n === 0x2028 || n === 0x2029)
      throw new FormTextError(1, "control characters are not allowed");
  }
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0 || !/^# \S/.test(lines[first]!))
    throw new FormTextError(first + 1, "the text starts with its title, as `# Title`");
  const title = lines[first]!.slice(2).trim();
  if (/[[\]{}<`*]/.test(title)) throw new FormTextError(first + 1, "the title is plain words");
  const root: FormNode[] = [];
  // The span or repeating group open around blocks, if any: they do not nest.
  let open: { node: Extract<FormNode, { kind: "span" | "repeat" }>; line: number } | null = null;
  const into = () => open?.node.nodes ?? root;
  const isMark = (trimmed: string) =>
    trimmed === "{/?}" || trimmed === "{/*}" || /^\{[?*][^}]*\}$/.test(trimmed);
  let i = first + 1;
  while (i < lines.length) {
    const raw = lines[i]!,
      line = i + 1,
      trimmed = raw.trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    const spanOpen = /^\{\?[^}]*\}$/.test(trimmed) ? SPAN_OPEN.exec(trimmed) : null;
    const groupOpen = /^\{\*([^}]*)\}$/.exec(trimmed);
    if (spanOpen || groupOpen) {
      if (open) throw new FormTextError(line, "spans and repeating groups do not nest");
      if (groupOpen) {
        if (!TABLE_NAME.test(groupOpen[1]!))
          throw new FormTextError(line, `"${trimmed}" does not name a table of the form`);
        open = { node: { kind: "repeat", table: groupOpen[1]!, nodes: [] }, line };
      } else open = { node: { kind: "span", span: spanOf(spanOpen!, line), nodes: [] }, line };
      root.push(open.node);
      i++;
      continue;
    }
    if (trimmed === "{/?}" || trimmed === "{/*}") {
      const kind = trimmed === "{/?}" ? "span" : "repeat";
      if (open?.node.kind !== kind)
        throw new FormTextError(
          line,
          kind === "span"
            ? "a span closes that was not opened"
            : "a repeating group closes that was not opened",
        );
      open = null;
      i++;
      continue;
    }
    if (/^#\s/.test(trimmed)) throw new FormTextError(line, "the text has one title");
    const heading = /^(##|###) (\S.*)$/.exec(trimmed);
    if (heading) {
      into().push({ kind: "heading", level: heading[1] === "##" ? 2 : 3, parts: inline(heading[2]!, line) });
      i++;
      continue;
    }
    if (trimmed.startsWith("#")) throw new FormTextError(line, "headings are ## or ###");
    if (trimmed.startsWith("- ")) {
      const items: FormInline[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("- ")) {
        items.push(inline(lines[i]!.trim().slice(2), i + 1));
        i++;
      }
      into().push({ kind: "list", items });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const header = cellsOf(trimmed, line).map((cell) => inline(cell, line));
      const separator = lines[i + 1]?.trim() ?? "";
      const separatorCells = separator.startsWith("|") ? cellsOf(separator, line + 1) : [];
      if (
        separatorCells.length !== header.length ||
        !separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell))
      )
        throw new FormTextError(line + 1, "a table's header is followed by its separator row");
      i += 2;
      const rows: FormRow[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const row = tableRow(lines[i]!, i + 1, header.length, open?.node.kind === "span");
        if (row.repeat && open?.node.kind === "repeat")
          throw new FormTextError(i + 1, "a repeating row cannot sit in a repeating group");
        rows.push(row);
        i++;
      }
      if (header.length > 10) throw new FormTextError(line, "a table has at most 10 columns");
      into().push({ kind: "table", header, rows });
      continue;
    }
    // A paragraph: lines until a blank line or another kind of block.
    const paragraph: FormInline[][] = [];
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (
        next === "" ||
        next.startsWith("#") ||
        next.startsWith("- ") ||
        next.startsWith("|") ||
        isMark(next)
      )
        break;
      paragraph.push(inline(next, i + 1));
      i++;
    }
    into().push({ kind: "paragraph", lines: paragraph });
  }
  if (open)
    throw new FormTextError(
      open.line,
      open.node.kind === "span" ? "a span is not closed" : "a repeating group is not closed",
    );
  return { title, nodes: root };
}

/** Every slot in the text, in order, with the table whose rows fill it, if any: the table of its
 * repeating row, or of the repeating group it sits in. */
export function formTextSlots(text: FormText) {
  const found: { name: string; placeholder: string; row: string | null }[] = [];
  const walkInline = (parts: FormInline[], row: string | null) => {
    for (const part of parts) {
      if (part.kind === "slot") found.push({ name: part.name, placeholder: part.placeholder, row });
      if (part.kind === "span") walkInline(part.parts, row);
    }
  };
  const walk = (nodes: FormNode[], group: string | null) => {
    for (const node of nodes) {
      if (node.kind === "heading") walkInline(node.parts, group);
      if (node.kind === "paragraph") for (const l of node.lines) walkInline(l, group);
      if (node.kind === "list") for (const item of node.items) walkInline(item, group);
      if (node.kind === "table") {
        for (const cell of node.header) walkInline(cell, group);
        for (const row of node.rows) for (const cell of row.cells) walkInline(cell, row.repeat ?? group);
      }
      if (node.kind === "span") walk(node.nodes, group);
      if (node.kind === "repeat") walk(node.nodes, node.table);
    }
  };
  walk(text.nodes, null);
  return found;
}

/** Every span in the text: inline, around blocks or around a table row. */
export function formTextSpans(text: FormText): FormSpan[] {
  const found: FormSpan[] = [];
  const walkInline = (parts: FormInline[]) => {
    for (const part of parts)
      if (part.kind === "span") {
        found.push(part.span);
        walkInline(part.parts);
      }
  };
  const walk = (nodes: FormNode[]) => {
    for (const node of nodes) {
      if (node.kind === "heading") walkInline(node.parts);
      if (node.kind === "paragraph") node.lines.forEach(walkInline);
      if (node.kind === "list") node.items.forEach(walkInline);
      if (node.kind === "table") {
        node.header.forEach(walkInline);
        for (const row of node.rows) {
          if (row.span) found.push(row.span);
          row.cells.forEach(walkInline);
        }
      }
      if (node.kind === "span") {
        found.push(node.span);
        walk(node.nodes);
      }
      if (node.kind === "repeat") walk(node.nodes);
    }
  };
  walk(text.nodes);
  return found;
}
