import type { GuidedField } from "@workspace/valo-core/guided";
import { guidedFieldIssue } from "@workspace/valo-core/guided-runtime";
import { koboToNaira, nairaToKobo } from "./checker";

/**
 * A money question as the editor asks it. The questions' definitions ask for whole kobo, which is
 * how an amount is stored and checked. A customer thinks in naira, so the editor takes naira and
 * stores the same amount in kobo, worked out from the digits alone: nothing is rounded or guessed.
 */

/** An amount as it is stored: whole kobo, with no sign, point or leading zero. */
const KOBO = /^(0|[1-9]\d{0,23})$/;

/** What the questions' own check says of an answer that is not whole kobo. */
const NOT_KOBO = guidedFieldIssue({ id: "", label: "", type: "money_kobo", required: true }, "x");
/** What the editor says of it instead, since the customer types naira. */
export const NOT_AN_AMOUNT = "Enter an amount in naira, such as 1500 or 1500.50.";

/** What goes in the box for a stored answer: an amount as naira ("1500.50"), anything else as it is. */
export const shownAmount = (stored: string) => (KOBO.test(stored) ? koboToNaira(stored) : stored);

/**
 * What is stored for what was typed. An amount in naira becomes whole kobo. Anything else is stored
 * as typed, so it stays on screen and the questions' check refuses it. Digits too long to be an
 * amount in naira would read as kobo if stored bare, so they are stored as naira and refused.
 */
export function storedAmount(typed: string): string {
  const text = typed.trim();
  if (!text) return "";
  const kobo = nairaToKobo(text);
  if (kobo !== null) return kobo;
  return KOBO.test(text) ? text + ".00" : text;
}

/** A question's name as the editor shows it: a money question asks for naira. */
export const askedAs = (field: Pick<GuidedField, "label" | "type">) =>
  field.type === "money_kobo" ? field.label.replace(/\bwhole kobo\b/g, "naira") : field.label;

/** What is wrong with an answer, as the editor says it. */
export const saidAs = (issue: string) => (issue === NOT_KOBO ? NOT_AN_AMOUNT : issue);

/** The help under a money question. The definitions' own explains kobo, which is no longer typed. */
export const MONEY_HELP = "Type the amount yourself. Valo works out no rate or amount for you.";
