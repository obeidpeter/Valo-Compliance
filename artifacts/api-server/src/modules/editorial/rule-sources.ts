import { allSourceLeads } from "@workspace/valo-core";
import {
  AMENDMENT_RECORD_DAYS,
  guideSourceDecision,
  type AmendmentRecord,
  type GuidePassages,
} from "../publication";
import type { CurrentSourceCapture } from "../sources";
import type { OwnerRuleCandidate } from "./owner-rule-candidates";

const day = 86_400_000;
/**
 * What binding a rule's sources reads of a capture: the official address it is a copy of, when it was
 * checked and its snapshot. The passages are read from the captures' text beforehand.
 */
export type RuleSourceCapture = Pick<CurrentSourceCapture, "leadId" | "url" | "snapshotId" | "checkedAt">;
/** The guidance policy's point 7: no more than this many words in a row from a passage. */
export const OWNER_RULE_QUOTE_WORDS = 20;
export const unique = <T>(values: T[]) => [...new Set(values)];
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

/**
 * A prepared rule's sources bound to today's captures, as both routes that release a rule bind them:
 * the owner's sign-off (decision 0020) and the reviewed route. Each source is read from the capture of
 * its registered official address, its passage is found in that capture, the words the rule quotes
 * must be in it, and its amendment record decides whether it is current (`guideSourceDecision`).
 * What holds the rule is listed, and the sources whose own holds already say why they are not
 * resolved. Nothing is read or written.
 *
 * The rule's source check is the oldest of its captures; with none at all it is dated `now`, so its
 * scenarios can still be shown, and it is held. It stays fresh for 30 days (90 for `general` risk),
 * and no longer than its amendment records do.
 */
export function bindRuleSources(
  candidate: OwnerRuleCandidate,
  input: {
    captures: readonly RuleSourceCapture[];
    passages: GuidePassages;
    records: readonly AmendmentRecord[];
    now: Date;
  },
) {
  const holds: string[] = [];
  /** The sources whose own holds already say why they are not resolved. */
  const explained = new Set<string>();
  const hold = (sourceId: string, text: string) => {
    holds.push(text);
    explained.add(sourceId);
  };
  const parts = candidate.sources.map((source) => {
    const lead = allSourceLeads.find((l) => l.id === source.leadId);
    const capture = input.captures.find((c) => c.leadId === source.leadId && c.url === lead?.url);
    const found = capture ? input.passages(source.passageId) : undefined;
    const passage = found && found.instrument.url === lead?.url ? found : undefined;
    const title = passage?.instrument.title ?? lead?.title ?? source.passageId;
    const quotes = [
      source.quote,
      ...candidate.claims.filter((c) => c.sourceId === source.id).map((c) => c.quote),
    ];
    if (!lead) hold(source.id, `Passage ${source.passageId} is not read from a registered official source.`);
    else if (!capture)
      hold(source.id, `${title} has no copy of its official source checked within the last day.`);
    else if (!passage) hold(source.id, `Today's copy of ${title} does not hold passage ${source.passageId}.`);
    else if (quotes.some((q) => !passage.text.includes(q)))
      holds.push(`${title}: passage ${source.passageId} does not hold the words the rule quotes.`);
    for (const quote of unique(quotes))
      if (wordCount(quote) > OWNER_RULE_QUOTE_WORDS)
        holds.push(
          `${title}: a quotation is ${wordCount(quote)} words; the guidance policy allows ${OWNER_RULE_QUOTE_WORDS} in a row.`,
        );
    const decision = passage ? guideSourceDecision(passage, input.now, input.records, quotes) : undefined;
    for (const reason of decision?.reasons ?? []) hold(source.id, `${title}: ${reason}.`);
    const record = passage ? input.records.find((r) => r.instrument === passage.instrument.id) : undefined;
    return { source, lead, capture, passage, title, decision, record };
  });
  const checks = parts.flatMap((p) => (p.capture ? [Date.parse(p.capture.checkedAt)] : []));
  const checkedAt = new Date(checks.length ? Math.min(...checks) : +input.now);
  const searches = parts.flatMap((p) => p.record?.searches.map((s) => Date.parse(s.searchedAt)) ?? []);
  const freshUntil = new Date(
    Math.min(
      +checkedAt + (candidate.risk === "general" ? 90 : 30) * day,
      ...(searches.length ? [Math.min(...searches) + AMENDMENT_RECORD_DAYS * day] : []),
    ),
  ).toISOString();
  const passageText = (p: (typeof parts)[number]) => p.passage?.text ?? p.source.quote;
  return { parts, holds, explained: [...explained], checkedAt, freshUntil, passageText };
}
