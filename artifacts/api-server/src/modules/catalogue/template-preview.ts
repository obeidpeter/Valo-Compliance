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
