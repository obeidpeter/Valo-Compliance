import { sourceCoverageExpansion } from "./coverage-expansion.generated";
import { baselineTemplates, additionalCandidates, contentReadiness } from "./catalogue";

/** Facts are supplied only after live publication eligibility checks, never from inventory rows. */
export type ReleasedCoverageFact = {
  id: string;
  kind: "template" | "guidance" | "guide" | "industry_pack" | "location_pack";
  industrySlugs: string[];
  locationIds: string[];
  sourceCheckedAt: string;
};
export function coveragePlan(released: ReleasedCoverageFact[] = []) {
  const c = contentReadiness();
  const distinct = [...new Map(released.map((r) => [r.id, r])).values()];
  const regulatory = distinct.filter((r) => r.kind !== "template");
  return {
    industries: c.industryTaxonomy.map((title, index) => {
      const slug = title.replaceAll("/", "-").replaceAll(" ", "-");
      const matches = regulatory.filter((r) => r.industrySlugs.includes(slug));
      return {
        id: `IND-${String(index + 1).padStart(2, "0")}`,
        slug: title.replaceAll("/", "-").replaceAll(" ", "-"),
        title,
        deeperPackTarget: (c.deeperPacks as readonly string[]).includes(title),
        enhancedEvidenceRequired: ["healthcare", "financial services", "energy"].includes(title),
        coverageState: matches.length ? "partial" : "held",
        evidenceState: matches.length ? "released_evidence" : "no_released_evidence",
        sourceCheckedAt:
          matches
            .map((r) => r.sourceCheckedAt)
            .sort()
            .at(-1) ?? null,
        publishedItems: matches.length,
      };
    }),
    guidanceTarget: c.releaseTargets.R1.compliance_entries,
    publishedGuidance: distinct.filter((r) => r.kind === "guidance").length,
    guidesTarget: c.releaseTargets.R1.guides,
    publishedGuides: distinct.filter((r) => r.kind === "guide").length,
    deeperPackTarget: c.releaseTargets.R1.deeper_industry_packs,
    publishedDeeperPacks: distinct.filter((r) => r.kind === "industry_pack").length,
    selectableLocations: 37,
    priorityLocations: c.statePriorities,
    checkedLocationPacks: distinct.filter((r) => r.kind === "location_pack").length,
    notice: regulatory.length
      ? "Counts include only currently eligible released content. Coverage remains partial; absent state/LGA/activity evidence is a gap, not an exemption."
      : "Coverage targets, not completed coverage. No federal, state/FCT or LGA guidance is currently released. Priority is not evidence of a source check.",
    ngoNotice:
      "NGO applicability depends on actual legal form, activities and geography. No tax or licensing exemption is inferred. NGO onboarding expansion remains locked until R1 acceptance.",
  };
}

/** Mapping rows are not additional templates or additional published obligations. */
export function contentTraceRows() {
  const c = contentReadiness();
  const source = "docs/specification/essential-business-documents.txt";
  const common = {
    evidenceState: "publication_evidence_missing",
    coverageState: "not_assessed",
    publicationEligible: false,
    sourceCheckedAt: null,
  };
  return [
    ...baselineTemplates.map((t) => ({
      ...common,
      id: t.id,
      title: t.title,
      kind: "R1 baseline template",
      status: "held",
      relatedIds: [] as string[],
      canonicalId: t.id,
      mappingType: "baseline",
      sourceLocator: "docs/specification/VALO-TRD-001-v1.1.txt",
      overlapIds: [] as string[],
      limitation: t.holdReasons.join("; "),
    })),
    ...c.supplementaryMappings.map((m) => ({
      ...common,
      id: m.source_id,
      title: m.source_title,
      kind: "Supplementary document mapping",
      status: "inventory_only",
      mappingType: m.mapping_type,
      canonicalId: m.canonical_template_id,
      evidenceState: "inventory_mapping_only",
      sourceLocator: source,
      overlapIds: [] as string[],
      relatedIds: [...(m.canonical_template_id ? [m.canonical_template_id] : []), ...m.related_template_ids],
      limitation: m.note,
    })),
    ...c.identifiedAdditions.map((t) => ({
      ...common,
      id: t.id,
      title: t.title,
      kind: "Identified R2 template addition",
      status: "held",
      relatedIds: [t.source_item_id],
      canonicalId: t.id,
      mappingType: "new_supplementary_type",
      sourceLocator: source,
      overlapIds: [] as string[],
      limitation: t.hold_reasons.join("; "),
    })),
    ...additionalCandidates.map((t) => ({
      ...common,
      id: t.id,
      title: t.title,
      kind: "Further distinct-purpose proposal",
      status: "proposed_not_published",
      relatedIds: t.comparedWithTemplateIds,
      canonicalId: t.id,
      mappingType: "distinct_purpose_proposal",
      sourceLocator: "lib/valo-core/src/catalogue.ts",
      overlapIds: [] as string[],
      limitation: `${t.rationale} ${t.distinctness}`,
    })),
    ...c.regulatoryRows.map((r) => ({
      ...common,
      id: r.source_id,
      title: r.source_title,
      kind: `Regulatory research: ${r.classification}`,
      status: r.publication_status,
      relatedIds: [r.canonical_topic_id],
      canonicalId: r.canonical_topic_id,
      evidenceState: "no_authoritative_evidence",
      mappingType: r.canonical_topic_id === r.source_id ? "research_topic_not_publication" : "scoped_alias",
      sourceLocator: source,
      coverageState: r.coverage_status,
      overlapIds: c.overlaps
        .filter((o) => (o.source_ids as readonly string[]).includes(r.source_id))
        .map((o) => o.id),
      limitation: `${r.hold_reasons.join("; ")}. Not mandatory for every organisation. Legal form, activity and geography require separate assessment.`,
    })),
  ];
}

export function expansionReadiness() {
  const targets = contentReadiness().releaseTargets.R2;
  return {
    coverageLayers: sourceCoverageExpansion.coverageLayers.map((l) => ({
      ...l,
      status: "target_not_completed",
    })),
    expansionBoundaries: sourceCoverageExpansion.expansionBoundaries.map((e) => ({
      ...e,
      enabled: false,
      status: e.release === "R3" ? "excluded_from_commission" : "locked_until_r1_accepted",
    })),
    managementFiles: sourceCoverageExpansion.managementFiles,
    ngoCaution: sourceCoverageExpansion.ngoCaution,
    provisionalTargets: sourceCoverageExpansion.provisionalTargets,
    r2Targets: {
      templates: targets.templates_approximately,
      guided: targets.guided,
      guidance: targets.compliance_entries_approximately,
      deeperPacks: targets.deeper_industry_packs,
      locationsUpTo: targets.reviewed_state_FCT_packs_up_to,
    },
  };
}
