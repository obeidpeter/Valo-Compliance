import { readFile } from "node:fs/promises";

/**
 * The copy of the AI provider's terms a preparation reads, read when the preparation reaches it: a
 * file an operator saved with `capture-provider-terms`, or a copy already in hand. Either way the
 * preparer checks the copy's shape itself, the same way, and refuses one older than a day; so the
 * reader gives what `JSON.parse` gives.
 */
export type TermsCopy = () => Promise<ReturnType<typeof JSON.parse>>;
export const termsFile =
  (path: string): TermsCopy =>
  async () =>
    JSON.parse(await readFile(path, "utf8"));
export const termsInHand =
  (copy: unknown): TermsCopy =>
  async () =>
    copy;
