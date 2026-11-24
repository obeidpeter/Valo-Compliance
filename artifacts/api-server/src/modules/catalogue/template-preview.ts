// How a template's page previews its text (DOC-004): the opening of it, never all of it.

/** About how much of a template's text its page shows. */
const PREVIEW_LENGTH = 700;
/**
 * The opening of a template's text, as its page previews it (DOC-004): whole paragraphs up to about
 * 700 characters, and a first paragraph longer than that cut at a word, so that the page shows what
 * the template is like and not all of it. The whole text is in its file, after the account gate for a
 * free template (DOC-005) and the purchase for a premium one. A staff-library premium template's text
 * here is its short public description, so it is shown whole.
 */
export function templatePreview(body: string) {
  const paragraphs = body.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const length = kept.join("\n\n").length;
    if (kept.length && length + 2 + paragraph.length > PREVIEW_LENGTH) break;
    kept.push(paragraph);
  }
  let text = kept.join("\n\n");
  const cut = text.length > PREVIEW_LENGTH;
  if (cut) text = text.slice(0, Math.max(text.lastIndexOf(" ", PREVIEW_LENGTH), 1)).trimEnd();
  return cut || kept.length < paragraphs.length ? `${text} …` : text;
}

/** A released document's text in reading order, as its page previews it: each block's text, and a
 * table's rows one to a line, their cells separated by a bar. */
export function releasedDocumentText(content: {
  blocks: readonly { text: string; rows: readonly (readonly string[])[] }[];
}) {
  return content.blocks
    .map((block) =>
      [block.text, ...block.rows.map((row) => row.join(" | "))].filter((t) => t.trim()).join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A premium template's public preview, generated separately from its text (DOC-004): the sample
 * fields its text marks for the buyer to fill, by their names, and never its wording, which is the
 * buyer's alone.
 */
export function sampleFieldsPreview(text: string) {
  const fields = [
    ...new Set((text.match(/\[[^\]\n]{2,60}\]/g) ?? []).map((field) => field.slice(1, -1).trim())),
  ]
    .filter((field) => /\p{L}/u.test(field))
    .slice(0, 12);
  return fields.length
    ? [`SAMPLE FIELDS: ${fields.join("; ")} [your information]`]
    : ["SAMPLE FIELD: Business name [your information]"];
}
