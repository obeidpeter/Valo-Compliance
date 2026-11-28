import type { TemplateClaimMap } from "./template-claim-map";
import { foodTemplateClaimMaps } from "./template-claims-food";
import { privacyTemplateClaimMaps } from "./template-claims-privacy";

/**
 * The claim maps of the templates that state the law (docs/architecture/reviewed-route.md, part 4),
 * kept apart from what builds them so that the checks that name these templates can read the list.
 */

/** Every template that states the law and has a claim map. A template without one is not built. */
export const templateLawClaimMaps: readonly TemplateClaimMap[] = [
  ...privacyTemplateClaimMaps,
  ...foodTemplateClaimMaps,
];
export const mappedLawTemplateIds = templateLawClaimMaps.map((m) => m.id);

/** Every passage a template's claim map names. */
export function lawTemplatePassageIds(id: string) {
  const map = templateLawClaimMaps.find((m) => m.id === id);
  if (!map) throw Error(`TEMPLATE_CLAIM_MAP_MISSING:${id}`);
  return [
    ...new Set(
      map.sentences
        .flatMap((sentence) => ("support" in sentence ? (sentence.support ?? []) : []))
        .map((s) => s.passage),
    ),
  ];
}
