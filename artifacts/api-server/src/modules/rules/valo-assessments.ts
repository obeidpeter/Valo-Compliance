import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  valoAssessments,
  valoWorkspaces,
  valoProfileVersions,
  valoRuleReleases,
  valoEvents,
} from "@workspace/db";
import {
  CreateAssessmentBody,
  GetAssessmentResponse,
  CompareAssessmentsResponse,
  PreviewAssessmentBody,
} from "@workspace/api-zod";
import {
  assess,
  canonical,
  checkerFactsSchema,
  digest,
  evaluateOwnerRuleBundle,
  routeOnOfficialHost,
  evaluatePublication,
  factsFromProfile,
  ownerRuleBundleSchema,
  ownerRuleMatchesBundle,
  ruleSchema,
  rulesInUse,
  publicationSchema,
  changedCheckerFactPaths,
  comparableItemDigest,
  explainAssessmentChanges,
  sourceFamilyBindingMatches,
  type CheckerFacts,
} from "@workspace/valo-core";
import { z } from "zod";
import { authorizeWorkspaceRead, authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";

import { lockSourceState, sourceTargetAllowed } from "../sources";
import { guidancePolicy } from "../publication";
import { singleRow } from "../../platform/rows";
export type WorkspaceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Read-only workspace transaction: verifies current membership and tombstone status without
 * acquiring an exclusive workspace row lock. Set `lockSources: true` when reading live rules. */
export async function workspaceReadTransaction<T>(
  actor: WorkspaceActor,
  fn: (tx: WorkspaceTx) => Promise<T>,
  options: { lockSources?: boolean } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    if (options.lockSources) await lockSourceState(tx);
    const [workspace] = await tx
      .select({ id: valoWorkspaces.id })
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, actor.workspaceId));
    if (!workspace) throw new ValoProblem(404, "Your workspace was not found.");
    await authorizeWorkspaceRead(tx, actor);
    return fn(tx);
  });
}
/** Repository write methods recheck membership and hold an exclusive workspace row lock,
 * including worker and direct-service callers. */
export async function workspaceTransaction<T>(
  actor: WorkspaceActor,
  fn: (tx: WorkspaceTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockSourceState(tx);
    const [workspace] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, actor.workspaceId))
      .for("update");
    if (!workspace) throw new ValoProblem(404, "Your workspace was not found.");
    await authorizeWorkspaceWrite(tx, actor);
    return fn(tx);
  });
}
export function workspaceEvent(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  action: string,
  id: string,
  revision?: number,
) {
  return tx.insert(valoEvents).values({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    actorId: actor.identityId,
    action,
    entityId: id,
    revision,
  });
}

type StoredRuleRelease = Pick<
  typeof valoRuleReleases.$inferSelect,
  "ruleId" | "version" | "status" | "rule" | "publicationBundle" | "manifestHash"
>;
/** The guidance policy as it stands now: an owner-signed rule counts only while the policy it was
 * signed under is still the current one and the owner's approval of it stands (decision 0020). */
type CurrentGuidance = { hash: string; ownerApproved: boolean };
/** A rule version released on the development owner's sign-off (decision 0020). Its sign-off was
 * required by the database when it was stored; here its bundle must still describe it exactly, its
 * evidence must still pass, and the policy it was signed under must still be the approved one. */
function parseOwnerSignedRule(
  row: StoredRuleRelease,
  rule: z.infer<typeof ruleSchema>,
  now: Date,
  guidance: CurrentGuidance | undefined,
) {
  const bundle = ownerRuleBundleSchema.safeParse(row.publicationBundle);
  if (!bundle.success || !guidance) return null;
  const admissible =
    rule.id === row.ruleId &&
    rule.version === row.version &&
    rule.manifestHash === row.manifestHash &&
    (!rule.evaluator || sourceFamilyBindingMatches(rule.evaluator)) &&
    ownerRuleMatchesBundle(rule, bundle.data) &&
    evaluateOwnerRuleBundle(bundle.data, now).decision === "eligible" &&
    guidance.ownerApproved &&
    bundle.data.policy.hash === guidance.hash;
  return admissible ? rule : null;
}
function parseEligibleRuleRelease(
  row: StoredRuleRelease,
  now: Date,
  guidance?: CurrentGuidance,
): z.infer<typeof ruleSchema> | null {
  const owner = ruleSchema.safeParse(row.rule);
  if (owner.success && owner.data.provenance === "owner_signoff")
    return row.status === "published" ? parseOwnerSignedRule(row, owner.data, now, guidance) : null;
  const rule = ruleSchema.safeParse(row.rule),
    bundle = publicationSchema.safeParse(row.publicationBundle);
  if (!rule.success || !bundle.success || row.status !== "published") return null;
  const r = rule.data,
    b = bundle.data,
    { manifestHash: _, ...reviewedRule } = r;
  const admissible =
    r.id === row.ruleId &&
    r.version === row.version &&
    b.candidate.version === r.version &&
    r.status === "published" &&
    r.provenance === "editorial_release" &&
    (!r.evaluator || sourceFamilyBindingMatches(r.evaluator)) &&
    r.requirementVersionId === b.candidate.id &&
    b.candidate.contentClass === "sourced_guidance" &&
    b.candidate.body === canonical(reviewedRule) &&
    r.manifestHash === row.manifestHash &&
    row.manifestHash === digest(b.manifest) &&
    evaluatePublication(b, now).decision === "eligible" &&
    routeOnOfficialHost(r, b.policy.officialHosts) &&
    r.sources.every(
      (s) =>
        b.sources.some(
          (bs) =>
            bs.id === s.id && bs.hash === s.snapshotHash && bs.url === s.url && bs.text.includes(s.quote),
        ) &&
        b.candidate.claims.some((c) => c.sourceId === s.id && c.locator === s.locator && c.quote === s.quote),
    );
  return admissible ? r : null;
}
/** Whether the registry admits one stored rule release, apart from its sources' current state
 * (sourceTargetAllowed, which needs the database). */
export function ruleReleaseEligible(row: StoredRuleRelease, now: Date, guidance?: CurrentGuidance) {
  return parseEligibleRuleRelease(row, now, guidance) !== null;
}
/** The current guidance policy's hash and whether the owner's approval of it stands. */
export async function currentRuleGuidance(): Promise<CurrentGuidance> {
  const { policy } = await guidancePolicy();
  return { hash: policy.hash, ownerApproved: policy.ownerApproved };
}
/** No customer endpoint writes this registry or supplies a publication manifest. */
export async function releasedRegistry(tx: WorkspaceTx | typeof db, now: Date) {
  const rows = await tx.select().from(valoRuleReleases).limit(501);
  if (rows.length > 500)
    throw new ValoProblem(
      503,
      "The requirements check is not available at the moment. Nothing was saved or changed.",
    );
  const rules: z.infer<typeof ruleSchema>[] = [],
    trusted = new Set<string>(),
    // CMP-004: when each admitted version was published, as its release record says.
    published = new Map<string, string>(),
    states: unknown[] = [];
  let excluded = 0;
  // The policy file is read only when an owner-signed rule is stored.
  const ownerSigned = rows.some((row) => ruleSchema.safeParse(row.rule).data?.provenance === "owner_signoff");
  const guidance = ownerSigned ? await currentRuleGuidance() : undefined;
  for (const row of rows) {
    const parsed = parseEligibleRuleRelease(row, now, guidance);
    let eligible = parsed !== null;
    if (eligible) eligible = await sourceTargetAllowed(tx, "rule", row.id, row.publicationBundle, now);
    if (eligible && parsed) {
      rules.push(parsed);
      trusted.add(parsed.manifestHash);
      published.set(`${parsed.id}@${parsed.version}`, new Date(row.publishedAt).toISOString());
    }
    states.push({
      id: row.ruleId,
      version: row.version,
      status: row.status,
      manifestHash: row.manifestHash,
      eligible,
    });
    if (!eligible) excluded++;
  }
  return {
    rules,
    trusted,
    published,
    excluded,
    stateHash: digest(states.sort((a, b) => canonical(a).localeCompare(canonical(b)))),
  };
}
export function currentAssessmentDate(now: Date) {
  return new Date(now.getTime() + 3600000).toISOString().slice(0, 10);
}
/** A saved recommendation is historical evidence, not authority for a new task.
 * Reuse the assessment engine's current-date, freshness, implementation and
 * conflicting-version gates against the server-owned registry. Never rewrite
 * the saved facts/result or infer eligibility from reminder preferences. */
export function currentSourceTaskRecommendation(
  facts: unknown,
  registry: Pick<Awaited<ReturnType<typeof releasedRegistry>>, "rules" | "trusted">,
  ruleId: string,
  ruleVersion: number,
  now: Date,
) {
  return assess(checkerFactsSchema.parse(facts), registry.rules, currentAssessmentDate(now), now, {
    trustedManifestHashes: registry.trusted,
  }).items.find(
    (item) =>
      item.ruleId === ruleId &&
      item.ruleVersion === ruleVersion &&
      item.label === "Likely relevant" &&
      item.sourceLinkedTaskEligible !== false,
  );
}
export async function runAssessment(
  facts: CheckerFacts,
  asOfDate: string,
  tx: WorkspaceTx | typeof db = db,
  now = new Date(),
) {
  const todayLagos = currentAssessmentDate(now);
  if (asOfDate > todayLagos) throw new ValoProblem(422, "A check cannot be dated in the future.");
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(facts.turnoverPeriodStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(facts.turnoverPeriodEnd) &&
    facts.turnoverPeriodStart > facts.turnoverPeriodEnd
  )
    throw new ValoProblem(422, "The turnover period cannot end before it starts.");
  z.string().date().parse(asOfDate);
  const registry = await releasedRegistry(tx, now);
  const result = assess(facts, registry.rules, asOfDate, now, {
    trustedManifestHashes: registry.trusted,
    publishedAt: registry.published,
  });
  const { resultHash: _, ...body } = result;
  body.rulesetVersion = digest({ engine: body.rulesetVersion, registry: registry.stateHash });
  if (registry.excluded)
    body.gaps.push(
      `${registry.excluded} registry versions were excluded because their publication evidence is not eligible.`,
    );
  return { ...body, resultHash: digest(body) };
}
/**
 * The released rules the check would use today, and which of the check's rule questions each reads,
 * so that the page asks only their questions (RUL-001). The same release checks as an assessment,
 * through `rulesInUse`; it holds no customer data.
 */
export async function listRulesInUse(now = new Date()) {
  const asOfDate = currentAssessmentDate(now);
  const registry = await releasedRegistry(db, now);
  return {
    asOfDate,
    rules: rulesInUse(registry.rules, asOfDate, now, { trustedManifestHashes: registry.trusted }).map(
      (rule) => ({
        ruleId: rule.id,
        ruleVersion: rule.version,
        title: rule.title,
        family: rule.evaluator?.family ?? null,
      }),
    ),
  };
}
export async function previewAssessment(raw: unknown) {
  const facts = checkerFactsSchema.parse(z.object({ facts: z.unknown() }).parse(raw).facts);
  if (facts.rich?.businessName !== undefined)
    throw new ValoProblem(
      401,
      "Sign in to add details about your business name. A check without an account does not take them.",
    );
  const input = PreviewAssessmentBody.strict().parse(raw);
  return runAssessment(facts, input.asOfDate);
}
export async function previewWorkspaceAssessment(actor: WorkspaceActor, raw: unknown) {
  const facts = checkerFactsSchema.parse(z.object({ facts: z.unknown() }).parse(raw).facts);
  const input = PreviewAssessmentBody.strict().parse(raw);
  return workspaceReadTransaction(actor, (tx) => runAssessment(facts, input.asOfDate, tx), {
    lockSources: true,
  });
}
export function serializeAssessment(row: typeof valoAssessments.$inferSelect) {
  const result = GetAssessmentResponse.parse({
    id: row.id,
    profileRevision: row.profileRevision,
    facts: row.facts,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
  });
  const { resultHash, ...body } = result.result;
  if (resultHash !== row.resultHash || digest(body) !== resultHash || digest(result.facts) !== row.factsHash)
    throw new ValoProblem(
      503,
      "This saved result did not pass Valo's own check of it, so it is not shown. The saved record was not changed.",
    );
  return result;
}
export async function createAssessment(actor: WorkspaceActor, raw: unknown) {
  const supplied = z.object({ facts: z.unknown().optional() }).parse(raw).facts;
  const suppliedFacts = supplied === undefined ? undefined : checkerFactsSchema.parse(supplied);
  const input = CreateAssessmentBody.strict()
    .refine((i) => i.saveConsent, "Saving requires explicit consent")
    .parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    const workspace = singleRow(
      await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId)),
    );
    if (
      input.expectedProfileRevision !== undefined &&
      input.expectedProfileRevision !== workspace.profileRevision
    )
      throw new ValoProblem(
        409,
        "Your business profile has changed. Look over the current answers before you save.",
        workspace.profileRevision,
      );
    const [profile] = await tx
      .select()
      .from(valoProfileVersions)
      .where(
        and(
          eq(valoProfileVersions.workspaceId, actor.workspaceId),
          eq(valoProfileVersions.revision, workspace.profileRevision),
        ),
      );
    if (!input.facts && !profile)
      throw new ValoProblem(422, "Fill in your business profile, or answer the check's questions, first.");
    // Without supplied facts, the check above found the profile: each `profile!` below relies on it.
    const facts = suppliedFacts ?? factsFromProfile(profile!.profile);
    const result = await runAssessment(facts, input.asOfDate, tx);
    const id = randomUUID();
    const row = singleRow(
      await tx
        .insert(valoAssessments)
        .values({
          id,
          workspaceId: actor.workspaceId,
          profileVersionId: input.facts ? null : profile!.id,
          profileRevision: input.facts ? null : profile!.revision,
          facts,
          factsHash: digest(facts),
          result,
          resultHash: result.resultHash,
          rulesetVersion: result.rulesetVersion,
          asOfDate: input.asOfDate,
          consentVersion: "assessment-save-v1",
          actorId: actor.identityId,
        })
        .returning(),
    );
    await workspaceEvent(tx, actor, "assessment.saved", id);
    return serializeAssessment(row);
  });
}
export async function listAssessments(actor: WorkspaceActor) {
  return workspaceReadTransaction(actor, async (tx) =>
    (
      await tx
        .select()
        .from(valoAssessments)
        .where(eq(valoAssessments.workspaceId, actor.workspaceId))
        .orderBy(desc(valoAssessments.createdAt))
        .limit(200)
    ).map(serializeAssessment),
  );
}
export async function assessmentRow(tx: WorkspaceTx, actor: WorkspaceActor, id: string) {
  const [row] = await tx
    .select()
    .from(valoAssessments)
    .where(and(eq(valoAssessments.workspaceId, actor.workspaceId), eq(valoAssessments.id, id)));
  if (!row) throw new ValoProblem(404, "This saved result was not found in your workspace.");
  return row;
}
export async function getAssessment(actor: WorkspaceActor, id: string) {
  return workspaceReadTransaction(actor, async (tx) => {
    const saved = serializeAssessment(await assessmentRow(tx, actor, id));
    // A result none of whose rules changed is read exactly as it was saved.
    const ruleChanges = await savedRuleChanges(tx, actor, saved.result.items);
    return ruleChanges.length ? { ...saved, ruleChanges } : saved;
  });
}
/**
 * CMP-005 and EDP-011 (docs/architecture/rule-changes.md, slice 3): each change since to a rule version
 * a saved result lists, from the workspace's own rule notices, read or not. The database wrote one for
 * the workspace when the version changed, since the workspace saved this result under it. The result
 * itself is unchanged.
 */
async function savedRuleChanges(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  items: readonly { ruleId: string; ruleVersion: number }[],
) {
  if (!items.length) return [];
  const { valoRuleNotices: n } = await import("@workspace/db");
  const listed = new Set(items.map((item) => `${item.ruleId}@${item.ruleVersion}`));
  const rows = await tx
    .select()
    .from(n)
    .where(
      and(
        eq(n.workspaceId, actor.workspaceId),
        inArray(
          n.ruleId,
          items.map((item) => item.ruleId),
        ),
      ),
    )
    .orderBy(n.createdAt, n.id);
  return rows
    .filter((row) => listed.has(`${row.ruleId}@${row.version}`))
    .slice(0, 100)
    .map((row) => ({
      ruleId: row.ruleId,
      version: row.version,
      kind: row.kind as "replaced" | "withdrawn",
      replacementVersion: row.replacementVersion,
      reason: row.reason,
      changedAt: row.createdAt.toISOString(),
    }));
}
export async function compareAssessments(actor: WorkspaceActor, id: string, previousId: string) {
  return workspaceReadTransaction(actor, async (tx) => {
    const current = serializeAssessment(await assessmentRow(tx, actor, id));
    const previous = serializeAssessment(await assessmentRow(tx, actor, previousId));
    const before = new Map(previous.result.items.map((i) => [i.ruleId, i]));
    const after = new Map(current.result.items.map((i) => [i.ruleId, i]));
    const changedFacts = changedCheckerFactPaths(previous.facts, current.facts);
    return CompareAssessmentsResponse.parse({
      previousId,
      currentId: id,
      changedFacts,
      addedRuleIds: [...after.keys()].filter((k) => !before.has(k)),
      removedRuleIds: [...before.keys()].filter((k) => !after.has(k)),
      changedRuleIds: [...after.keys()].filter(
        (k) => before.has(k) && comparableItemDigest(before.get(k)!) !== comparableItemDigest(after.get(k)!),
      ),
      explanations: explainAssessmentChanges(previous.result.items, current.result.items, changedFacts),
    });
  });
}
