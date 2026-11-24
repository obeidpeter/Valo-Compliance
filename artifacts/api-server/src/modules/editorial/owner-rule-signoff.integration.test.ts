import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  db,
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
import { currentAssessmentDate, releasedRegistry } from "../rules/valo-assessments";
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
      // The same version cannot be signed twice.
      await assert.rejects(decideOwnerRule(actor(owner), ruleId, sign(first), options), refused(409));

      // A second version supersedes the first, so the checker never holds two.
      [item] = await list();
      assert.equal(item!.version, 2);
      assert.deepEqual(item!.live, { version: 1, manifestHash: first.manifestHash });
      const second = item!;
      assert.deepEqual(await decideOwnerRule(actor(owner), ruleId, sign(second), options), {
        ruleId,
        version: 2,
        state: "published",
        superseded: [1],
      });
      assert.deepEqual(await checkerSays(), {
        versions: [2],
        label: "Likely relevant",
        notice: ownerRuleDisclosure,
      });

      // Withdrawal takes the released version out of the checker at once; a superseded version and a
      // changed manifest are refused, and asking again changes nothing.
      const withdraw = (version: number, manifestHash: string) => ({
        action: "withdraw",
        version,
        manifestHash,
        confirmedChecks: [],
        confirmed: true,
      });
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
    } finally {
      for (const identity of [owner, system])
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, identity));
    }
  },
);
