/**
 * The project's own words that the redesign replaced with the customer's: the "Instead of" column
 * of the table under "Words" in docs/architecture/frontend-redesign.md. No customer screen shows
 * one. A document's status is still "Draft" and a version is still a version: only these phrasings
 * are refused.
 */
const OLD_WORDS: [name: string, pattern: RegExp][] = [
  ["business draft, draft document", /business draft|draft document/i],
  ["rev 3", /\brev\b/i],
  ["library, catalogue, shelf", /\blibrary\b|\bcatalogue\b|\bshel(f|ves)\b/i],
  ["compliance guidance, source-governed guidance", /compliance guidance|source-governed/i],
  ["requirements checker, check rules", /requirements checker|\bcheck rules\b|\bthe checker\b/i],
  ["open a workspace", /open a workspace/i],
  ["not released", /not released/i],
  ["assessment history, saved assessments", /\bassessments?\b/i],
  ["whole kobo", /whole kobo/i],
];

/** The old words a screen's text holds, each named as the word list names it, with where it was found. */
export function oldWordsIn(text: string): string[] {
  const line = text.replace(/\s+/g, " ");
  return OLD_WORDS.flatMap(([name, pattern]) => {
    const found = pattern.exec(line);
    return found
      ? [`"${name}" in "…${line.slice(Math.max(0, found.index - 40), found.index + found[0].length + 40)}…"`]
      : [];
  });
}
