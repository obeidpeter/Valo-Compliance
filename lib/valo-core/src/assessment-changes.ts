import { digest } from "./publication";

/** The parts of a saved assessment's result item a comparison explains. */
export type ComparableItem = {
  ruleId: string;
  ruleVersion: number;
  title: string;
  label: string;
  matchedFacts: string[];
  missingFacts: string[];
};

/** Why one rule's result differs between two assessments. */
export type AssessmentChange = {
  ruleId: string;
  title: string;
  change: "added" | "removed" | "changed";
  previousVersion: number | null;
  currentVersion: number | null;
  previousLabel: string | null;
  currentLabel: string | null;
  /** The customer's changed answers that this rule's result used or still needs. */
  changedFacts: string[];
};

const related = (fact: string, path: string) =>
  fact === path || path.startsWith(fact + ".") || fact.startsWith(path + ".");

/**
 * CMP-005: rule by rule, what changed between two saved assessments, so a customer can see why a
 * recommendation changed: the rule's version, its result, and which of their changed answers it
 * depends on. Each assessment stays as it was saved; this only compares them, and the same two
 * assessments always explain the same way.
 */
export function explainAssessmentChanges<T extends ComparableItem>(
  previous: readonly T[],
  current: readonly T[],
  changedFacts: readonly string[],
): AssessmentChange[] {
  const before = new Map(previous.map((item) => [item.ruleId, item]));
  const after = new Map(current.map((item) => [item.ruleId, item]));
  const explain = (change: AssessmentChange["change"], old?: T, now?: T): AssessmentChange => {
    const used = [old, now].flatMap((item) => (item ? [...item.matchedFacts, ...item.missingFacts] : []));
    return {
      ruleId: (now ?? old)!.ruleId,
      title: (now ?? old)!.title,
      change,
      previousVersion: old?.ruleVersion ?? null,
      currentVersion: now?.ruleVersion ?? null,
      previousLabel: old?.label ?? null,
      currentLabel: now?.label ?? null,
      changedFacts: changedFacts.filter((path) => used.some((fact) => related(fact, path))),
    };
  };
  return [
    ...current.flatMap((now) => {
      const old = before.get(now.ruleId);
      if (!old) return [explain("added", undefined, now)];
      return digest(old) === digest(now) ? [] : [explain("changed", old, now)];
    }),
    ...previous.filter((old) => !after.has(old.ruleId)).map((old) => explain("removed", old)),
  ];
}
