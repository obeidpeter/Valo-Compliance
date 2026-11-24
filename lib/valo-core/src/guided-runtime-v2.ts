import { formatKobo } from "./money";
import {
  GUIDED_DOCUMENT_NOTE,
  guidedCalendarDate,
  guidedFieldIssue,
  guidedVisible,
  printedCalendarDate,
} from "./guided-runtime-v1";
import {
  formTextSlots,
  formTextSpans,
  type FormInline,
  type FormNode,
  type FormSpan,
  type FormText,
} from "./form-text";
import {
  GUIDED_V2_PREFIX,
  type GuidedDataV2,
  type GuidedFieldV2,
  type GuidedSpecV2,
  type GuidedTableV2,
} from "./guided-v2";

/** A compiled block: the contract's paragraph, list and table, and a heading of level 2 or 3. */
export type FormBlock =
  | { id: string; type: "heading"; level: 2 | 3; text: string; rows: string[][] }
  | { id: string; type: "paragraph" | "list"; text: string; rows: string[][] }
  | { id: string; type: "table"; text: string; rows: string[][] };

/** The contract's limits, with room left: blocks per document, characters per block and cell, rows. */
export const FORM_LIMITS = { blocks: 90, blockText: 8000, cellText: 1000, tableRows: 100, columns: 10 };

/** The longest answer a question takes, as v1's own check (`guidedFieldIssue`) allows. */
function longestAnswer(field: GuidedFieldV2) {
  if (field.type === "long_text") return 4000;
  if (["issuerName", "recipientName"].includes(field.id)) return 160;
  if (field.id === "documentNumber") return 80;
  if (field.type === "select") return Math.max(0, ...(field.options ?? []).map((o) => o.label.length));
  return 400;
}

export function emptyFormData(spec: GuidedSpecV2): GuidedDataV2 {
  return {
    schemaVersion: 2,
    templateId: spec.templateId,
    values: Object.fromEntries(spec.fields.map((f) => [f.id, ""])),
    tables: Object.fromEntries(
      spec.tables.map((t) => [
        t.id,
        Array.from({ length: t.minRows }, () => Object.fromEntries(t.columns.map((c) => [c.id, ""]))),
      ]),
    ),
  };
}

/** The tables whose rows the text repeats: by a repeating row, or by a repeating group of blocks. */
const repeatsOf = (nodes: FormNode[]): { table: string; group: boolean }[] =>
  nodes.flatMap((node) =>
    node.kind === "table"
      ? node.rows.flatMap((row) => (row.repeat ? [{ table: row.repeat, group: false }] : []))
      : node.kind === "span"
        ? repeatsOf(node.nodes)
        : node.kind === "repeat"
          ? [{ table: node.table, group: true }, ...repeatsOf(node.nodes)]
          : [],
  );

/**
 * Whether a form fits an edition's form text. Each problem names what does not fit; a form is joined
 * only to an edition with none. Every question's slots must exist; every slot must be filled by a
 * question, a table's column inside its row, a calculation or a declared blank, so that no
 * placeholder is left out silently (EDT-001); every passage kept for a choice must name one of the
 * choice's options, every option must keep a passage or be declared to keep none, and every choice
 * must print something while it is unanswered, since none has a default; and the largest document
 * the form can make must fit the contract.
 */
export function formFit(spec: GuidedSpecV2, text: FormText): string[] {
  const problems: string[] = [];
  const slots = formTextSlots(text),
    spans = formTextSpans(text);
  const slotNames = new Set(slots.map((s) => s.name));
  const tables = new Map(spec.tables.map((t) => [t.id, t]));
  const filling = new Map<string, GuidedFieldV2[]>();
  for (const field of spec.fields)
    for (const token of field.tokens ?? []) {
      if (field.type === "acknowledgement")
        problems.push(`"${field.id}" is a confirmation and fills no text`);
      if (token.includes(".")) problems.push(`"${field.id}" fills "${token}", which belongs to a table row`);
      if (!slotNames.has(token))
        problems.push(`"${field.id}" fills "${token}", which the text does not have`);
      filling.set(token, [...(filling.get(token) ?? []), field]);
    }
  for (const { table, group } of repeatsOf(text.nodes))
    if (!tables.has(table))
      problems.push(
        `${group ? "a group of blocks" : "a row"} repeats for "${table}", which is not one of the form's tables`,
      );
  for (const slot of slots) {
    if (slot.name.startsWith("calc.")) {
      if (!spec.calculated?.[slot.name]) problems.push(`"${slot.name}" is not worked out by the form`);
      continue;
    }
    if (slot.name.includes(".")) {
      const [table, column] = slot.name.split(".") as [string, string];
      if (slot.row !== table) problems.push(`"${slot.name}" is outside a row of "${table}"`);
      else if (!tables.get(table)?.columns.some((c) => c.id === column))
        problems.push(`"${slot.name}" names no column of "${table}"`);
      continue;
    }
    if (!filling.has(slot.name) && !spec.blanks.includes(slot.name))
      problems.push(`"${slot.name}" is filled by nothing and is not a blank`);
  }
  for (const blank of spec.blanks)
    if (!slotNames.has(blank)) problems.push(`the blank "${blank}" is not in the text`);
  const choices = new Map(spec.fields.filter((f) => f.clause).map((f) => [f.id, f]));
  for (const span of spans) {
    if (span.option === null) {
      // Kept while a question has an answer: only for an answer the document may go without.
      const field = spec.fields.find((f) => f.id === span.question);
      if (!field)
        problems.push(`a passage is kept while "${span.question}" is answered, which is not a question`);
      else if (field.clause) problems.push(`"${span.question}" is a choice: its passages name its options`);
      else if (field.type === "acknowledgement")
        problems.push(`"${span.question}" is a confirmation and keeps no passage`);
      else if (field.required)
        problems.push(
          `a passage is kept only while "${span.question}" is answered, but it must be answered: its placeholder shows until it is`,
        );
      continue;
    }
    const choice = choices.get(span.question);
    if (!choice) problems.push(`a passage is kept for "${span.question}", which is not a choice`);
    else if (span.option !== "" && !choice.options?.some((o) => o.value === span.option))
      problems.push(
        `a passage is kept for "${span.question}=${span.option}", which is not one of its options`,
      );
  }
  for (const choice of choices.values()) {
    if (choice.type !== "select") problems.push(`the choice "${choice.id}" is not a select question`);
    for (const option of choice.options ?? [])
      if (
        !spans.some((s) => s.question === choice.id && s.option === option.value) &&
        !spec.keepsNothing?.some((k) => k.question === choice.id && k.option === option.value)
      )
        problems.push(`"${choice.id}=${option.value}" keeps no passage and is not declared to keep none`);
    if (!spans.some((s) => s.question === choice.id && s.option === ""))
      problems.push(`the choice "${choice.id}" prints nothing while it is unanswered`);
  }
  // The largest document the form can make: a repeating group is printed once for each row its table
  // can hold.
  const countBlocks = (nodes: FormNode[]): number =>
    nodes.reduce(
      (sum, node) =>
        sum +
        (node.kind === "span"
          ? countBlocks(node.nodes)
          : node.kind === "repeat"
            ? (tables.get(node.table)?.maxRows ?? 1) * countBlocks(node.nodes)
            : 1),
      0,
    );
  if (countBlocks(text.nodes) > FORM_LIMITS.blocks)
    problems.push(`the text makes more than ${FORM_LIMITS.blocks} blocks`);
  const longest = (parts: FormInline[], table?: GuidedTableV2): number =>
    parts.reduce((sum, part) => {
      if (part.kind === "text") return sum + part.text.length;
      if (part.kind === "span") return sum + longest(part.parts, table);
      if (part.name.startsWith("calc.")) return sum + 40;
      if (part.name.includes(".")) {
        const column = table?.columns.find((c) => `${table.id}.${c.id}` === part.name);
        return sum + (column ? longestAnswer(column) : part.placeholder.length);
      }
      const fields = filling.get(part.name) ?? [];
      return (
        sum +
        Math.max(
          part.placeholder.length,
          fields.reduce((n, f) => n + longestAnswer(f) + 2, 0),
        )
      );
    }, 0);
  const sizes = (nodes: FormNode[], group?: GuidedTableV2) => {
    for (const node of nodes) {
      if (node.kind === "span") sizes(node.nodes, group);
      if (node.kind === "repeat") sizes(node.nodes, tables.get(node.table));
      if (node.kind === "heading" && longest(node.parts, group) > FORM_LIMITS.blockText)
        problems.push("a heading can be longer than a block holds");
      if (node.kind === "paragraph" || node.kind === "list") {
        const lines = node.kind === "paragraph" ? node.lines : node.items;
        if (lines.reduce((n, l) => n + longest(l, group) + 1, 0) > FORM_LIMITS.blockText)
          problems.push("a paragraph or list can be longer than a block holds");
      }
      if (node.kind === "table") {
        if (node.header.length > FORM_LIMITS.columns) problems.push("a table has too many columns");
        const rows =
          1 +
          node.rows.reduce(
            (n, row) => n + (row.repeat ? (tables.get(row.repeat)?.maxRows ?? FORM_LIMITS.tableRows) : 1),
            0,
          );
        if (rows > FORM_LIMITS.tableRows) problems.push("a table can have more rows than a block holds");
        for (const row of node.rows)
          for (const cell of row.cells)
            if (longest(cell, row.repeat ? tables.get(row.repeat) : group) > FORM_LIMITS.cellText)
              problems.push("a table cell can be longer than a cell holds");
      }
    }
  };
  sizes(text.nodes);
  return [...new Set(problems)];
}

/**
 * The answers' own problems. `refused` are answers a save is refused for: an unknown question,
 * table or column, more rows than a table takes, an option that is not listed, a confirmation other
 * than "yes", or text longer than a question takes. `drafts` are answers a draft may keep while the
 * customer works, each by question: a required answer not given yet, or a date, number or amount not
 * valid yet. A draft answer fills no slot: its placeholder stays in the document.
 */
export function formAnswerIssues(spec: GuidedSpecV2, data: GuidedDataV2) {
  const refused: string[] = [],
    drafts: Record<string, string> = {};
  if (data.templateId !== spec.templateId) refused.push("These answers belong to another form.");
  const fields = new Map(spec.fields.map((f) => [f.id, f]));
  for (const id of Object.keys(data.values))
    if (!fields.has(id)) refused.push(`"${id}" is not a question of this form.`);
  const structural = (field: GuidedFieldV2, value: string, label: string) => {
    const issue = guidedFieldIssue(field, value);
    if (!value.trim() || !issue) return null;
    if (field.type === "select" || field.type === "acknowledgement" || /Shorten this answer/.test(issue))
      return `${label}: ${issue}`;
    return null;
  };
  for (const field of spec.fields) {
    const value = data.values[field.id] ?? "";
    const refusal = structural(field, value, field.label);
    if (refusal) refused.push(refusal);
    else if (guidedVisible(field, data.values)) {
      const issue = guidedFieldIssue(field, value);
      if (issue) drafts[field.id] = issue;
    }
  }
  // v1's date order: a later date before an earlier one stays a draft answer of the later date.
  for (const [id, message] of datesOutOfOrder(spec, data)) if (!drafts[id]) drafts[id] = message;
  const tables = new Map(spec.tables.map((t) => [t.id, t]));
  for (const [id, rows] of Object.entries(data.tables)) {
    const table = tables.get(id);
    if (!table) {
      refused.push(`"${id}" is not a table of this form.`);
      continue;
    }
    if (rows.length > table.maxRows) refused.push(`${table.label}: at most ${table.maxRows} rows.`);
    rows.forEach((row, index) => {
      for (const column of Object.keys(row))
        if (!table.columns.some((c) => c.id === column))
          refused.push(`"${column}" is not a column of ${table.label}.`);
      for (const column of table.columns) {
        const value = row[column.id] ?? "";
        const refusal = structural(column, value, `${table.label}, row ${index + 1}, ${column.label}`);
        if (refusal) refused.push(refusal);
        else if (guidedVisible(table, data.values) && guidedVisible(column, { ...data.values, ...row })) {
          // Keyed as v1 keys a table cell's issue, so the editor shows both alike.
          const issue = guidedFieldIssue(column, value);
          if (issue) drafts[`${id}:${index}:${column.id}`] = issue;
        }
      }
    });
  }
  // A table the form shows needs its fewest rows, as in v1.
  for (const table of spec.tables) {
    const rows = data.tables[table.id] ?? [];
    if (guidedVisible(table, data.values) && rows.length < table.minRows)
      drafts[table.id] = `Supply ${table.minRows}–${table.maxRows} rows.`;
  }
  return { refused, drafts };
}

/**
 * v1's date order: each later date given before the earlier date it must follow, with the order's
 * message. Such a date is a draft answer of the later date, so it fills no slot.
 */
function datesOutOfOrder(spec: GuidedSpecV2, data: GuidedDataV2) {
  const fields = new Map(spec.fields.map((f) => [f.id, f]));
  const late = new Map<string, string>();
  for (const check of spec.dateOrder ?? []) {
    const before = fields.get(check.before),
      after = fields.get(check.after),
      first = (data.values[check.before] ?? "").trim(),
      second = (data.values[check.after] ?? "").trim();
    if (
      before &&
      after &&
      !late.has(check.after) &&
      guidedVisible(before, data.values) &&
      guidedVisible(after, data.values) &&
      guidedCalendarDate(first) &&
      guidedCalendarDate(second) &&
      second < first
    )
      late.set(check.after, check.message);
  }
  return late;
}

/** An answer as the document prints it, or null while it is empty, hidden or not valid yet. */
function printed(field: GuidedFieldV2, value: string | undefined, context: Record<string, string>) {
  const answer = (value ?? "").trim();
  if (!answer || !guidedVisible(field, context) || guidedFieldIssue(field, answer)) return null;
  if (field.type === "date") return printedCalendarDate(answer);
  if (field.type === "money_kobo") return formatKobo(answer);
  if (field.type === "select") return field.options?.find((o) => o.value === answer)?.label ?? null;
  if (field.type === "acknowledgement") return null;
  return answer;
}

/**
 * The document a form's answers make from an edition's form text: the edition's own words, each slot
 * filled with its answer as the document prints it, and each choice keeping the passage its answer
 * selects. A slot with no valid answer, and every blank, prints its placeholder, and `unfilled` lists
 * the slots that do, blanks apart. A passage kept while a question is answered prints only once it has
 * an answer the document prints. A repeating row or group prints once for each row of its table; a
 * table with no rows yet prints one row of placeholders, unless it may be left empty, and a table the
 * form hides prints none. The form must fit the text (`formFit`).
 */
export function compileForm(spec: GuidedSpecV2, text: FormText, data: GuidedDataV2) {
  const filling = new Map<string, GuidedFieldV2[]>();
  for (const field of spec.fields)
    for (const token of field.tokens ?? []) filling.set(token, [...(filling.get(token) ?? []), field]);
  const tables = new Map(spec.tables.map((t) => [t.id, t]));
  type Row = { table: GuidedTableV2; values: Record<string, string> };
  const unfilled: string[] = [];
  const note = (name: string) => {
    if (!spec.blanks.includes(name) && !unfilled.includes(name)) unfilled.push(name);
  };
  // A date before the date it must follow is a draft answer: it fills no slot and keeps no passage.
  const late = datesOutOfOrder(spec, data);
  const answerOf = (field: GuidedFieldV2) =>
    late.has(field.id) ? null : printed(field, data.values[field.id], data.values);
  const choice = (span: FormSpan) => {
    const field = spec.fields.find((f) => f.id === span.question);
    if (span.option === null) return field ? answerOf(field) !== null : false;
    const answer = field && guidedVisible(field, data.values) ? (data.values[field.id] ?? "").trim() : "";
    return span.option === "" ? answer === "" : answer === span.option;
  };
  const rowsOf = (table: GuidedTableV2): Record<string, string>[] => {
    if (!guidedVisible(table, data.values)) return [];
    const answers = data.tables[table.id] ?? [];
    return answers.length ? answers : table.minRows > 0 ? [{}] : [];
  };
  // An answer printed within a sentence keeps to one line: its line breaks print as commas. A slot
  // that is a line of its own prints each answer, and each answer's lines, on lines of their own.
  const oneLine = (answer: string) =>
    answer
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(", ");
  const render = (parts: FormInline[], row?: Row): string => {
    const alone = parts.filter((p) => p.kind !== "text" || p.text.trim()).length === 1;
    return parts
      .map((part) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "span") return choice(part.span) ? render(part.parts, row) : "";
        if (spec.blanks.includes(part.name)) return part.placeholder;
        let value: string | null = null;
        if (part.name.startsWith("calc.")) value = spec.calculated?.[part.name]?.(data, row?.values) ?? null;
        else if (part.name.includes(".")) {
          const column = row?.table.columns.find((c) => `${row.table.id}.${c.id}` === part.name);
          value = column ? printed(column, row!.values[column.id], { ...data.values, ...row!.values }) : null;
        } else {
          const answers = (filling.get(part.name) ?? []).map(answerOf).filter((a): a is string => a !== null);
          value = answers.length ? (alone ? answers.join("\n") : answers.join(", ")) : null;
        }
        if (value === null) {
          note(part.name);
          return part.placeholder;
        }
        return alone ? value : oneLine(value);
      })
      .join("");
  };
  const blocks: FormBlock[] = [];
  const id = () => `${GUIDED_V2_PREFIX}${spec.templateId}:${blocks.length + 1}`;
  const walk = (nodes: FormNode[], row?: Row) => {
    for (const node of nodes) {
      if (node.kind === "span") {
        if (choice(node.span)) walk(node.nodes, row);
        continue;
      }
      if (node.kind === "repeat") {
        const table = tables.get(node.table);
        if (table) for (const values of rowsOf(table)) walk(node.nodes, { table, values });
        continue;
      }
      if (node.kind === "heading") {
        const heading = render(node.parts, row).trim();
        if (heading) blocks.push({ id: id(), type: "heading", level: node.level, text: heading, rows: [] });
        continue;
      }
      if (node.kind === "paragraph" || node.kind === "list") {
        const lines = (node.kind === "paragraph" ? node.lines : node.items)
          .map((line) => render(line, row).trim())
          .filter(Boolean);
        if (lines.length) blocks.push({ id: id(), type: node.kind, text: lines.join("\n"), rows: [] });
        continue;
      }
      const rows: string[][] = [node.header.map((cell) => render(cell, row).trim())];
      for (const tableRow of node.rows) {
        if (tableRow.span && !choice(tableRow.span)) continue;
        const table = tableRow.repeat ? tables.get(tableRow.repeat) : undefined;
        if (!table) {
          rows.push(tableRow.cells.map((cell) => render(cell, row).trim()));
          continue;
        }
        for (const values of rowsOf(table))
          rows.push(tableRow.cells.map((cell) => render(cell, { table, values }).trim()));
      }
      blocks.push({ id: id(), type: "table", text: "", rows });
    }
  };
  walk(text.nodes);
  const selectedClauses = spec.fields
    .filter((f) => f.clause && guidedVisible(f, data.values))
    .flatMap((f) => {
      const answer = (data.values[f.id] ?? "").trim();
      return f.options?.some((o) => o.value === answer) ? [`${f.id}=${answer}`] : [];
    });
  return { title: text.title, blocks, selectedClauses, unfilled };
}

/** A form document's block, as the contract holds it: a heading keeps its level, and a table's
 * first row is its header, repeated on each page. */
export type FormDocumentBlock = {
  id: string;
  type: "paragraph" | "list" | "table" | "heading";
  text: string;
  rows: string[][];
  level?: 2 | 3;
  headerRows?: 1;
};
/**
 * The saved document a form's answers make (forms v2): the edition's wording filled in, the passages
 * kept, the answers themselves, and the document's own fields taken from the answers as v1 takes
 * them, so that the documents list and the files show the same names and dates. The note and the
 * formatting are the document's own and carry over from the previous revision.
 */
export function formDocumentContent(
  spec: GuidedSpecV2,
  text: FormText,
  data: GuidedDataV2,
  previous?: {
    fields: { notes: string };
    formatting: { font: "serif" | "sans"; accent: "forest" | "charcoal" };
  },
) {
  const compiled = compileForm(spec, text, data);
  const v = data.values;
  const plain = (key: string, max = 160) => ((v[key] ?? "").length <= max ? (v[key] ?? "") : "");
  const issueDate = guidedCalendarDate(v.issueDate ?? "") ? v.issueDate! : "";
  const due = v.dueDate ?? "";
  const dueDate =
    spec.templateId === "TPL-01" && guidedCalendarDate(due) && (!issueDate || due >= issueDate) ? due : "";
  return {
    fields: {
      issuerName: plain("issuerName"),
      recipientName: plain("recipientName"),
      documentNumber: plain("documentNumber", 80),
      issueDate,
      dueDate,
      notes: previous?.fields.notes ?? GUIDED_DOCUMENT_NOTE,
    },
    blocks: compiled.blocks.map((block): FormDocumentBlock =>
      block.type === "heading"
        ? { id: block.id, type: "heading", level: block.level, text: block.text, rows: [] }
        : block.type === "table"
          ? { ...block, headerRows: 1 }
          : block,
    ),
    selectedClauses: compiled.selectedClauses,
    formatting: previous?.formatting ?? { font: "serif" as const, accent: "forest" as const },
    formAnswers: data,
    unfilled: compiled.unfilled,
  };
}
