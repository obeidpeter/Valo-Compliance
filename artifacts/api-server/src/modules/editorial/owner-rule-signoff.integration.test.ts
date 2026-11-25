import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  valoEvents,
  valoRuleChanges,
  valoRuleNotices,
  valoTasks,
  valoRuleOwnerSignoffs,
  valoRuleReleases,
  valoStaffAssignments,
  valoStaffRoleChanges,
} from "@workspace/db";
import {
  allSourceLeads,
  assess,
  checkerFactsSchema,
  ownerConfirmedChecks,
  ownerRuleDisclosure,
  sha256,
} from "@workspace/valo-core";
import { ValoProblem } from "../../platform/valo-problem";
import { guidancePolicy } from "../publication";
import {
  createAssessment,
  currentAssessmentDate,
  getAssessment,
  releasedRegistry,
} from "../rules/valo-assessments";
import {
  actOnContentSupportEscalation,
  actOnSupportCase,
  createTicket,
  customerSupportCases,
} from "../support";
import { createTask, listReminders, listTasks, saveReminderPreferences } from "../tasks/valo-tasks";
import { resolveWorkspace } from "../workspaces";
import {
  decideOwnerRule,
  listOwnerRules,
  watchOwnerRuleSources,
  type OwnerRuleCandidate,
} from "./owner-rule-signoff";

const facts = checkerFactsSchema.parse({
  legalForm: "company",
  registrationStatus: "registered",
  activities: ["retail"],
  state: "Lagos",
  lga: "unknown",
  employees: "unknown",
  turnoverBand: "unknown",
  turnoverYear: "unknown",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "unknown",
  manufacturing: "no",
  importing: "no",
  personalData: "unknown",
});
const refused = (status: number) => (error: unknown) =>
  error instanceof ValoProblem && error.status === status;

// Decision 0020: a requirements-checker rule released on the development owner's sign-off, through
// the service the staff routes call. The rule, its source text and the owner are synthetic, and it is
// released only into this disposable database, in the step that runs after every other suite.
test(
  "the development owner watches a prepared rule's sources, signs the exact version shown, supersedes it and withdraws it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const { policy } = await guidancePolicy();
    assert.ok(policy.ownerApproved, "the guidance policy the owner approved stands");
    // An official source on the policy's hosts that no other test watches. Its stored text is
    // synthetic and is read through a stand-in for private storage, which CI does not have; the
    // watch, capture, bindings, sign-off and every check on them are the real ones.
    const watched = (
      await db.execute<{ source_id: string }>(sql`select source_id from valo_source_watches`)
    ).rows.map((row) => row.source_id);
    const lead = [...allSourceLeads]
      .reverse()
      .find((s) => policy.officialHosts.includes(new URL(s.url).hostname) && !watched.includes(s.id));
    assert.ok(lead, "an unwatched official source on the policy's hosts");
    const passage =
      "1. Synthetic provision for a controlled sign-off test: keep a dated record of each sale.";
    const quote = "keep a dated record of each sale";
    const text = `Synthetic official copy. ${passage} End of the synthetic copy.`;
    const snapshotId = randomUUID(),
      raw = `synthetic raw bytes ${snapshotId}`;
    const readText = async (id: string, checksum: string) => {
      if (id !== snapshotId || checksum !== sha256(text)) throw new Error("SOURCE_STORAGE_CHECKSUM_FAILED");
      return text;
    };
    // A synthetic text, its passage and its amendment record, in place of the guides' registry: the
    // passage is read from today's capture of the lead, and the record searched an official address
    // yesterday for later amendments.
    const instrument = {
      id: "SYNTHETIC-SIGNOFF-ACT",
      kind: "act" as const,
      url: lead.url,
      title: "Synthetic Act",
      issuingBody: "Synthetic test authority",
      effectiveFrom: "2026-01-01T00:00:00+01:00",
    };
    const evidence = {
      passagesFrom:
        (captures: readonly { url: string; text: string; rawChecksum: string; checkedAt: string }[]) =>
        (passageId: string) => {
          const today = captures.find((c) => c.url === lead.url);
          if (passageId !== "SYNTHETIC-SIGNOFF-1" || !today?.text.includes(passage)) return undefined;
          return {
            id: passageId,
            recordedLocator: "section 1; PDF1",
            text: passage,
            hash: sha256(passage),
            sections: ["1"],
            instrument: { ...instrument, rawSha256: today.rawChecksum, retrievedAt: today.checkedAt },
          };
        },
      records: [
        {
          instrument: instrument.id,
          title: instrument.title,
          url: lead.url,
          rawSha256: sha256(raw),
          commencement: { printed: "[1st Day of January, 2026]", effectiveFrom: instrument.effectiveFrom },
          searches: [
            {
              place: "Synthetic official list of Acts",
              url: lead.url,
              searchedAt: new Date(Date.now() - 86_400_000).toISOString(),
              rawSha256: "b".repeat(64),
              found: "Nothing later",
            },
          ],
          amendments: [],
          notRead: [],
          conflicts: [],
          limits: "A synthetic record for a test only.",
        },
      ],
    };

    const id = randomUUID();
    const ruleId = "synthetic-owner-rule-" + id;
    const candidate: OwnerRuleCandidate = {
      rule: {
        id: ruleId,
        requirementVersionId: "synthetic-requirement-" + id,
        title: "Synthetic owner-signed rule; not Nigerian guidance",
        jurisdiction: { level: "federal" },
        validFrom: "2026-01-01",
        validTo: null,
        reason: "Synthetic reason why this may matter.",
        nextStep: "Synthetic next step.",
        relatedTemplateIds: [],
        condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
      },
      risk: "privacy",
      scope: "Synthetic sign-off testing only",
      limitations: "Not content for publication",
      assumptions: [],
      unresolvedMaterialIssues: [],
      missingEvidence: [],
      sources: [
        {
          id: "synthetic-source",
          passageId: "SYNTHETIC-SIGNOFF-1",
          leadId: lead.id,
          locator: "section 1",
          quote,
        },
      ],
      claims: [
        {
          text: "Synthetic claim",
          kind: "source_statement",
          sourceId: "synthetic-source",
          quote,
          locator: "section 1",
          numbers: [],
        },
      ],
      rights: {
        status: "cleared",
        evidence: "Synthetic rights fixture",
        evidenceHash: sha256("fixture"),
        commercialUse: true,
      },
      scenarios: [
        {
          id: "company",
          facts,
          asOfDate: currentAssessmentDate(new Date()),
          expectedLabel: "Likely relevant",
          critical: true,
        },
      ],
    };
    const options = { candidates: [candidate], readText, evidence };

    // The designated development owner (a permanent system role the operator bootstrap granted), and
    // an ordinary system staff member who is not the owner.
    const owner = "synthetic-rule-owner-" + id,
      system = "synthetic-rule-system-" + id,
      assignment = randomUUID();
    await db.insert(valoStaffAssignments).values(
      [
        { id: assignment, identityId: owner },
        { id: randomUUID(), identityId: system },
      ].map((row) => ({
        ...row,
        role: "system" as const,
        grantedBy: "synthetic operator",
        reason: "Synthetic rule sign-off test",
      })),
    );
    // Support and content staff, who refer a reported problem with the rule and triage it.
    const support = "synthetic-rule-support-" + id,
      content = "synthetic-rule-content-" + id;
    await db.insert(valoStaffAssignments).values(
      [
        { identityId: support, role: "support" as const },
        { identityId: content, role: "content" as const },
      ].map((row) => ({
        ...row,
        id: randomUUID(),
        grantedBy: "synthetic operator",
        reason: "Synthetic rule referral test",
      })),
    );
    await db.insert(valoStaffRoleChanges).values({
      id: randomUUID(),
      requestKey: randomUUID(),
      inputHash: sha256("synthetic"),
      actorId: "operator-bootstrap:synthetic",
      actorAssignmentId: assignment,
      assignmentId: assignment,
      targetIdentityId: owner,
      action: "grant",
      role: "system",
      reason: "Synthetic rule owner fixture",
      after: { active: true },
      targetVerifiedAt: new Date(),
    });
    const actor = (identityId: string, recentMfa = true) => ({
      identityId,
      recentMfa,
      verifiedAt: Date.now(),
    });
    const list = async () => (await listOwnerRules(actor(owner), options)).items;
    const checkerSays = async () => {
      const now = new Date();
      const registry = await releasedRegistry(db, now);
      const item = assess(facts, registry.rules, currentAssessmentDate(now), now, {
        trustedManifestHashes: registry.trusted,
      }).items.find((i) => i.ruleId === ruleId);
      // EDP-008: the result says how its rule was released.
      return {
        versions: registry.rules.filter((r) => r.id === ruleId).map((r) => r.version),
        label: item?.label,
        notice: item?.releaseNotice,
      };
    };
    // CMP-004 (docs/architecture/results.md, slice 4): the result dates the rule's source check, and
    // its release on the owner's sign-off, from its release record.
    const datesSay = async () => {
      const now = new Date();
      const registry = await releasedRegistry(db, now);
      const item = assess(facts, registry.rules, currentAssessmentDate(now), now, {
        trustedManifestHashes: registry.trusted,
        publishedAt: registry.published,
      }).items.find((i) => i.ruleId === ruleId);
      return { sourceCheckedAt: item?.sourceCheckedAt, publication: item?.publication };
    };
    try {
      // Only the owner, recently verified, sees the prepared rules.
      await assert.rejects(listOwnerRules(actor(system), options), refused(403));
      await assert.rejects(listOwnerRules(actor(owner, false), options), refused(403));

      // Before its source is watched and read, the rule is held for want of a current copy.
      let [item] = await list();
      assert.equal(item!.version, 1);
      assert.equal(item!.live, null);
      const noCopy = `${lead.title} has no copy of its official source checked within the last day.`;
      assert.deepEqual(item!.holds, [noCopy]);
      assert.deepEqual(
        item!.sources.map((s) => [s.watched, s.checkedAt, s.current]),
        [[false, null, false]],
      );
      assert.equal(item!.appliesWhen, "When legal form is company.");
      await assert.rejects(
        watchOwnerRuleSources(actor(owner), "synthetic-not-prepared", { watch: "official_sources" }, options),
        refused(404),
      );
      await assert.rejects(
        watchOwnerRuleSources(actor(system), ruleId, { watch: "official_sources" }, options),
        refused(403),
      );
      item = await watchOwnerRuleSources(actor(owner), ruleId, { watch: "official_sources" }, options);
      assert.deepEqual(
        item.sources.map((s) => [s.watched, s.checkedAt, s.current]),
        [[true, null, false]],
      );

      // The daily source check reads the source: a current capture whose text holds the passage.
      const checkedAt = new Date();
      await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
        values(${snapshotId}::uuid,${lead.id},${lead.url},${checkedAt},${checkedAt},'retrieved_unreviewed',200,'text/plain',${sha256(raw)},${sha256(text)},
        ${"synthetic-ci-not-a-retained-file/" + snapshotId + "/raw"},${"synthetic-ci-not-a-retained-file/" + snapshotId + "/text"},${text.length},'controlled-no-extraction','{"synthetic":true}')`);
      await db.execute(
        sql`update valo_source_watches set checked_at=${checkedAt},failure_code=null,last_snapshot_id=${snapshotId}::uuid,last_raw_hash=${sha256(raw)} where source_id=${lead.id}`,
      );
      [item] = await list();
      assert.deepEqual(item!.holds, []);
      assert.deepEqual(
        item!.sources.map((s) => [s.watched, s.current]),
        [[true, true]],
      );
      assert.deepEqual(
        item!.scenarios.map((s) => [s.id, s.actualLabel, s.passed]),
        [["company", "Likely relevant", true]],
      );
      assert.deepEqual(await checkerSays(), { versions: [], label: undefined, notice: undefined });

      // The owner signs exactly the version and manifest shown, with every check confirmed.
      const sign = (shown: NonNullable<typeof item>, change: Record<string, unknown> = {}) => ({
        action: "sign",
        version: shown.version,
        manifestHash: shown.manifestHash,
        confirmedChecks: [...ownerConfirmedChecks],
        confirmed: true,
        ...change,
      });
      const first = item!;
      await assert.rejects(
        decideOwnerRule(
          actor(owner),
          ruleId,
          sign(first, { confirmedChecks: ownerConfirmedChecks.slice(1) }),
          options,
        ),
        refused(422),
      );
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, sign(first, { manifestHash: "f".repeat(64) }), options),
        refused(409),
      );
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, sign(first, { version: 2 }), options),
        refused(409),
      );
      await assert.rejects(decideOwnerRule(actor(system), ruleId, sign(first), options), refused(403));
      await assert.rejects(decideOwnerRule(actor(owner), ruleId, sign(first, { confirmed: false }), options));
      assert.deepEqual(await decideOwnerRule(actor(owner), ruleId, sign(first), options), {
        ruleId,
        version: 1,
        state: "published",
        superseded: [],
      });
      const [release] = await db.select().from(valoRuleReleases).where(eq(valoRuleReleases.ruleId, ruleId));
      assert.equal(release!.status, "published");
      assert.equal(release!.manifestHash, first.manifestHash);
      assert.equal((release!.rule as { provenance: string }).provenance, "owner_signoff");
      const [signature] = await db
        .select()
        .from(valoRuleOwnerSignoffs)
        .where(eq(valoRuleOwnerSignoffs.ruleId, ruleId));
      assert.equal(signature!.ownerIdentityId, owner);
      assert.equal(signature!.manifestHash, first.manifestHash);
      assert.deepEqual(signature!.confirmedChecks, [...ownerConfirmedChecks]);
      assert.equal(+signature!.sourceCheckedAt, +checkedAt);
      assert.deepEqual(
        (
          await db.execute(
            sql`select source_id, snapshot_id from valo_source_release_bindings where target_kind='rule' and target_id=${release!.id}::uuid`,
          )
        ).rows,
        [{ source_id: lead.id, snapshot_id: snapshotId }],
      );
      assert.deepEqual(await checkerSays(), {
        versions: [1],
        label: "Likely relevant",
        notice: ownerRuleDisclosure,
      });
      const [releaseRow] = (
        await db.execute<{ published_at: Date | string; rule: { sourceCheckedAt: string } }>(
          sql`select published_at, rule from valo_rule_releases where rule_id=${ruleId} and version=1`,
        )
      ).rows;
      assert.deepEqual(await datesSay(), {
        sourceCheckedAt: releaseRow!.rule.sourceCheckedAt,
        publication: {
          route: "owner_signoff",
          publishedAt: new Date(releaseRow!.published_at).toISOString(),
        },
      });
      // The same version cannot be signed twice.
      await assert.rejects(decideOwnerRule(actor(owner), ruleId, sign(first), options), refused(409));

      // RUL-009: "a rule change flags existing tasks for review rather than silently deleting or
      // backdating them". A synthetic customer saves a result under version 1 and makes a dated task
      // from it, with reminders on.
      const customer = await resolveWorkspace("synthetic-rule-task-" + id);
      await saveReminderPreferences(customer, { enabled: true, offsets: [1, 7], expectedRevision: 0 });
      const saved = await createAssessment(customer, {
        facts,
        asOfDate: currentAssessmentDate(new Date()),
        saveConsent: true,
      });
      assert.equal(saved.result.items.find((i) => i.ruleId === ruleId)?.ruleVersion, 1);
      const due = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
      const made = await createTask(customer, {
        title: "Synthetic task from a signed rule",
        notes: "Synthetic notes",
        dueDate: due,
        dateConfirmed: true,
        assessmentId: saved.id,
        ruleId,
      });
      assert.equal(made.needsReview, false);
      const remindersOf = async () =>
        (await listReminders(customer)).filter((r) => r.taskId === made.id).map((r) => [r.status, r.reason]);
      assert.deepEqual(await remindersOf(), [
        ["held", "EMAIL_PROVIDER_NOT_CONFIGURED"],
        ["held", "EMAIL_PROVIDER_NOT_CONFIGURED"],
      ]);
      const reviewEvents = async () =>
        (
          await db
            .select()
            .from(valoEvents)
            .where(
              and(
                eq(valoEvents.workspaceId, customer.workspaceId),
                eq(valoEvents.entityId, made.id),
                eq(valoEvents.action, "task.source_review_required"),
              ),
            )
        ).length;
      assert.equal(await reviewEvents(), 0);

      // A second version supersedes the first, so the checker never holds two. It says what changed
      // (docs/architecture/rule-changes.md): without that, or with fewer than 20 characters once
      // trimmed, it is refused and nothing is released.
      [item] = await list();
      assert.equal(item!.version, 2);
      assert.deepEqual(item!.live, { version: 1, manifestHash: first.manifestHash });
      const second = item!;
      const changes = () =>
        db
          .select({
            version: valoRuleChanges.version,
            kind: valoRuleChanges.kind,
            replacementVersion: valoRuleChanges.replacementVersion,
            reason: valoRuleChanges.reason,
            recordedBy: valoRuleChanges.recordedBy,
            workspaces: valoRuleChanges.workspaces,
            results: valoRuleChanges.results,
            tasks: valoRuleChanges.tasks,
          })
          .from(valoRuleChanges)
          .where(eq(valoRuleChanges.ruleId, ruleId))
          .orderBy(valoRuleChanges.version);
      await assert.rejects(decideOwnerRule(actor(owner), ruleId, sign(second), options), refused(422));
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, sign(second, { reason: "   Too short.            " }), options),
        refused(422),
      );
      assert.deepEqual(await checkerSays(), {
        versions: [1],
        label: "Likely relevant",
        notice: ownerRuleDisclosure,
      });
      assert.deepEqual(await changes(), []);
      const changedWhy = "Synthetic change: the second version restates the synthetic provision.";
      assert.deepEqual(
        await decideOwnerRule(actor(owner), ruleId, sign(second, { reason: `  ${changedWhy}  ` }), options),
        { ruleId, version: 2, state: "published", superseded: [1] },
      );
      // The change is recorded with its reason, who made it and whom it affected: the one workspace,
      // with its saved result and its task made under version 1.
      assert.deepEqual(await changes(), [
        {
          version: 1,
          kind: "replaced",
          replacementVersion: 2,
          reason: changedWhy,
          recordedBy: owner,
          workspaces: 1,
          results: 1,
          tasks: 1,
        },
      ]);
      assert.deepEqual(await checkerSays(), {
        versions: [2],
        label: "Likely relevant",
        notice: ownerRuleDisclosure,
      });
      // The task made under version 1 is flagged for review in the change's own transaction, before
      // anything reads the workspace's tasks (docs/architecture/rule-changes.md, slice 2). It keeps its
      // date, state and notes and is not deleted; its reminders are called off with the reason, and the
      // change is recorded once.
      const [stored] = await db
        .select({ needsReview: valoTasks.needsReview })
        .from(valoTasks)
        .where(eq(valoTasks.id, made.id));
      assert.equal(stored!.needsReview, true);
      assert.equal(await reviewEvents(), 1);
      // The customer is told once, with the reason, its saved result and its task.
      const notices = async () =>
        db
          .select({
            version: valoRuleNotices.version,
            kind: valoRuleNotices.kind,
            replacementVersion: valoRuleNotices.replacementVersion,
            reason: valoRuleNotices.reason,
            results: valoRuleNotices.results,
            tasks: valoRuleNotices.tasks,
          })
          .from(valoRuleNotices)
          .where(
            and(eq(valoRuleNotices.ruleId, ruleId), eq(valoRuleNotices.workspaceId, customer.workspaceId)),
          )
          .orderBy(valoRuleNotices.version);
      assert.deepEqual(await notices(), [
        { version: 1, kind: "replaced", replacementVersion: 2, reason: changedWhy, results: 1, tasks: 1 },
      ]);
      // The saved result is read as it was saved, with the change to the version it lists
      // (docs/architecture/rule-changes.md, slice 3).
      const reread = await getAssessment(customer, saved.id);
      assert.equal(reread.result.resultHash, saved.result.resultHash);
      const [notice] = await db
        .select({ createdAt: valoRuleNotices.createdAt })
        .from(valoRuleNotices)
        .where(
          and(eq(valoRuleNotices.ruleId, ruleId), eq(valoRuleNotices.workspaceId, customer.workspaceId)),
        );
      const change = {
        ruleId,
        version: 1,
        kind: "replaced",
        replacementVersion: 2,
        reason: changedWhy,
        changedAt: notice!.createdAt.toISOString(),
      };
      assert.deepEqual(reread.ruleChanges, [change]);
      assert.deepEqual((await listTasks(customer)).find((t) => t.id === made.id)?.ruleChange, change);
      const flagged = (await listTasks(customer)).find((t) => t.id === made.id);
      assert.deepEqual(
        {
          needsReview: flagged?.needsReview,
          dueDate: flagged?.dueDate,
          state: flagged?.state,
          notes: flagged?.notes,
        },
        { needsReview: true, dueDate: due, state: "not_started", notes: "Synthetic notes" },
      );
      assert.deepEqual(await remindersOf(), [
        ["cancelled", "SOURCE_NO_LONGER_ELIGIBLE"],
        ["cancelled", "SOURCE_NO_LONGER_ELIGIBLE"],
      ]);
      assert.equal(await reviewEvents(), 1);
      await listTasks(customer);
      assert.equal(await reviewEvents(), 1);

      // Withdrawal takes the released version out of the checker at once, with its reason; a
      // superseded version and a changed manifest are refused, and asking again changes nothing.
      const withdrawnWhy = "Synthetic withdrawal: the synthetic provision no longer applies.";
      // null sends no reason: an undefined argument would take the default.
      const withdraw = (version: number, manifestHash: string, reason: string | null = withdrawnWhy) => ({
        action: "withdraw",
        version,
        manifestHash,
        confirmedChecks: [],
        confirmed: true,
        ...(reason !== null && { reason }),
      });
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, withdraw(2, second.manifestHash, null), options),
        refused(422),
      );
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, withdraw(1, first.manifestHash), options),
        refused(409),
      );
      await assert.rejects(
        decideOwnerRule(actor(owner), ruleId, withdraw(2, "f".repeat(64)), options),
        refused(409),
      );
      await assert.rejects(
        decideOwnerRule(actor(system), ruleId, withdraw(2, second.manifestHash), options),
        refused(403),
      );
      const withdrawn = { ruleId, version: 2, state: "withdrawn", superseded: [] };
      assert.deepEqual(
        await decideOwnerRule(actor(owner), ruleId, withdraw(2, second.manifestHash), options),
        withdrawn,
      );
      assert.deepEqual(
        await decideOwnerRule(actor(owner), ruleId, withdraw(2, second.manifestHash), options),
        withdrawn,
      );
      assert.deepEqual(await checkerSays(), { versions: [], label: undefined, notice: undefined });
      // Recorded once: no workspace saved a result or made a task under version 2.
      assert.deepEqual((await changes()).slice(1), [
        {
          version: 2,
          kind: "withdrawn",
          replacementVersion: null,
          reason: withdrawnWhy,
          recordedBy: owner,
          workspaces: 0,
          results: 0,
          tasks: 0,
        },
      ]);
      // No workspace used version 2, so its withdrawal tells nobody.
      assert.equal((await notices()).length, 1);
      [item] = await list();
      assert.equal(item!.version, 3);
      assert.equal(item!.live, null);

      // Once its source's check is over a day old, the rule is held again and cannot be signed.
      await db.execute(
        sql`update valo_source_watches set checked_at=${new Date(Date.now() - 2 * 86_400_000)} where source_id=${lead.id}`,
      );
      [item] = await list();
      assert.deepEqual(item!.holds, [noCopy]);
      await assert.rejects(decideOwnerRule(actor(owner), ruleId, sign(item!), options), refused(409));

      // docs/architecture/library-holds.md, slice 3 (ADM-008): a support referral of a version the owner
      // signed, here the one since withdrawn, reaches the owner's panel as well as the triage queue. Held
      // through the source controls, it says so; resolved, it leaves the panel.
      assert.deepEqual(item!.referrals, []);
      const reporter = await resolveWorkspace("synthetic-rule-referral-" + id);
      const { reference } = await createTicket(reporter, {
        category: "support",
        scope: "Synthetic report that a signed rule's next step reads wrongly.",
        contactEmail: `synthetic-rule-referral-${id}@example.invalid`,
        sharingConsent: true,
      });
      const caseId = (await customerSupportCases(reporter)).cases.find((c) => c.reference === reference)!.id;
      const [withdrawnRelease] = await db
        .select({ id: valoRuleReleases.id })
        .from(valoRuleReleases)
        .where(and(eq(valoRuleReleases.ruleId, ruleId), eq(valoRuleReleases.version, 2)));
      const why = "Synthetic referral: the customer says the signed rule's next step reads wrongly.";
      const referred = await actOnSupportCase(actor(support), caseId, {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        action: "escalate_content",
        body: why,
        targetKind: "rule",
        targetId: withdrawnRelease!.id,
      });
      [item] = await list();
      assert.deepEqual(
        item!.referrals.map(({ referredAt: _at, ...referral }) => referral),
        [{ reference, version: 2, status: "queued", reason: why, held: false }],
      );
      const referral = referred.escalations![0]!;
      const held = await actOnContentSupportEscalation(actor(content), referral.id, {
        idempotencyKey: randomUUID(),
        expectedVersion: referred.case.version,
        action: "hold_and_reassess",
        body: "Synthetic triage: hold the signed version for the owner to check.",
      });
      assert.ok(held.escalation.sourceImpactId);
      [item] = await list();
      assert.deepEqual(
        item!.referrals.map((r) => [r.status, r.held]),
        [["acknowledged", true]],
      );
      await actOnContentSupportEscalation(actor(content), referral.id, {
        idempotencyKey: randomUUID(),
        expectedVersion: held.caseVersion,
        action: "resolve",
        body: "Synthetic triage: the owner withdrew the version, so this is resolved.",
      });
      [item] = await list();
      assert.deepEqual(item!.referrals, []);
    } finally {
      for (const identity of [owner, system, support, content])
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, identity));
    }
  },
);
