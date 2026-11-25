import type { AssessmentResult, PublicItem } from "@workspace/api-client-react";

/** A template's number in the specification's list, as a rule relates it ("TPL-29"). */
const TEMPLATE_NUMBER = /^TPL-\d{2}$/;
/** The released list takes up to twenty numbers in one request. */
export const NUMBERS_PER_REQUEST = 20;

/**
 * The numbers of every document a result relates (docs/architecture/results.md): its requirements'
 * and its recommended ones, each once, in order. Anything that is not a template's number is left out.
 */
export function resultTemplateNumbers(
  result: Pick<AssessmentResult, "items" | "recommendedTemplateIds">,
): string[] {
  return [
    ...new Set([
      ...result.items.flatMap((item) => item.relatedTemplateIds),
      ...result.recommendedTemplateIds,
    ]),
  ]
    .filter((number) => TEMPLATE_NUMBER.test(number))
    .sort();
}

/** The numbers in the groups the released list takes, each written as the list's filter takes it. */
export function numberGroups(numbers: readonly string[]): string[] {
  const groups: string[] = [];
  for (let start = 0; start < numbers.length; start += NUMBERS_PER_REQUEST)
    groups.push(numbers.slice(start, start + NUMBERS_PER_REQUEST).join(","));
  return groups;
}

/**
 * The released documents with these numbers, in the numbers' order and each once. A number with no
 * released document lists nothing: a held document is never named.
 */
export function documentsFor(numbers: readonly string[], released: readonly PublicItem[]): PublicItem[] {
  const listed = new Set<string>();
  return numbers.flatMap((number) =>
    released.filter((document) => {
      if (document.templateNumber !== number || listed.has(document.id)) return false;
      listed.add(document.id);
      return true;
    }),
  );
}
