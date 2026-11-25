import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { DecideOwnerRuleBody, WatchOwnerRuleSourcesBody } from "@workspace/api-zod";
import {
  allSourceLeads,
  canonical,
  digest,
  evaluateOwnerRuleBundle,
  ownerConfirmedChecks,
  ownerRuleCandidateDigest,
  ownerRuleDisclosure,
  ownerRuleManifest,
  ruleSchema,
  sha256,
  type OwnerConfirmedCheck,
  type OwnerRuleBundle,
  type PublicationBundle,
  type ReleasedRule,
} from "@workspace/valo-core";
import {
  bindVerifiedSources,
  currentSourceCaptures,
  lockSourceState,
  readSourceText,
  registerSourceWatch,
  sourceWatchStates,
  verifyReleasedSources,
  type CurrentSourceCapture,
} from "../sources";
import {
  AMENDMENT_RECORD_DAYS,
  capturedGuidePassages,
  guideAmendmentRecords,
  guidancePolicy,
  guideSourceDecision,
  type AmendmentRecord,
  type GuidePassages,
} from "../publication";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import { ValoProblem } from "../../platform/valo-problem";
import { planStoredRuleRelease, recordRuleChanges, ruleChangeReason } from "./valo-rule-release";
import { ownerRuleCandidates, type OwnerRuleCandidate } from "./owner-rule-candidates";

/**
 * Requirements-checker rules released on the development owner's sign-off (decision 0020).
 *
 * A rule is prepared in the repository as an `OwnerRuleCandidate`: what it tells a customer, the
 * official passages it rests on and the claims tying them to the rule, its rights record and its
 * critical scenarios. Each passage is one the guides use (`guidance-passages.ts`), read from today's
 * capture of its official address, and its source is marked current only by `guideSourceDecision`
 * from its text's amendment record, as a guide's is. The owner reads the rule and the evidence for
 * each of EDP-005's enhanced checks, has the daily source check watch the sources, confirms the
 * checks one by one and signs; one transaction then records the sign-off, the release, its source
 * bindings and the earlier version's supersession. The database refuses an owner-signed release
 * without that sign-off (migration rule_owner_signoffs).
 */
export { ownerRuleCandidates, type OwnerRuleCandidate } from "./owner-rule-candidates";

const refusal = "Only the designated development owner can sign requirements-checker rules.";
const replacementReasonNeeded =
  "Say what changed in this version, in 20 to 1,000 characters. It replaces the released one.";
const day = 86_400_000;
/** The guidance policy's point 7: no more than this many words in a row from a passage. */
export const OWNER_RULE_QUOTE_WORDS = 20;
const unique = <T>(values: T[]) => [...new Set(values)];
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

type Policy = PublicationBundle["policy"];
type ReadText = (snapshotId: string, checksum: string) => Promise<string>;
/** Where passages and amendment records come from; tests stand in their own. */
type Evidence = {
  passagesFrom: (captures: readonly CurrentSourceCapture[]) => GuidePassages;
  records: readonly AmendmentRecord[];
};
type Options = {
  candidates?: readonly OwnerRuleCandidate[];
  now?: Date;
  readText?: ReadText;
  evidence?: Partial<Evidence>;
};
const evidenceOf = (options: Options): Evidence => ({
  passagesFrom: options.evidence?.passagesFrom ?? ((captures) => capturedGuidePassages(captures)),
  records: options.evidence?.records ?? guideAmendmentRecords,
});

/** What the owner confirms for each of EDP-005's enhanced checks, in the screen's words. */
export const ownerCheckLabels: Record<OwnerConfirmedCheck, string> = {
  controlling_text: "Each passage is the controlling text, as the official copy has it at its place.",
  amendments: "No amendment to these texts is unresolved, on their amendment records.",
  effective_dates: "Each text is in force for the dates this rule covers.",
  exceptions: "The rule allows for the exceptions its passages make, within its stated scope.",
  jurisdiction: "The rule covers only the places and businesses its passages cover.",
};

const operators: Record<string, string> = {
  eq: "is",
  in: "is one of",
  exists: "is answered",
  lt: "is less than",
  lte: "is at most",
  gt: "is more than",
  gte: "is at least",
};
const fieldWords = (field: string) =>
  field === "lga" ? "local government area" : field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const valueWords = (value: unknown): string =>
  Array.isArray(value) ? value.map(valueWords).join(", ") : String(value).replaceAll("_", " ");

/** When the rule applies, in words, from its condition or its fixed calculation. */
export function describeRuleCondition(rule: Pick<ReleasedRule, "condition" | "evaluator">) {
  if (!rule.condition)
    return rule.evaluator
      ? `When the requirements check's fixed ${rule.evaluator.family} calculation (${rule.evaluator.version}) says so.`
      : "No condition is set.";
  const parts = rule.condition.predicates.map((p) =>
    [fieldWords(p.field), operators[p.op], p.op === "exists" ? "" : valueWords(p.value)]
      .filter(Boolean)
      .join(" "),
  );
  return `When ${parts.join(rule.condition.mode === "all" ? " and " : " or ")}.`;
}

/** Where the rule applies, in words. */
export function describeRuleJurisdiction(jurisdiction: ReleasedRule["jurisdiction"]) {
  if (jurisdiction.level === "federal") return "Nigeria as a whole (a federal rule).";
  if (jurisdiction.level === "state") return `${jurisdiction.state ?? "A state"} only (a state rule).`;
  return `${jurisdiction.lga ?? "A local government area"}, ${jurisdiction.state ?? ""} only (a local rule).`;
}

const holdWords: Record<string, (detail: string) => string> = {
  candidate_hash_mismatch: () => "The prepared rule does not match its checksum.",
  policy_not_owner_approved: () => "The guidance policy is not approved as it stands.",
  policy_hash_mismatch: () => "The guidance policy changed after its checksum was taken.",
  class_outside_policy: () => "The guidance policy does not cover this kind of content.",
  jurisdiction_outside_policy: () => "The guidance policy does not cover this jurisdiction.",
  risk_outside_policy: () => "The guidance policy does not cover this risk area.",
  material_uncertainty: () => "The rule records an unresolved question or missing evidence.",
  rule_not_sourced_guidance: () => "The rule is not prepared as sourced guidance.",
  regulatory_sources_required: () => "The rule names no official source.",
  legal_scope_unverified: () => "The rule's places and exceptions are not confirmed.",
  source_check_in_future: () => "The source check is dated in the future.",
  unsupported_professional_claim: () => "The rule's words claim a professional approval it does not have.",
  rights_not_cleared: () => "The rule's rights record does not allow its use.",
  source_not_allowlisted: (id) => `Source ${id} is not at an official address the policy allows.`,
  source_hash_mismatch: (id) => `Source ${id}'s passage does not match its checksum.`,
  source_unresolved: (id) => `Source ${id}'s controlling text, dates or amendments are not confirmed.`,
  source_not_current: (id) => `Source ${id} is not current: its check is out of date, or it is not in force.`,
  unsupported_claim: (locator) => `The passage at ${locator} does not hold the words the rule quotes.`,
  unsupported_number: (locator) => `A number the rule gives at ${locator} is not in the quoted words.`,
  enhanced_content_has_no_claim_mapping: () => "The rule ties no claim to its sources.",
  contract_assumptions_missing: () => "The rule records no assumption, which a contracts rule needs.",
  duplicate_source_id: () => "Two of the rule's sources share a name.",
  duplicate_scenario_id: () => "Two of the rule's scenarios share a name.",
  no_critical_scenario: () => "The rule has no critical scenario.",
  manifest_mismatch: () => "The rule's parts do not match its manifest.",
  version_not_next: () => "This is not the rule's next version.",
  critical_scenario_failed: (id) => `Scenario ${id} does not give the result it expects.`,
  release_not_admissible: () => "The requirements check would not admit this version as it stands.",
  route_not_allowlisted: () =>
    "The rule's official page is not on one of the guidance policy's official sites.",
};

/** A reason the evidence check or the release plan gives, in the screen's words. */
export function ownerRuleHold(reason: string) {
  const at = reason.indexOf(":");
  const [code, detail] = at < 0 ? [reason, ""] : [reason.slice(0, at), reason.slice(at + 1)];
  if (code === "schema" || code === "condition_schema_invalid") return "The prepared rule is incomplete.";
  return holdWords[code]?.(detail) ?? `Held: ${reason}.`;
}

/** What a source's amendment record says, for the screen. */
function amendmentSummary(record: AmendmentRecord | undefined) {
  if (!record) return null;
  const searched = record.searches.map((s) => Date.parse(s.searchedAt)).filter(Number.isFinite);
  return {
    searchedAt: searched.length ? new Date(Math.min(...searched)).toISOString() : null,
    places: record.searches.map((s) => s.place),
    read: record.amendments.map((a) => a.title),
    notRead: record.notRead.map((n) => `${n.title} (${n.why})`),
    open: record.conflicts.filter((c) => c.open).map((c) => c.about),
    limits: record.limits,
  };
}

/**
 * The rule and bundle a candidate makes against today's captures, the guide passages they hold, the
 * amendment records, the policy and the owner's confirmations; and what holds it. Nothing is read or
 * written.
 *
 * A source is approved only when its amendment record approves its passage (`guideSourceDecision`)
 * and the owner has confirmed the checks that rest on it. The rule's source check is the oldest of its
 * captures; with none at all it is dated `now`, so its scenarios can still be shown, and it is held. It
 * stays fresh for 30 days (90 for `general` risk), and no longer than its amendment records do.
 */
export function prepareOwnerRule(
  candidate: OwnerRuleCandidate,
  input: {
    version: number;
    captures: readonly CurrentSourceCapture[];
    passages: GuidePassages;
    records: readonly AmendmentRecord[];
    policy: Policy;
    confirmed: readonly string[];
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
  const has = (check: OwnerConfirmedCheck) => input.confirmed.includes(check);
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
  const content = {
    ...candidate.rule,
    version: input.version,
    sourceCheckedAt: checkedAt.toISOString(),
    reviewBy: freshUntil,
    status: "published" as const,
    provenance: "owner_signoff" as const,
    sources: parts.map((p) => ({
      id: p.source.id,
      url: p.lead?.url ?? "https://invalid.invalid/",
      title: p.title,
      locator: p.source.locator,
      quote: p.source.quote,
      snapshotHash: sha256(passageText(p)),
    })),
  };
  const bundleCandidate = {
    id: candidate.rule.requirementVersionId,
    version: input.version,
    body: canonical(content),
    hash: "",
    contentClass: "sourced_guidance" as const,
    jurisdiction: "NG",
    risk: candidate.risk,
    scope: candidate.scope,
    limitations: candidate.limitations,
    assumptions: candidate.assumptions,
    unresolvedMaterialIssues: candidate.unresolvedMaterialIssues,
    missingEvidence: candidate.missingEvidence,
    sourceCheckDate: checkedAt.toISOString(),
    disclosure: ownerRuleDisclosure,
    // The owner's confirmations resolve the legal scope; each source's text and amendments need its
    // amendment record's decision as well.
    legalScopeStatus:
      has("jurisdiction") && has("exceptions") ? ("verified" as const) : ("unverified" as const),
    claims: candidate.claims,
  };
  bundleCandidate.hash = ownerRuleCandidateDigest(bundleCandidate);
  const unbound = {
    kind: "owner_signoff" as const,
    candidate: bundleCandidate,
    sources: parts.map((p) => {
      const operative =
        Boolean(p.decision?.operativeTextConfirmed) && has("controlling_text") && has("effective_dates");
      const resolved = Boolean(p.decision?.amendmentsResolved) && has("amendments");
      return {
        id: p.source.id,
        url: p.lead?.url ?? "https://invalid.invalid/",
        title: p.title,
        issuingBody: p.passage?.instrument.issuingBody ?? p.lead?.title ?? "Unknown",
        text: passageText(p),
        hash: sha256(passageText(p)),
        jurisdiction: "NG",
        retrievedAt: p.capture?.checkedAt ?? checkedAt.toISOString(),
        freshUntil,
        effectiveFrom: p.passage?.instrument.effectiveFrom ?? checkedAt.toISOString(),
        effectiveTo: null,
        status:
          p.decision?.status === "approved" && operative && resolved
            ? ("approved" as const)
            : ("held" as const),
        operativeTextConfirmed: operative,
        amendmentsResolved: resolved,
      };
    }),
    rights: candidate.rights,
    policy: input.policy,
    scenarios: candidate.scenarios,
  };
  const bundle: OwnerRuleBundle = { ...unbound, manifest: ownerRuleManifest(unbound) };
  const rule = ruleSchema.parse({ ...content, manifestHash: digest(bundle.manifest) });
  const snapshotIds = Object.fromEntries(
    parts.flatMap((p) => (p.capture && p.passage ? [[p.source.id, p.capture.snapshotId]] : [])),
  );
  const evidence = parts.map((p) => ({
    passage: p.passage?.text ?? null,
    recordedLocator: p.passage?.recordedLocator ?? null,
    effectiveFrom: p.passage?.instrument.effectiveFrom ?? null,
    amendments: amendmentSummary(p.record),
  }));
  return {
    rule,
    bundle,
    holds,
    explained: [...explained],
    snapshotIds,
    sourceCheckedAt: checkedAt,
    evidence,
  };
}

const candidateFor = (candidates: readonly OwnerRuleCandidate[], ruleId: string) => {
  const candidate = candidates.find((c) => c.rule.id === ruleId);
  if (!candidate) throw new ValoProblem(404, "There is no rule prepared under that name.");
  return candidate;
};

async function storedVersions(ruleIds: string[]) {
  if (!ruleIds.length) return [];
  const { db, valoRuleReleases: r } = await import("@workspace/db");
  return db
    .select({ ruleId: r.ruleId, version: r.version, status: r.status, manifestHash: r.manifestHash })
    .from(r)
    .where(inArray(r.ruleId, ruleIds));
}
const nextVersion = (stored: Awaited<ReturnType<typeof storedVersions>>, ruleId: string) =>
  Math.max(0, ...stored.filter((s) => s.ruleId === ruleId).map((s) => s.version)) + 1;

/** Builds a candidate's rule and checks it as the sign-off does: its evidence and its release plan. */
async function assessCandidate(candidate: OwnerRuleCandidate, input: Parameters<typeof prepareOwnerRule>[1]) {
  const prepared = prepareOwnerRule(candidate, input);
  const evidence = evaluateOwnerRuleBundle(prepared.bundle, input.now);
  const plan = await planStoredRuleRelease(
    {
      rule: prepared.rule,
      bundle: prepared.bundle,
      scenarios: candidate.scenarios,
      snapshotIds: prepared.snapshotIds,
    },
    input.now,
    { hash: input.policy.hash, ownerApproved: input.policy.ownerApproved },
  );
  // A source's own hold already says why it is not resolved or current, and a failed evidence check
  // already says why the registry would not admit the version.
  const derived = new Set(
    prepared.explained.flatMap((id) => [`source_unresolved:${id}`, `source_not_current:${id}`]),
  );
  const reasons = [
    ...evidence.reasons.filter((r) => !derived.has(r)),
    ...plan.reasons.filter((r) => !(r === "release_not_admissible" && evidence.reasons.length)),
  ];
  return { prepared, evidence, plan, holds: unique([...prepared.holds, ...reasons.map(ownerRuleHold)]) };
}

async function present(candidates: readonly OwnerRuleCandidate[], now: Date, options: Options) {
  if (!candidates.length) return [];
  const { passagesFrom, records } = evidenceOf(options);
  const leads = unique(candidates.flatMap((c) => c.sources.map((s) => s.leadId)));
  const stored = await storedVersions(candidates.map((c) => c.rule.id));
  const { policy } = await guidancePolicy();
  const captures = await currentSourceCaptures(
    leads,
    now,
    options.readText ? { readText: options.readText } : {},
  );
  const watches = await sourceWatchStates(leads);
  const passages = passagesFrom(captures);
  const items = [];
  for (const candidate of candidates) {
    const version = nextVersion(stored, candidate.rule.id);
    const { prepared, plan, holds } = await assessCandidate(candidate, {
      version,
      captures,
      passages,
      records,
      policy,
      confirmed: ownerConfirmedChecks,
      now,
    });
    const live = stored.find((s) => s.ruleId === candidate.rule.id && s.status === "published");
    items.push({
      ruleId: candidate.rule.id,
      title: candidate.rule.title,
      // A fixed calculation words its result for each customer's answers, and never shows the rule's
      // own reason or next step: what each scenario's customer is told is in its scenario.
      reason: candidate.rule.evaluator ? null : candidate.rule.reason,
      nextStep: candidate.rule.evaluator ? null : candidate.rule.nextStep,
      appliesWhen: describeRuleCondition(candidate.rule),
      // Where the customer is sent, and each figure with the passage it rests on, as they would see
      // them; both are in the manifest the owner signs (docs/architecture/results.md).
      ...(candidate.rule.officialRoute && { officialRoute: candidate.rule.officialRoute }),
      ...(candidate.rule.figures && {
        figures: candidate.rule.figures.map((figure) => {
          const source = prepared.rule.sources.find((s) => s.id === figure.sourceId);
          return {
            kind: figure.kind,
            words: figure.words,
            source: source ? `${source.title}, ${source.locator}` : figure.sourceId,
          };
        }),
      }),
      jurisdiction: describeRuleJurisdiction(candidate.rule.jurisdiction),
      validFrom: candidate.rule.validFrom,
      validTo: candidate.rule.validTo,
      risk: candidate.risk,
      scope: candidate.scope,
      limitations: candidate.limitations,
      assumptions: candidate.assumptions,
      disclosure: ownerRuleDisclosure,
      version,
      manifestHash: prepared.rule.manifestHash,
      live: live ? { version: live.version, manifestHash: live.manifestHash } : null,
      holds,
      checks: ownerConfirmedChecks.map((id) => ({ id, label: ownerCheckLabels[id] })),
      sources: candidate.sources.map((source, i) => {
        const watch = watches.find((w) => w.leadId === source.leadId);
        return {
          title: prepared.rule.sources[i]!.title,
          url: allSourceLeads.find((l) => l.id === source.leadId)?.url ?? null,
          locator: source.locator,
          quote: source.quote,
          watched: Boolean(watch),
          checkedAt: watch?.checkedAt ?? null,
          failure: watch?.failureCode ?? null,
          current: Boolean(prepared.snapshotIds[source.id]),
          ...prepared.evidence[i]!,
        };
      }),
      scenarios: plan.scenarios,
      profilesRun: plan.affected.profiles,
      changedProfiles: plan.affected.changes.length,
    });
  }
  return items;
}

/** Every rule prepared for the owner's sign-off, as the owner sees it: built with every check
 * confirmed, so the version and manifest it shows are the ones the owner signs. */
export async function listOwnerRules(actor: StaffActor, options: Options = {}) {
  // The owner's authority first; storage and the policy file are read outside any transaction.
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  return {
    items: await present(options.candidates ?? ownerRuleCandidates, options.now ?? new Date(), options),
  };
}

/**
 * Has the daily source check watch each of a rule's official sources. A newly watched source is read
 * at the worker's next run, within a few minutes, and once a day after that. Nothing is fetched here,
 * and only registered official addresses can be watched.
 */
export async function watchOwnerRuleSources(
  actor: StaffActor,
  ruleId: string,
  body: unknown,
  options: Options = {},
) {
  WatchOwnerRuleSourcesBody.strict().parse(body);
  const candidate = await asDevelopmentOwner(
    actor,
    async (tx) => {
      const found = candidateFor(options.candidates ?? ownerRuleCandidates, ruleId);
      const known = unique(found.sources.map((s) => s.leadId)).filter((id) =>
        allSourceLeads.some((l) => l.id === id),
      );
      for (const lead of known) await registerSourceWatch(tx, lead);
      return found;
    },
    refusal,
  );
  const [item] = await present([candidate], options.now ?? new Date(), options);
  return item!;
}

/** The owner signs and releases the version they read, or withdraws a released one. */
export async function decideOwnerRule(
  actor: StaffActor,
  ruleId: string,
  body: unknown,
  options: Options = {},
) {
  const input = DecideOwnerRuleBody.strict().parse(body);
  if (!input.confirmed) throw new ValoProblem(422, "Confirm that you have read this rule and its sources.");
  // docs/architecture/rule-changes.md: a withdrawal, and a version that replaces a released one, say
  // why. The businesses that used the old version are told it.
  const reason = ruleChangeReason(input.reason);
  if (input.reason !== undefined && !reason)
    throw new ValoProblem(422, "Write the reason in 20 to 1,000 characters.");
  return input.action === "withdraw"
    ? withdrawOwnerRule(actor, ruleId, { ...input, reason })
    : signOwnerRule(actor, ruleId, { ...input, reason }, options);
}

/**
 * Releases a rule on the owner's sign-off. The owner names the version and manifest they read and
 * confirms each enhanced check; the rule is built again here, and anything that changed or holds it
 * refuses the sign-off. Storage is read before the transaction opens.
 */
async function signOwnerRule(
  actor: StaffActor,
  ruleId: string,
  input: { version: number; manifestHash: string; confirmedChecks: string[]; reason: string | null },
  options: Options,
) {
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  const candidate = candidateFor(options.candidates ?? ownerRuleCandidates, ruleId);
  if (ownerConfirmedChecks.some((check) => !input.confirmedChecks.includes(check)))
    throw new ValoProblem(422, "Confirm each of the five checks before signing.");
  const now = options.now ?? new Date();
  const readText = options.readText ?? readSourceText;
  const { passagesFrom, records } = evidenceOf(options);
  const { db, valoRuleOwnerSignoffs, valoRuleReleases: r } = await import("@workspace/db");
  const stored = await storedVersions([ruleId]);
  const version = nextVersion(stored, ruleId);
  const { policy } = await guidancePolicy();
  const captures = await currentSourceCaptures(unique(candidate.sources.map((s) => s.leadId)), now, {
    readText,
  });
  const { prepared, evidence, plan, holds } = await assessCandidate(candidate, {
    version,
    captures,
    passages: passagesFrom(captures),
    records,
    policy,
    confirmed: input.confirmedChecks,
    now,
  });
  if (version !== input.version || prepared.rule.manifestHash !== input.manifestHash)
    throw new ValoProblem(409, "The rule or its sources changed. Reopen it before signing.");
  if (holds.length || evidence.decision !== "eligible" || plan.decision !== "ready")
    throw new ValoProblem(409, "This rule is held. " + holds.join(" "));
  // Asked only once the version is the next one and nothing holds it, so a version already signed
  // or a changed rule is refused as such, not for want of a reason.
  if (!input.reason && stored.some((s) => s.ruleId === ruleId && s.status === "published"))
    throw new ValoProblem(422, replacementReasonNeeded);
  const captured = await verifyReleasedSources(db, prepared.bundle, prepared.snapshotIds, now, readText);
  return asDevelopmentOwner(
    actor,
    async (tx) => {
      await lockSourceState(tx, true);
      const latest = (
        await tx.execute<{ version: number }>(
          sql`select coalesce(max(version), 0)::int as version from valo_rule_releases where rule_id=${ruleId}`,
        )
      ).rows[0]!.version;
      if (Number(latest) !== version - 1)
        throw new ValoProblem(409, "Another version of this rule was released. Reopen it before signing.");
      await tx.insert(valoRuleOwnerSignoffs).values({
        id: randomUUID(),
        ruleId,
        version,
        manifestHash: prepared.rule.manifestHash,
        ownerIdentityId: actor.identityId,
        sourceCheckedAt: prepared.sourceCheckedAt,
        confirmedChecks: [...ownerConfirmedChecks],
      });
      const id = randomUUID();
      await tx.insert(r).values({
        id,
        ruleId,
        version,
        status: "published",
        rule: prepared.rule,
        publicationBundle: prepared.bundle,
        manifestHash: prepared.rule.manifestHash,
        publishedAt: now,
      });
      await bindVerifiedSources(tx, "rule", id, prepared.bundle, captured, now);
      const replaced = (
        await tx
          .select({ version: r.version })
          .from(r)
          .where(and(eq(r.ruleId, ruleId), eq(r.status, "published"), ne(r.id, id)))
      ).map((row) => row.version);
      if (replaced.length) {
        if (!input.reason) throw new ValoProblem(422, replacementReasonNeeded);
        await recordRuleChanges(tx, {
          ruleId,
          versions: replaced,
          kind: "replaced",
          replacementVersion: version,
          reason: input.reason,
          recordedBy: actor.identityId,
        });
      }
      const superseded = await tx
        .update(r)
        .set({ status: "superseded" })
        .where(and(eq(r.ruleId, ruleId), eq(r.status, "published"), ne(r.id, id)))
        .returning({ version: r.version });
      return {
        ruleId,
        version,
        state: "published" as const,
        superseded: superseded.map((s) => s.version).sort((a, b) => a - b),
      };
    },
    refusal,
  );
}

/** Withdraws a released owner-signed version, with the reason the businesses that used it are told.
 * It leaves the checker at once and is never published again; releasing the rule again takes a new
 * version and a new sign-off. */
function withdrawOwnerRule(
  actor: StaffActor,
  ruleId: string,
  input: { version: number; manifestHash: string; reason: string | null },
) {
  const { reason } = input;
  return asDevelopmentOwner(
    actor,
    async (tx) => {
      if (!reason)
        throw new ValoProblem(422, "Say why this version is withdrawn, in 20 to 1,000 characters.");
      const { valoRuleReleases: r } = await import("@workspace/db");
      await lockSourceState(tx, true);
      const [row] = await tx
        .select({ id: r.id, status: r.status, rule: r.rule, manifestHash: r.manifestHash })
        .from(r)
        .where(and(eq(r.ruleId, ruleId), eq(r.version, input.version)))
        .for("update");
      const signed = ruleSchema.safeParse(row?.rule);
      if (
        !row ||
        row.manifestHash !== input.manifestHash ||
        !signed.success ||
        signed.data.provenance !== "owner_signoff"
      )
        throw new ValoProblem(409, "That released version changed. Reopen the rule before withdrawing it.");
      if (row.status !== "withdrawn") {
        if (row.status !== "published")
          throw new ValoProblem(409, "Only the released version can be withdrawn. Reopen the rule.");
        await recordRuleChanges(tx, {
          ruleId,
          versions: [input.version],
          kind: "withdrawn",
          reason,
          recordedBy: actor.identityId,
        });
        await tx.update(r).set({ status: "withdrawn" }).where(eq(r.id, row.id));
      }
      return { ruleId, version: input.version, state: "withdrawn" as const, superseded: [] };
    },
    refusal,
  );
}
