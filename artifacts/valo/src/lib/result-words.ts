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
    const held = HELD.exec(gap);
    const reason = held ? HOLDS[held[2]!] : undefined;
    if (held && reason) return [`Rule ${held[1]} is on hold and gives no result here: ${reason}.`];
    return [gap];
  });
}
