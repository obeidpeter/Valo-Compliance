import type { AssessmentItem } from "@workspace/api-client-react";
import { formatDay } from "./format";

/**
 * What a result of the requirements check says about itself, in the site's words.
 *
 * A result carries a notice and a list of what it does not cover, written by the rules engine in
 * the project's own words. Both are part of the result and of its reference, and a saved result
 * keeps the ones it was saved with. So the engine's sentences are left as they are, and the screen
 * says each one plainly. A sentence this file does not know is shown as it was sent, so that
 * nothing the engine says is ever dropped.
 */

/**
 * A result's rules version, as the screen prints it. The engine names a set of rules by a code of
 * 64 characters. Its first twelve are enough to quote, as with a result's reference; the whole code
 * stays in the element's title. Any other name is printed whole.
 */
export const shortRulesVersion = (version: string) =>
  /^[0-9a-f]{64}$/.test(version) ? version.slice(0, 12) : version;

/** The engine's notice on every result. */
const NOTICE =
  "Conditional source-governed guidance, not legal certification. Unknown answers never establish exemption.";

/** A result's notice, as the screen says it. */
export function resultNotice(sent: string): string {
  return sent === NOTICE
    ? "This is guidance that depends on your answers. It is not a legal certificate. A missing or unknown answer never means that you are exempt."
    : sent;
}

/** The engine's sentence on a result with nothing in it. The screen already says so above the list,
 * in its own words ("No published rule covers these answers yet"), so the list leaves it out. */
const NOTHING_FOUND =
  "No eligible released rules are available for these answers. This is not a finding that no duties apply.";
const PLACES =
  /^State\/FCT and LGA coverage is not comprehensive\. Confirm location-specific requirements for (.+)\.$/;
const SECTORS =
  "High-impact healthcare, financial services and energy activities require activity-specific released evidence.";
/** CMP-003 and RUL-006: the area and the industries the answers name that no published rule covers. */
const LOCAL = /^No released rule covers local requirements for (.+)\.$/;
const INDUSTRY = /^No released rule covers requirements specific to (.+)\.$/;

/** Why the engine holds a rule back, by its own reason. */
const HOLDS: Record<string, string> = {
  "Rule is not released": "it is not published",
  "Synthetic fixture is not Nigerian publication evidence": "it is a test rule, not a published one",
  "No trusted eligible publication manifest": "its publication could not be confirmed",
  "Evidence is stale or not yet checked":
    "its review date has passed, or its sources have not been checked yet",
  "Outside effective period": "it is not in force on the date of this check",
  "Conflicting released versions require editorial resolution": "two published versions of it disagree",
  "The released evaluator version does not match this implementation":
    "it needs a different version of the check from the one this site runs",
};
/** The engine's reasons for holding a rule back that the screen says in its own words. */
export const KNOWN_HOLD_REASONS = Object.keys(HOLDS);
const HELD = /^([^:]+): (.+)$/;

/**
 * What a result does not cover, as the screen lists it: each of the engine's sentences in plain
 * words, in the engine's order. With `nothingShown`, the screen has already said that no published
 * rule covers the answers, and the engine's sentence for that is left out.
 */
export function resultGaps(sent: readonly string[], nothingShown: boolean): string[] {
  return sent.flatMap((gap) => {
    if (gap === NOTHING_FOUND)
      return nothingShown
        ? []
        : ["No published rule covers these answers. That is not a finding that nothing applies to you."];
    const place = PLACES.exec(gap);
    if (place)
      return [
        `Valo does not cover every state, the FCT and every local government area. Check what applies in ${place[1] === "your location" ? "your area" : place[1]} with the authorities there.`,
      ];
    if (gap === SECTORS)
      return [
        "Healthcare, financial services and energy are covered only where a published rule is about that activity.",
      ];
    const local = LOCAL.exec(gap);
    if (local) return [`Valo has not checked the local government's own requirements for ${local[1]}.`];
    const industry = INDUSTRY.exec(gap);
    if (industry) return [`Valo has not checked requirements specific to ${industry[1]}.`];
    const held = HELD.exec(gap);
    const reason = held ? HOLDS[held[2]!] : undefined;
    if (held && reason) return [`Rule ${held[1]} is on hold and gives no result here: ${reason}.`];
    return [gap];
  });
}

type Figured = Pick<AssessmentItem, "label" | "sources" | "figures">;
/** What a customer, and the owner signing a rule, read each kind of figure as. */
export const FIGURE_LABELS = {
  fee: "Government fee",
  deadline: "Deadline",
  rate: "Rate",
  threshold: "Threshold",
} as const;
/** CMP-006: what a requirement may need confirmed when its rule records no figure of that kind. */
const CONFIRM = "Confirm with the authority.";

/**
 * CMP-006: the fees, deadlines, rates and thresholds a requirement shows, each in its source's words
 * with the passage it rests on, and "Confirm with the authority" for the fees and deadlines its rule
 * records none of. A requirement these answers do not indicate shows none. Nothing here schedules a
 * date.
 */
export function requirementFigures(item: Figured): { label: string; words: string; source?: string }[] {
  if (item.label === "Not indicated by these answers") return [];
  const figures = item.figures ?? [];
  const shown: { label: string; words: string; source?: string }[] = figures.map((figure) => {
    const source = item.sources.find((s) => s.id === figure.sourceId);
    return {
      label: FIGURE_LABELS[figure.kind],
      words: figure.words,
      ...(source && { source: `${source.title}, ${source.locator}` }),
    };
  });
  const fee = figures.some((figure) => figure.kind === "fee"),
    deadline = figures.some((figure) => figure.kind === "deadline");
  if (!fee && !deadline) shown.push({ label: "Fees and deadlines", words: CONFIRM });
  else if (!fee) shown.push({ label: "Fees", words: CONFIRM });
  else if (!deadline) shown.push({ label: "Deadlines", words: CONFIRM });
  return shown;
}

/** CMP-007: the authority's official page for a requirement, as its rule records it. One these answers do not
 * indicate links no page, as it shows no figure. */
export const requirementRoute = (item: Pick<AssessmentItem, "label" | "officialRoute">) =>
  item.label === "Not indicated by these answers" ? undefined : item.officialRoute;

/**
 * CMP-004: a requirement's dates, each with its own label: when its sources were checked, and how
 * and when it was released. "Source checked" and "AI reviewed" are the specification's labels. An
 * owner-signed rule is signed in the transaction that publishes it, so one date says both. A review on
 * the reviewed route records no date of its own, so none is given for it. Nothing says a professional
 * reviewed it, since no such review is recorded. A result saved before dates were recorded shows none.
 */
export function requirementDates(item: Pick<AssessmentItem, "sourceCheckedAt" | "publication">): string[] {
  const dates: string[] = [];
  if (item.sourceCheckedAt) dates.push(`Source checked on ${formatDay(item.sourceCheckedAt)}`);
  if (item.publication)
    dates.push(
      item.publication.route === "owner_signoff"
        ? `Signed off by the Valo development owner and published on ${formatDay(item.publication.publishedAt)}`
        : `AI reviewed, and published on ${formatDay(item.publication.publishedAt)}`,
    );
  return dates;
}
