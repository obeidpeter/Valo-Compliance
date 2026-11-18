import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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
  evaluatePublication,
  factsFromProfile,
  ruleSchema,
  publicationSchema,
  changedCheckerFactPaths,
  explainAssessmentChanges,
  sourceFamilyBindingMatches,
  type CheckerFacts,
} from "@workspace/valo-core";
import { z } from "zod";
import { ValoProblem, authorizeWorkspaceWrite, type WorkspaceActor } from "./valo-store";

import { lockSourceState, sourceTargetAllowed } from "./valo-source-state";
export type WorkspaceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Repository methods recheck membership, including worker and direct-service callers. */
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
    if (!workspace) throw new ValoProblem(404, "Workspace not found");
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

/** No customer endpoint writes this registry or supplies a publication manifest. */
export async function releasedRegistry(tx: WorkspaceTx | typeof db, now: Date) {
  const rows = await tx.select().from(valoRuleReleases).limit(501);
  if (rows.length > 500) throw new ValoProblem(503, "Rule registry exceeds its reviewed operating limit");
  const rules: z.infer<typeof ruleSchema>[] = [],
    trusted = new Set<string>(),
    states: unknown[] = [];
  let excluded = 0;
  for (const row of rows) {
    const rule = ruleSchema.safeParse(row.rule),
      bundle = publicationSchema.safeParse(row.publicationBundle);
    let eligible = false;
    if (rule.success && bundle.success && row.status === "published") {
      const r = rule.data,
        b = bundle.data,
        { manifestHash: _, ...reviewedRule } = r;
      eligible =
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
        r.sources.every(
          (s) =>
            b.sources.some(
              (bs) =>
                bs.id === s.id && bs.hash === s.snapshotHash && bs.url === s.url && bs.text.includes(s.quote),
            ) &&
            b.candidate.claims.some(
              (c) => c.sourceId === s.id && c.locator === s.locator && c.quote === s.quote,
            ),
        );
      if (eligible) eligible = await sourceTargetAllowed(tx, "rule", row.id, b, now);
      if (eligible) {
        rules.push(r);
        trusted.add(r.manifestHash);
      }
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
  if (asOfDate > todayLagos) throw new ValoProblem(422, "Future-dated assessments are not available.");
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(facts.turnoverPeriodStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(facts.turnoverPeriodEnd) &&
    facts.turnoverPeriodStart > facts.turnoverPeriodEnd
  )
    throw new ValoProblem(422, "The turnover period end must not precede its start.");
  z.string().date().parse(asOfDate);
  const registry = await releasedRegistry(tx, now);
  const result = assess(facts, registry.rules, asOfDate, now, { trustedManifestHashes: registry.trusted });
  const { resultHash: _, ...body } = result;
  body.rulesetVersion = digest({ engine: body.rulesetVersion, registry: registry.stateHash });
  if (registry.excluded)
    body.gaps.push(
      `${registry.excluded} registry versions were excluded because their publication evidence is not eligible.`,
    );
  return { ...body, resultHash: digest(body) };
}
export async function previewAssessment(raw: unknown) {
  const facts = checkerFactsSchema.parse(z.object({ facts: z.unknown() }).parse(raw).facts);
  if (facts.rich?.businessName !== undefined)
    throw new ValoProblem(
      401,
      "Sign in to check optional business-name facts. Anonymous checks do not accept name details.",
    );
  const input = PreviewAssessmentBody.strict().parse(raw);
  return runAssessment(facts, input.asOfDate);
}
export async function previewWorkspaceAssessment(actor: WorkspaceActor, raw: unknown) {
  const facts = checkerFactsSchema.parse(z.object({ facts: z.unknown() }).parse(raw).facts);
  const input = PreviewAssessmentBody.strict().parse(raw);
  return workspaceTransaction(actor, (tx) => runAssessment(facts, input.asOfDate, tx));
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
    throw new ValoProblem(503, "Assessment integrity check failed. The saved record was not changed.");
  return result;
}
export async function createAssessment(actor: WorkspaceActor, raw: unknown) {
  const supplied = z.object({ facts: z.unknown().optional() }).parse(raw).facts;
  const suppliedFacts = supplied === undefined ? undefined : checkerFactsSchema.parse(supplied);
  const input = CreateAssessmentBody.strict()
    .refine((i) => i.saveConsent, "Saving requires explicit consent")
    .parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    const [workspace] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, actor.workspaceId));
    if (
      input.expectedProfileRevision !== undefined &&
      input.expectedProfileRevision !== workspace.profileRevision
    )
      throw new ValoProblem(
        409,
        "The business profile changed. Review the current answers before saving.",
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
      throw new ValoProblem(422, "Complete a business profile or provide questionnaire answers first");
    const facts = suppliedFacts ?? factsFromProfile(profile.profile);
    const result = await runAssessment(facts, input.asOfDate, tx);
    const id = randomUUID();
    const [row] = await tx
      .insert(valoAssessments)
      .values({
        id,
        workspaceId: actor.workspaceId,
        profileVersionId: input.facts ? null : profile.id,
        profileRevision: input.facts ? null : profile.revision,
        facts,
        factsHash: digest(facts),
        result,
        resultHash: result.resultHash,
        rulesetVersion: result.rulesetVersion,
        asOfDate: input.asOfDate,
        consentVersion: "assessment-save-v1",
        actorId: actor.identityId,
      })
      .returning();
    await workspaceEvent(tx, actor, "assessment.saved", id);
    return serializeAssessment(row);
  });
}
export async function listAssessments(actor: WorkspaceActor) {
  return workspaceTransaction(actor, async (tx) =>
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
  if (!row) throw new ValoProblem(404, "Assessment not found");
  return row;
}
export async function getAssessment(actor: WorkspaceActor, id: string) {
  return workspaceTransaction(actor, async (tx) => serializeAssessment(await assessmentRow(tx, actor, id)));
}
export async function compareAssessments(actor: WorkspaceActor, id: string, previousId: string) {
  return workspaceTransaction(actor, async (tx) => {
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
        (k) => before.has(k) && digest(before.get(k)) !== digest(after.get(k)),
      ),
      explanations: explainAssessmentChanges(previous.result.items, current.result.items, changedFacts),
    });
  });
}
