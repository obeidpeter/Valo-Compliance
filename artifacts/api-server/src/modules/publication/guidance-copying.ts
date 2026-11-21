/**
 * "Official text is explained, not copied" as a measurement (decision 0017, point 3).
 *
 * A guide's own words are compared with every official passage it cites, and the longest run of
 * words they share is counted. A guide that repeats more than the limit in a row fails.
 *
 * This measures repeated wording and nothing else. It gives no opinion on copyright, and a guide
 * that passes it has cleared no right by doing so.
 */
export const GUIDE_SHARED_WORDS_LIMIT = 20;

/** A text as the words a reader would say aloud: case, spacing and punctuation set aside. */
export const comparedWords = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The longest run of words two texts share, and the run itself as the first text has it. */
export function longestSharedRun(own: string, official: string) {
  const a = comparedWords(own),
    b = comparedWords(official);
  let words = 0,
    end = 0,
    previous = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      const run = previous[j - 1]! + 1;
      current[j] = run;
      if (run > words) {
        words = run;
        end = i;
      }
    }
    previous = current;
  }
  return { words, run: a.slice(end - words, end).join(" ") };
}

export type GuideCopyingMeasure = {
  limitWords: number;
  /** The longest run the guide shares with any one passage. */
  longestSharedWords: number;
  withinLimit: boolean;
  measured: { sourceId: string; sourceHash: string; sharedWords: number }[];
};

/** Measures a guide's own words, as its page shows them, against each official passage it cites. */
export function measureGuideCopying(
  ownWords: string,
  sources: readonly { id: string; hash: string; text: string }[],
  limitWords = GUIDE_SHARED_WORDS_LIMIT,
): GuideCopyingMeasure {
  const measured = sources.map((source) => ({
    sourceId: source.id,
    sourceHash: source.hash,
    sharedWords: longestSharedRun(ownWords, source.text).words,
  }));
  const longestSharedWords = Math.max(0, ...measured.map((m) => m.sharedWords));
  return { limitWords, longestSharedWords, withinLimit: longestSharedWords <= limitWords, measured };
}
