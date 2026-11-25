import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, valoStaffAssignments, valoStaffRoleChanges } from "@workspace/db";
import { allSourceLeads, ownerConfirmedChecks, sha256 } from "@workspace/valo-core";
import {
  decideOwnerRule,
  listOwnerRules,
  watchOwnerRuleSources,
  type OwnerRuleCandidate,
} from "../modules/editorial/owner-rule-signoff";
import { guidancePolicy } from "../modules/publication";

/**
 * Releases one rule into this disposable database on a synthetic development owner's sign-off
 * (decision 0020), through the service the staff routes call, as the sign-off's own test does: a
 * synthetic owner the operator bootstrap granted, a watch of an official source no other test
 * watches, a synthetic capture holding a synthetic passage the rule quotes, and the sign-off of the
 * exact version shown. The rule keeps its own calculation; its source and evidence are synthetic.
 * Synthetic records only, in development only.
 */
export async function signRuleForTest(
  rule: OwnerRuleCandidate["rule"],
  scenarios: OwnerRuleCandidate["scenarios"],
) {
  const { policy } = await guidancePolicy();
  const watched = (
    await db.execute<{ source_id: string }>(sql`select source_id from valo_source_watches`)
  ).rows.map((row) => row.source_id);
  const lead = [...allSourceLeads]
    .reverse()
    .find((s) => policy.officialHosts.includes(new URL(s.url).hostname) && !watched.includes(s.id));
  if (!lead) throw new Error("No unwatched official source on the policy's hosts");
  const id = randomUUID();
  const passageId = `SYNTHETIC-SIGNED-${id}`;
  const passage = "1. Synthetic provision for a controlled test: keep a dated record of each sale.";
  const quote = "keep a dated record of each sale";
  const text = `Synthetic official copy. ${passage} End of the synthetic copy.`;
  const snapshotId = randomUUID(),
    raw = `synthetic raw bytes ${snapshotId}`;
  const readText = async (snapshot: string, checksum: string) => {
    if (snapshot !== snapshotId || checksum !== sha256(text))
      throw new Error("SOURCE_STORAGE_CHECKSUM_FAILED");
    return text;
  };
  const instrument = {
    id: `SYNTHETIC-SIGNED-ACT-${id}`,
    kind: "act" as const,
    url: lead.url,
    title: "Synthetic Act",
    issuingBody: "Synthetic test authority",
    effectiveFrom: "2020-01-01T00:00:00+01:00",
  };
  const evidence = {
    passagesFrom:
      (captures: readonly { url: string; text: string; rawChecksum: string; checkedAt: string }[]) =>
      (wanted: string) => {
        const today = captures.find((c) => c.url === lead.url);
        if (wanted !== passageId || !today?.text.includes(passage)) return undefined;
        return {
          id: wanted,
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
        commencement: { printed: "[1st Day of January, 2020]", effectiveFrom: instrument.effectiveFrom },
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
  const candidate: OwnerRuleCandidate = {
    rule,
    risk: "governance",
    scope: "Synthetic testing only",
    limitations: "Not content for publication",
    assumptions: [],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sources: [{ id: "synthetic-source", passageId, leadId: lead.id, locator: "section 1", quote }],
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
    scenarios,
  };
  const options = { candidates: [candidate], readText, evidence };

  const owner = `synthetic-signing-owner-${id}`,
    assignment = randomUUID();
  await db.insert(valoStaffAssignments).values({
    id: assignment,
    identityId: owner,
    role: "system",
    grantedBy: "synthetic operator",
    reason: "Synthetic rule signing for a test",
  });
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
  const actor = () => ({ identityId: owner, recentMfa: true, verifiedAt: Date.now() });

  await watchOwnerRuleSources(actor(), rule.id, { watch: "official_sources" }, options);
  const checkedAt = new Date();
  await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
    values(${snapshotId}::uuid,${lead.id},${lead.url},${checkedAt},${checkedAt},'retrieved_unreviewed',200,'text/plain',${sha256(raw)},${sha256(text)},
    ${"synthetic-ci-not-a-retained-file/" + snapshotId + "/raw"},${"synthetic-ci-not-a-retained-file/" + snapshotId + "/text"},${text.length},'controlled-no-extraction','{"synthetic":true}')`);
  await db.execute(
    sql`update valo_source_watches set checked_at=${checkedAt},failure_code=null,last_snapshot_id=${snapshotId}::uuid,last_raw_hash=${sha256(raw)} where source_id=${lead.id}`,
  );
  const [shown] = (await listOwnerRules(actor(), options)).items;
  if (!shown || shown.holds.length) throw new Error(`The rule is held: ${shown?.holds.join(" ")}`);
  await decideOwnerRule(
    actor(),
    rule.id,
    {
      action: "sign",
      version: shown.version,
      manifestHash: shown.manifestHash,
      confirmedChecks: [...ownerConfirmedChecks],
      confirmed: true,
    },
    options,
  );
  return {
    version: shown.version,
    withdraw: (reason: string) =>
      decideOwnerRule(
        actor(),
        rule.id,
        {
          action: "withdraw",
          version: shown.version,
          manifestHash: shown.manifestHash,
          confirmedChecks: [],
          confirmed: true,
          reason,
        },
        options,
      ),
  };
}
