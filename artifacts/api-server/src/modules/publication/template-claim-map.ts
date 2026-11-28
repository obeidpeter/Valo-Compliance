import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";
import { claimLocatorMatches } from "./claim-locator";
import {
  holdsNumber,
  printedPageRecorded,
  quotation,
  statedNumbers,
  type GuideSupport,
} from "./guidance-claim-map";
import type { GuidePassage, GuidePassages } from "./guidance-passages";

/**
 * A template's claim map (docs/architecture/reviewed-route.md, part 4): every sentence of the
 * template's own words, in order, with what kind of sentence it is and, where it says something
 * about the law, the exact official words it rests on.
 *
 * As a guide's map is, it is checked, not trusted. `buildTemplateClaims` refuses a map that leaves
 * any of the template's words unplaced, quotes words that are not in their passage, gives a place
 * the passage does not bear out, or lets a number stand that the quoted words do not contain. What
 * it returns still has to pass the two reviews and every gate; building a map reviews nothing.
 */
type Bound = { text: string; support: readonly GuideSupport[] };
export type TemplateSentence =
  /** Says what an official text says. */
  | (Bound & { kind: "source_statement" })
  /** Valo's reading of an official text, or a caution drawn from it. */
  | (Bound & { kind: "interpretation" })
  /** A term the parties agree. It says nothing about what the law requires. */
  | { kind: "party_term"; text: string }
  /** A practical suggestion, such as how to complete a blank. It may point to a passage; it never
   * states a legal duty. */
  | { kind: "optional_practice"; text: string; support?: readonly GuideSupport[] }
  /** Says what the template itself does not cover, decide or do. */
  | { kind: "template_limit"; text: string }
  /** States nothing: a title, a heading, a label, a blank or a signature line. */
  | { kind: "not_a_claim"; text: string };

/** What a contract template must expose (EDP-005), in Valo's own words. */
export type ContractExposure = {
  /** Who the template assumes its parties are, and how they stand to each other. */
  parties: readonly string[];
  /** What it assumes about its use. */
  use: readonly string[];
  /** The clauses and blanks it leaves for the parties to settle. */
  openClauses: readonly string[];
};

export type TemplateClaimMap = {
  id: string;
  risk: Exclude<PublicationBundle["candidate"]["risk"], "general">;
  /** Present for a contract, and then complete (EDP-005). A map classed as contracts needs it. */
  contract?: ContractExposure;
  sentences: readonly TemplateSentence[];
  /**
   * Numbers in the template that are its own, not the law's, each with the reason: a clause's
   * number, for example. They are left out of the number check and nothing else.
   */
  ownNumbers?: readonly { text: string; why: string }[];
};
type Claim = PublicationBundle["candidate"]["claims"][number];
type Source = PublicationBundle["sources"][number];
type Block = { type: string; text: string; rows: string[][] };

const DAY = 86_400_000;
/** A retained source is treated as fresh for 30 days after it was fetched, as a guide's is. */
const freshDays = 30;
/** The kinds that say something about the law, and so must rest on a passage. */
const aboutTheLaw: ReadonlySet<TemplateSentence["kind"]> = new Set(["source_statement", "interpretation"]);
/** The kinds that never rest on a passage. */
const unsupported: ReadonlySet<TemplateSentence["kind"]> = new Set([
  "party_term",
  "template_limit",
  "not_a_claim",
]);

function fail(code: string): never {
  throw Error(code);
}
const preview = (text: string) => text.slice(0, 60);

/**
 * A template's own words in reading order, as its document holds them: each paragraph, and each
 * cell of a table, row by row, on lines of their own.
 */
export function templateWords(blocks: readonly Block[]) {
  return blocks.flatMap((block) => (block.type === "table" ? block.rows.flat() : [block.text])).join("\n");
}

export type BuiltTemplateClaims = {
  claims: Claim[];
  sources: Source[];
  /** Sentences that could not be bound because their passage is not among those supplied. */
  missingEvidence: string[];
  /** Whether the map places any sentence about the law. A template that states none is not this
   * policy's: it is released under the templates' own policy, or not at all. */
  statesLaw: boolean;
  /** For a contract, what it assumes and leaves open, as the candidate's assumptions (EDP-005). */
  assumptions: string[];
  /** The whole classification, kept with the candidate as the record of its claim scope. */
  scope: {
    template: string;
    sentences: number;
    byKind: Record<TemplateSentence["kind"], number>;
    mapDigest: string;
  };
};

/** What a contract template exposes, as the candidate carries it. */
export function contractAssumptions(contract: ContractExposure) {
  return [
    ...contract.parties,
    ...contract.use,
    ...contract.openClauses.map((clause) => `Left for the parties to settle: ${clause}`),
  ];
}

export function buildTemplateClaims(
  map: TemplateClaimMap,
  blocks: readonly Block[],
  passages: GuidePassages,
): BuiltTemplateClaims {
  const template = map.id;
  const text = templateWords(blocks);
  const claims: Claim[] = [],
    used = new Map<string, GuidePassage>(),
    missingEvidence: string[] = [];
  const byKind: BuiltTemplateClaims["scope"]["byKind"] = {
    source_statement: 0,
    interpretation: 0,
    party_term: 0,
    optional_practice: 0,
    template_limit: 0,
    not_a_claim: 0,
  };

  // A contract states what it assumes and what it leaves open, or it is not mapped (EDP-005).
  if (map.risk === "contracts" && !map.contract) fail(`TEMPLATE_CONTRACT_EXPOSURE_MISSING:${template}`);
  if (map.contract) {
    for (const list of [map.contract.parties, map.contract.use, map.contract.openClauses])
      if (!list.length || list.some((line) => !line.trim() || line !== line.trim()))
        fail(`TEMPLATE_CONTRACT_EXPOSURE_MISSING:${template}`);
  }
  const own = map.ownNumbers ?? [];
  for (const o of own) {
    if (!o.why.trim() || !text.includes(o.text))
      fail(`TEMPLATE_CLAIM_MAP_OWN_NUMBER:${template}:${preview(o.text)}`);
  }

  let at = 0;
  for (const sentence of map.sentences) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    if (!sentence.text.trim() || !text.startsWith(sentence.text, at))
      fail(`TEMPLATE_CLAIM_MAP_SENTENCE:${template}:${preview(sentence.text)}`);
    at += sentence.text.length;
    if (!(sentence.kind in byKind)) fail(`TEMPLATE_CLAIM_MAP_KIND:${template}:${preview(sentence.text)}`);
    byKind[sentence.kind]++;

    const support = "support" in sentence ? (sentence.support ?? []) : [];
    if (aboutTheLaw.has(sentence.kind) && !support.length)
      fail(`TEMPLATE_CLAIM_MAP_UNSUPPORTED:${template}:${preview(sentence.text)}`);
    // A term, a limit or a heading says nothing about the law, so it rests on nothing.
    if (unsupported.has(sentence.kind) && "support" in sentence)
      fail(`TEMPLATE_CLAIM_MAP_SUPPORT_NOT_ALLOWED:${template}:${preview(sentence.text)}`);

    // The sentence's numbers, less the parts that are the template's own.
    const stated = statedNumbers(own.reduce((t, o) => t.split(o.text).join(" "), sentence.text));
    const quotes: string[] = [];
    let unbound = false;
    for (const s of support) {
      const passage = passages(s.passage);
      if (!passage) {
        unbound = true;
        missingEvidence.push(
          `${template}: the passage ${s.passage} is not among the passages supplied, so this sentence is not bound to it: "${sentence.text}"`,
        );
        continue;
      }
      let quote: string;
      try {
        quote = quotation(passage, s.from, s.to, template);
      } catch (error) {
        fail((error as Error).message.replace(/^GUIDE_/, "TEMPLATE_"));
      }
      if (!claimLocatorMatches(passage.text, quote, s.locator) || !printedPageRecorded(passage, s.locator))
        fail(`TEMPLATE_CLAIM_LOCATOR:${template}:${s.passage}:${s.locator}`);
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
    // A number stands only where the quoted words, or the place given for them, contain it. A term,
    // a limit or a heading has no quotation to bear one out: its numbers must be the template's own.
    const borne = (n: string) =>
      quotes.some((q) => holdsNumber(q, n)) || support.some((s) => holdsNumber(s.locator, n));
    const unborne = stated.filter((n) => !borne(n));
    if (unborne.length)
      fail(`TEMPLATE_CLAIM_NUMBER_UNSUPPORTED:${template}:${unborne.join(",")}:${preview(sentence.text)}`);
  }
  if (text.slice(at).trim())
    fail(`TEMPLATE_CLAIM_MAP_INCOMPLETE:${template}:${preview(text.slice(at).trim())}`);

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
    // No source decision exists yet: the candidate's builder gives each the one its amendment
    // record supports (decision 0017, point 2).
    status: "held",
    operativeTextConfirmed: false,
    amendmentsResolved: false,
  }));
  for (const s of sources)
    if (sha256(s.text) !== s.hash) fail(`TEMPLATE_CLAIM_SOURCE_HASH:${template}:${s.id}`);
  // A bundle's schema trims its strings. Words that would change under it could not stay bound to
  // the checksums taken of them here.
  for (const words of [...sources.map((s) => s.text), ...claims.flatMap((c) => [c.text, c.quote, c.locator])])
    if (words !== words.trim()) fail(`TEMPLATE_CLAIM_NOT_TRIMMED:${template}:${preview(words.trim())}`);
  if (/https?:\/\//.test(text)) fail(`TEMPLATE_CLAIM_MAP_LINK:${template}`);

  return {
    claims,
    sources,
    missingEvidence,
    statesLaw: byKind.source_statement + byKind.interpretation > 0,
    assumptions: map.contract ? contractAssumptions(map.contract) : [],
    scope: { template, sentences: map.sentences.length, byKind, mapDigest: digest(map) },
  };
}
