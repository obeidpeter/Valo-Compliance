import { documentInput } from "../../lib/valo-validation";

/**
 * A free staff-library template's released text as a document typed from it
 * (docs/architecture/library-entries.md, slice 3): each paragraph a block, and a run of lines whose
 * cells a bar separates, as the library writes a table, a table. Null when the text does not fit a
 * document: more than 100 blocks, a block over 8,000 characters, or a table over 100 rows of 10 cells.
 */
export function libraryCopy(title: string, body: string) {
  const blocks: { id: string; type: "paragraph" | "table"; text: string; rows: string[][] }[] = [];
  for (const part of body.split(/\n\s*\n/)) {
    const text = part.trim();
    if (!text) continue;
    const lines = text.split("\n").map((line) => line.trim());
    const id = `library-${blocks.length + 1}`;
    if (lines.every((line) => line.includes(" | ")))
      blocks.push({ id, type: "table", text: "", rows: lines.map((line) => line.split(" | ")) });
    else blocks.push({ id, type: "paragraph", text, rows: [] });
  }
  const copy = documentInput.safeParse({
    title,
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks,
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
  return blocks.length > 0 && copy.success ? copy.data : null;
}
