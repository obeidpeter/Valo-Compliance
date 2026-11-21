import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";
import { claimLocatorMatches } from "./claim-locator";
import { guideBodyBlocks } from "./guidance-document";
import type { GuidePassage, GuidePassages } from "./guidance-passages";

/**
 * A guide's claim map: every sentence of the guide, in order, with what kind of sentence it is and,
 * where it says something about the law, the exact official words it rests on (decision 0017,
 * point 4).
 *
 * The map is checked, not trusted. `buildGuideClaims` refuses a map that leaves any of the guide's
 * words unplaced, quotes words that are not in the passage, gives a place the passage does not
 * bear out, or lets a number stand that the quoted words do not contain. What it returns still
 * has to pass the two reviews and every gate; building a map reviews nothing.
 */
export type GuideSupport = {
  /** The retained passage's id. */
  passage: string;
  /** The quotation runs from the one place these words occur to the end of the next `to`. */
  from: string;
  to: string;
  /** The place in the official text, as a reader would look it up. */
  locator: string;
};
type Bound = { text: string; support: readonly GuideSupport[] };
export type GuideSentence =
  /** Says what an official text says. */
  | (Bound & { kind: "source_statement" })
  /** Valo's reading of an official text, or a caution drawn from it. */
  | (Bound & { kind: "interpretation" })
  /** A practical suggestion. It may point to an official page; it never states a legal duty. */
  | { kind: "optional_practice"; text: string; support?: readonly GuideSupport[] }
  /** Says what the guide itself does not cover or decide. */
  | { kind: "guide_limit"; text: string }
  /** States nothing: it introduces a list or links two sentences. */
  | { kind: "not_a_claim"; text: string };
export type GuideClaimMap = {
  id: string;
  risk: Exclude<PublicationBundle["candidate"]["risk"], "general">;
  sentences: readonly GuideSentence[];
  /**
   * Numbers in the guide that are Valo's own record, not the law's, each with the reason: the day a
   * page was checked, for example. They are left out of the number check and nothing else.
   */
  ownNumbers?: readonly { text: string; why: string }[];
};
type Claim = PublicationBundle["candidate"]["claims"][number];
type Source = PublicationBundle["sources"][number];

const DAY = 86_400_000;
/** A retained source is treated as fresh for 30 days after it was fetched, as the business-name
 * binding treats one (modules/sources/business-name-candidate-binding.ts). */
const freshDays = 30;

function fail(code: string): never {
  throw Error(code);
}
const preview = (text: string) => text.slice(0, 60);

/** The exact words of a passage from the one place `from` occurs to the end of the next `to`. */
function quotation(passage: GuidePassage, from: string, to: string, guide: string) {
  const start = passage.text.indexOf(from);
  if (start < 0 || passage.text.indexOf(from, start + 1) >= 0)
    fail(`GUIDE_CLAIM_QUOTE_ANCHOR:${guide}:${passage.id}:${preview(from)}`);
  const end = passage.text.indexOf(to, start);
  if (end < 0) fail(`GUIDE_CLAIM_QUOTE_ANCHOR:${guide}:${passage.id}:${preview(to)}`);
  return passage.text.slice(start, end + to.length);
}

const units = "days?|weeks?|months?|years?|per cent|percent|naira|kobo";
const numberWords =
  "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|twenty-one|twenty-eight|thirty|sixty|ninety";
/**
 * The numbers a sentence states: every run of digits, and a number written as a word before a unit
 * of time or money ("six years"). A section number counts too: it has to be borne out like any other.
 */
export function statedNumbers(text: string) {
  const digits = [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0]);
  const worded = [...text.matchAll(new RegExp(`\\b(${numberWords})\\s+(?:${units})\\b`, "gi"))].map((m) =>
    m[1]!.toLowerCase(),
  );
  return [...new Set([...digits, ...worded])];
}

/**
 * A locator may name the Gazette's printed page ("printed page A405"). The locator check cannot
 * read that from a passage's words, so it is held to the pages recorded for the passage when it was
 * extracted ("PDF405–406 / A405–A406").
 */
function printedPageRecorded(passage: GuidePassage, locator: string) {
  const named = locator.match(/printed page A(\d+)/);
  if (!named) return !/printed page/i.test(locator);
  const recorded = passage.recordedLocator.match(/\/\s*A\s?(\d+)(?:\s*[–-]\s*A?\s?(\d+))?/);
  if (!recorded) return false;
  const page = Number(named[1]),
    first = Number(recorded[1]),
    last = Number(recorded[2] ?? recorded[1]);
  return page >= first && page <= last;
}

/** Whether words contain a stated number as a number of its own, not as part of a longer one. */
function holdsNumber(words: string, n: string) {
  const exact = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /\d/.test(n)
    ? new RegExp(`(?<![\\d.,])${exact}(?!\\d)`).test(words)
    : new RegExp(`\\b${exact}\\b`, "i").test(words);
}

export type BuiltGuideClaims = {
  claims: Claim[];
  sources: Source[];
  /** Sentences that could not be bound because their passage is not among those supplied. */
  missingEvidence: string[];
  /** Every https address the guide's own words give, for the policy's host list. */
  linkHosts: string[];
  /** The whole classification, kept with the candidate as the record of its claim scope. */
  scope: {
    guide: string;
    sentences: number;
    byKind: Record<GuideSentence["kind"], number>;
    mapDigest: string;
  };
};

export function buildGuideClaims(
  map: GuideClaimMap,
  body: string,
  passages: GuidePassages,
): BuiltGuideClaims {
  const guide = map.id;
  // The guide's own words as its document holds them: links written out, a list's items on lines.
  const text = guideBodyBlocks(guide, body)
    .map((b) => b.text)
    .join("\n");
  const claims: Claim[] = [],
    used = new Map<string, GuidePassage>(),
    missingEvidence: string[] = [];
  const byKind: BuiltGuideClaims["scope"]["byKind"] = {
    source_statement: 0,
    interpretation: 0,
    optional_practice: 0,
    guide_limit: 0,
    not_a_claim: 0,
  };
  const own = map.ownNumbers ?? [];
  for (const o of own) {
    if (!o.why.trim() || !text.includes(o.text))
      fail(`GUIDE_CLAIM_MAP_OWN_NUMBER:${guide}:${preview(o.text)}`);
  }

  let at = 0;
  for (const sentence of map.sentences) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    if (!sentence.text.trim() || !text.startsWith(sentence.text, at))
      fail(`GUIDE_CLAIM_MAP_SENTENCE:${guide}:${preview(sentence.text)}`);
    at += sentence.text.length;
    byKind[sentence.kind]++;

    const legal = sentence.kind === "source_statement" || sentence.kind === "interpretation";
    const support = "support" in sentence ? (sentence.support ?? []) : [];
    if (legal && !support.length) fail(`GUIDE_CLAIM_MAP_UNSUPPORTED:${guide}:${preview(sentence.text)}`);

    // The sentence's numbers, less the parts that are Valo's own record.
    const stated = statedNumbers(own.reduce((t, o) => t.split(o.text).join(" "), sentence.text));
    const quotes: string[] = [];
    let unbound = false;
    for (const s of support) {
      const passage = passages(s.passage);
      if (!passage) {
        unbound = true;
        missingEvidence.push(
          `${guide}: the passage ${s.passage} is not among the passages supplied, so this sentence is not bound to it: "${sentence.text}"`,
        );
        continue;
      }
      const quote = quotation(passage, s.from, s.to, guide);
      if (!claimLocatorMatches(passage.text, quote, s.locator) || !printedPageRecorded(passage, s.locator))
        fail(`GUIDE_CLAIM_LOCATOR:${guide}:${s.passage}:${s.locator}`);
      used.set(passage.id, passage);
      quotes.push(quote);
      claims.push({
        text: sentence.text,
        kind: sentence.kind as Claim["kind"],
        sourceId: passage.id,
        quote,
        locator: s.locator,
        // The gate checks each of these against the quotation again.
        numbers: stated.filter((n) => /\d/.test(n) && holdsNumber(quote, n)),
      });
    }
    if (!stated.length || unbound) continue;
    // A number stands only where the quoted words, or the place given for them, contain it. A
    // sentence that only suggests a practice or limits the guide has no quotation to bear one out.
    const borne = (n: string) =>
      quotes.some((q) => holdsNumber(q, n)) || support.some((s) => holdsNumber(s.locator, n));
    const unsupported = stated.filter((n) => !borne(n));
    if (unsupported.length)
      fail(`GUIDE_CLAIM_NUMBER_UNSUPPORTED:${guide}:${unsupported.join(",")}:${preview(sentence.text)}`);
  }
  if (text.slice(at).trim()) fail(`GUIDE_CLAIM_MAP_INCOMPLETE:${guide}:${preview(text.slice(at).trim())}`);

  const sources: Source[] = [...used.values()].map((p) => ({
    id: p.id,
    url: p.instrument.url,
    title: p.instrument.title,
    issuingBody: p.instrument.issuingBody,
    text: p.text,
    hash: p.hash,
    jurisdiction: "NG",
    retrievedAt: p.instrument.retrievedAt,
    freshUntil: new Date(Date.parse(p.instrument.retrievedAt) + freshDays * DAY).toISOString(),
    effectiveFrom: p.instrument.effectiveFrom,
    effectiveTo: null,
    // No source decision exists yet: nothing has approved this text, confirmed that it is the
    // operative text or resolved its amendments (decision 0017, point 2).
    status: "held",
    operativeTextConfirmed: false,
    amendmentsResolved: false,
  }));
  for (const s of sources) if (sha256(s.text) !== s.hash) fail(`GUIDE_CLAIM_SOURCE_HASH:${guide}:${s.id}`);

  const linkHosts = [...new Set([...text.matchAll(/https:\/\/[^\s)]+/g)].map((m) => new URL(m[0]).hostname))];
  if (/http:\/\//.test(text)) fail(`GUIDE_CLAIM_MAP_LINK_NOT_HTTPS:${guide}`);
  return {
    claims,
    sources,
    missingEvidence,
    linkHosts,
    scope: { guide, sentences: map.sentences.length, byKind, mapDigest: digest(map) },
  };
}
