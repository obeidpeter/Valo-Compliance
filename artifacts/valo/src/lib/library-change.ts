import { formatDay } from "./format";

/**
 * The words for what changed in a staff-library version that follows an earlier release
 * (docs/architecture/guidance-currency.md, slice 3, CMP-005). The staff library and the owner's panel ask
 * for the note before such a release; the entry's page shows it while that version is published. The
 * words are the owner's to confirm.
 */
export const changeLabel = "What changed in this version?";

/** What the staff library says under its question. */
export function changeHint(previousRelease: number) {
  return `Version ${previousRelease} was released before. Readers see this note on the entry's page, and customers who hold or used the template are told it. In 20 to 1,000 characters.`;
}

/** The line above the text of an entry whose published version says what changed. */
export function updatedLine(change: { on: string; note: string }) {
  const note = change.note.trim();
  return `Updated on ${formatDay(change.on)}. What changed: ${note}${/[.!?]$/.test(note) ? "" : "."}`;
}
