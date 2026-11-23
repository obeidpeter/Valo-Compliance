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
import { guidancePolicy } from "../publication";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import { ValoProblem } from "../../platform/valo-problem";
import { planStoredRuleRelease } from "./valo-rule-release";

/**
 * Requirements-checker rules released on the development owner's sign-off (decision 0020).
 *
 * A rule is prepared in the repository as an `OwnerRuleCandidate`: what it tells a customer, the
 * passages of its official sources and the claims tying them to the rule, its rights record and its
 * critical scenarios. The rule and its bundle are built from it against each source's current
 * capture and the guidance policy as it stands. The owner reads them, has the daily source check
 * watch the sources, confirms EDP-005's enhanced checks one by one and signs; one transaction then
 * records the sign-off, the release, its source bindings and the earlier version's supersession. The
 * database refuses an owner-signed release without that sign-off (migration rule_owner_signoffs).
 */
export type OwnerRuleCandidate = {
  rule: Pick<
    ReleasedRule,
    | "id"
    | "requirementVersionId"
    | "title"
    | "jurisdiction"
    | "validFrom"
    | "validTo"
    | "reason"
    | "nextStep"
    | "relatedTemplateIds"
  > &
    Partial<Pick<ReleasedRule, "condition" | "evaluator">>;
  risk: PublicationBundle["candidate"]["risk"];
  scope: string;
  limitations: string;
  assumptions: string[];
  /** Anything recorded here holds the whole rule (EDP-005). */
  unresolvedMaterialIssues: string[];
  missingEvidence: string[];
  sources: {
    id: string;
    /** The registered official source whose current capture must hold the passage. */
    leadId: string;
    title: string;
    issuingBody: string;
    passage: string;
    locator: string;
    /** The words of the passage the rule shows the customer. */
    quote: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  claims: PublicationBundle["candidate"]["claims"];
  rights: PublicationBundle["rights"];
  scenarios: OwnerRuleBundle["scenarios"];
};

/** The rules prepared for the owner's sign-off. None is prepared yet: the first come from decision
 * 0020's research notes. */
export const ownerRuleCandidates: OwnerRuleCandidate[] = [];

const refusal = "Only the designated development owner can sign requirements-checker rules.";
const day = 86_400_000;
const unique = <T>(values: T[]) => [...new Set(values)];

type Policy = PublicationBundle["policy"];
type ReadText = (snapshotId: string, checksum: string) => Promise<string>;
type Options = { candidates?: readonly OwnerRuleCandidate[]; now?: Date; readText?: ReadText };

/** What the owner confirms for each of EDP-005's enhanced checks, in the screen's words. */
export const ownerCheckLabels: Record<OwnerConfirmedCheck, string> = {
  controlling_text:
    "Each quoted passage is the controlling text, as the official copy has it at its locator.",
  amendments: "No amendment to these sources is unresolved.",
  effective_dates: "Each source is in force for the dates this rule covers.",
  exceptions: "The rule allows for the exceptions its sources make.",
  jurisdiction: "The rule covers only the places and businesses its sources cover.",
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
      ? `When the checker's fixed ${rule.evaluator.family} calculation (${rule.evaluator.version}) says so.`
      : "No condition is set.";
  const parts = rule.condition.predicates.map((p) =>
    [fieldWords(p.field), operators[p.op], p.op === "exists" ? "" : valueWords(p.value)]
      .filter(Boolean)
      .join(" "),
  );
  return `When ${parts.join(rule.condition.mode === "all" ? " and " : " or ")}.`;
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
  release_not_admissible: () => "The checker would not admit this version as it stands.",
};

/** A reason the evidence check or the release plan gives, in the screen's words. */
export function ownerRuleHold(reason: string) {
  const at = reason.indexOf(":");
  const [code, detail] = at < 0 ? [reason, ""] : [reason.slice(0, at), reason.slice(at + 1)];
  if (code === "schema" || code === "condition_schema_invalid") return "The prepared rule is incomplete.";
  return holdWords[code]?.(detail) ?? `Held: ${reason}.`;
}

/**
 * The rule and bundle a candidate makes against these captures, the policy and the owner's
 * confirmations, and what holds it. Nothing is read or written.
 *
 * The rule's source check is the oldest of its sources' current captures. With none at all it is
 * dated `now` so its scenarios can still be shown; such a rule is held, and cannot be signed.
 */
export function prepareOwnerRule(
  candidate: OwnerRuleCandidate,
  input: {
    version: number;
    captures: readonly CurrentSourceCapture[];
    policy: Policy;
    confirmed: readonly string[];
    now: Date;
  },
) {
  const holds: string[] = [];
  const has = (check: OwnerConfirmedCheck) => input.confirmed.includes(check);
  const parts = candidate.sources.map((source) => {
    const lead = allSourceLeads.find((l) => l.id === source.leadId);
    const capture = input.captures.find((c) => c.leadId === source.leadId && c.url === lead?.url);
    if (!lead) holds.push(`${source.title} is not a registered official source.`);
    else if (!capture)
      holds.push(`${source.title} has no copy of its official source checked within the last day.`);
    else if (!capture.text.includes(source.passage) || !source.passage.includes(source.quote))
      holds.push(`${source.title}: the official copy does not hold the passage at ${source.locator}.`);
    return { source, url: lead?.url ?? "https://invalid.invalid/", capture };
  });
  const checks = parts.flatMap((p) => (p.capture ? [Date.parse(p.capture.checkedAt)] : []));
  const checkedAt = new Date(checks.length ? Math.min(...checks) : +input.now);
  const freshUntil = new Date(+checkedAt + (candidate.risk === "general" ? 90 : 30) * day).toISOString();
  const content = {
    ...candidate.rule,
    version: input.version,
    sourceCheckedAt: checkedAt.toISOString(),
    reviewBy: freshUntil,
    status: "published" as const,
    provenance: "owner_signoff" as const,
    sources: parts.map(({ source, url }) => ({
      id: source.id,
      url,
      title: source.title,
      locator: source.locator,
      quote: source.quote,
      snapshotHash: sha256(source.passage),
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
    // The owner's confirmations are what resolve the legal scope and each source's text.
    legalScopeStatus:
      has("jurisdiction") && has("exceptions") ? ("verified" as const) : ("unverified" as const),
    claims: candidate.claims,
  };
  bundleCandidate.hash = ownerRuleCandidateDigest(bundleCandidate);
  const unbound = {
    kind: "owner_signoff" as const,
    candidate: bundleCandidate,
    sources: parts.map(({ source, url, capture }) => ({
      id: source.id,
      url,
      title: source.title,
      issuingBody: source.issuingBody,
      text: source.passage,
      hash: sha256(source.passage),
      jurisdiction: "NG",
      retrievedAt: capture?.checkedAt ?? checkedAt.toISOString(),
      freshUntil,
      effectiveFrom: source.effectiveFrom,
      effectiveTo: source.effectiveTo,
      status: "approved" as const,
      operativeTextConfirmed: has("controlling_text") && has("effective_dates"),
      amendmentsResolved: has("amendments"),
    })),
    rights: candidate.rights,
    policy: input.policy,
    scenarios: candidate.scenarios,
  };
  const bundle: OwnerRuleBundle = { ...unbound, manifest: ownerRuleManifest(unbound) };
  const rule = ruleSchema.parse({ ...content, manifestHash: digest(bundle.manifest) });
  const snapshotIds = Object.fromEntries(
    parts.flatMap(({ source, capture }) => (capture ? [[source.id, capture.snapshotId]] : [])),
  );
  return { rule, bundle, holds, snapshotIds, sourceCheckedAt: checkedAt };
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
  // A failed evidence check already says why the registry would not admit the version.
  const reasons = [
    ...evidence.reasons,
    ...plan.reasons.filter((r) => !(r === "release_not_admissible" && evidence.reasons.length)),
  ];
  return { prepared, evidence, plan, holds: unique([...prepared.holds, ...reasons.map(ownerRuleHold)]) };
}

async function present(candidates: readonly OwnerRuleCandidate[], now: Date, readText?: ReadText) {
  if (!candidates.length) return [];
  const leads = unique(candidates.flatMap((c) => c.sources.map((s) => s.leadId)));
  const stored = await storedVersions(candidates.map((c) => c.rule.id));
  const { policy } = await guidancePolicy();
  const captures = await currentSourceCaptures(leads, now, readText ? { readText } : {});
  const watches = await sourceWatchStates(leads);
  const items = [];
  for (const candidate of candidates) {
    const version = nextVersion(stored, candidate.rule.id);
    const { prepared, plan, holds } = await assessCandidate(candidate, {
      version,
      captures,
      policy,
      confirmed: ownerConfirmedChecks,
      now,
    });
    const live = stored.find((s) => s.ruleId === candidate.rule.id && s.status === "published");
    items.push({
      ruleId: candidate.rule.id,
      title: candidate.rule.title,
      reason: candidate.rule.reason,
      nextStep: candidate.rule.nextStep,
      appliesWhen: describeRuleCondition(candidate.rule),
      validFrom: candidate.rule.validFrom,
      validTo: candidate.rule.validTo,
      risk: candidate.risk,
      disclosure: ownerRuleDisclosure,
      version,
      manifestHash: prepared.rule.manifestHash,
      live: live ? { version: live.version, manifestHash: live.manifestHash } : null,
      holds,
      checks: ownerConfirmedChecks.map((id) => ({ id, label: ownerCheckLabels[id] })),
      sources: candidate.sources.map((source) => {
        const watch = watches.find((w) => w.leadId === source.leadId);
        return {
          title: source.title,
          url: allSourceLeads.find((l) => l.id === source.leadId)?.url ?? null,
          locator: source.locator,
          quote: source.quote,
          watched: Boolean(watch),
          checkedAt: watch?.checkedAt ?? null,
          failure: watch?.failureCode ?? null,
          current: Boolean(prepared.snapshotIds[source.id]),
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
    items: await present(
      options.candidates ?? ownerRuleCandidates,
      options.now ?? new Date(),
      options.readText,
    ),
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
  const [item] = await present([candidate], options.now ?? new Date(), options.readText);
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
  return input.action === "withdraw"
    ? withdrawOwnerRule(actor, ruleId, input)
    : signOwnerRule(actor, ruleId, input, options);
}

/**
 * Releases a rule on the owner's sign-off. The owner names the version and manifest they read and
 * confirms each enhanced check; the rule is built again here, and anything that changed or holds it
 * refuses the sign-off. Storage is read before the transaction opens.
 */
async function signOwnerRule(
  actor: StaffActor,
  ruleId: string,
  input: { version: number; manifestHash: string; confirmedChecks: string[] },
  options: Options,
) {
  await asDevelopmentOwner(actor, async () => undefined, refusal);
  const candidate = candidateFor(options.candidates ?? ownerRuleCandidates, ruleId);
  if (ownerConfirmedChecks.some((check) => !input.confirmedChecks.includes(check)))
    throw new ValoProblem(422, "Confirm each of the five checks before signing.");
  const now = options.now ?? new Date();
  const readText = options.readText ?? readSourceText;
  const { db, valoRuleOwnerSignoffs, valoRuleReleases: r } = await import("@workspace/db");
  const version = nextVersion(await storedVersions([ruleId]), ruleId);
  const { policy } = await guidancePolicy();
  const captures = await currentSourceCaptures(unique(candidate.sources.map((s) => s.leadId)), now, {
    readText,
  });
  const { prepared, evidence, plan, holds } = await assessCandidate(candidate, {
    version,
    captures,
    policy,
    confirmed: input.confirmedChecks,
    now,
  });
  if (version !== input.version || prepared.rule.manifestHash !== input.manifestHash)
    throw new ValoProblem(409, "The rule or its sources changed. Reopen it before signing.");
  if (holds.length || evidence.decision !== "eligible" || plan.decision !== "ready")
    throw new ValoProblem(409, "This rule is held. " + holds.join(" "));
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

/** Withdraws a released owner-signed version. It leaves the checker at once and is never published
 * again; releasing the rule again takes a new version and a new sign-off. */
function withdrawOwnerRule(
  actor: StaffActor,
  ruleId: string,
  input: { version: number; manifestHash: string },
) {
  return asDevelopmentOwner(
    actor,
    async (tx) => {
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
        await tx.update(r).set({ status: "withdrawn" }).where(eq(r.id, row.id));
      }
      return { ruleId, version: input.version, state: "withdrawn" as const, superseded: [] };
    },
    refusal,
  );
}
