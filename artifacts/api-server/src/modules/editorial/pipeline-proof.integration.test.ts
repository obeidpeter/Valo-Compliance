import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db, pool, valoEditorialRuns } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { hashEditorial, readEditorialRun, probeEditorialPrivate, storeEditorialRun } from "./run-storage";
import { mechanicalCandidate, mandatoryDevelopmentHolds, type EvidenceBundle } from "./pipeline-contract";
import { editorialRunRegister } from "../sources/run-register";
type Artifact = {
  input: Record<string, unknown>;
  output: unknown;
  inputHash: string;
  sourceHash: string;
  role: string;
};
test(
  "real editorial provider proof remains private, independent and held",
  {
    skip: process.env.VALO_RUN_EDITORIAL_TESTS !== "official-development-only",
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    const report = JSON.parse(
      await readFile(
        new URL("../../../../../docs/valo/evidence/p0-editorial-provider-proof.json", import.meta.url),
        "utf8",
      ),
    );
    const rows = await db
      .select()
      .from(valoEditorialRuns)
      .where(eq(valoEditorialRuns.pipelineId, report.pipelineId));
    const artifacts = new Map<string, Artifact>(),
      fixtureIds = [randomUUID(), randomUUID(), randomUUID()];
    try {
      await t.test("three actual response IDs match database and retained private artifacts", async () => {
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map((r) => r.role).sort(), ["challenge", "draft", "factual"]);
        for (const r of rows) {
          assert.equal(r.status, "succeeded");
          assert.ok(r.providerResponseId && r.outputHash && r.latencyMs !== null);
          const a = await readEditorialRun(r.id, r.outputHash!);
          artifacts.set(r.role, a as unknown as Artifact);
          assert.equal(a.inputHash, r.inputHash);
          assert.equal(hashEditorial(JSON.stringify(a.input)), r.inputHash);
          assert.equal(a.sourceHash, r.sourceHash);
          assert.equal(a.providerResponseId, r.providerResponseId);
        }
      });
      await t.test("reviewers received the exact candidate and source without each other's verdict", () => {
        const draft = artifacts.get("draft")!,
          factual = artifacts.get("factual")!,
          challenge = artifacts.get("challenge")!;
        for (const a of [factual, challenge]) {
          assert.deepEqual(Object.keys(a.input).sort(), ["candidate", "role", "sourceBundle"]);
          assert.deepEqual(a.input.candidate, draft.output);
          assert.equal(hashEditorial(JSON.stringify(a.input.candidate)), report.candidateHash);
          assert.deepEqual(a.input.sourceBundle, draft.input.sourceBundle);
        }
        assert.notEqual(factual.inputHash, challenge.inputHash);
      });
      await t.test(
        "the exact candidate's mechanical failures and disagreement do not become publication",
        () => {
          const draft = artifacts.get("draft")!,
            bundle = draft.input.sourceBundle as EvidenceBundle;
          const errors = mechanicalCandidate(draft.output, bundle);
          assert.deepEqual(errors, report.mechanicalErrors);
          assert.equal(report.publication, "held");
          assert.equal(report.professionallyReviewed, false);
          assert.ok([...errors, ...mandatoryDevelopmentHolds].every((e) => report.holdReasons.includes(e)));
          for (const r of rows.filter((r) => r.metadata.modelVerdict === "hold"))
            assert.ok(report.holdReasons.includes(`${r.role}:review_hold`));
        },
      );
      await t.test(
        "all three artifacts reject anonymous reads, tampered digests and overwrite attempts",
        async () => {
          for (const r of rows) {
            const proof = await probeEditorialPrivate(r.id, r.outputHash!);
            assert.equal(proof.authorizedChecksumMatched, true);
            assert.ok([403, 404].includes(proof.anonymousStatus));
            await assert.rejects(() => readEditorialRun(r.id, "0".repeat(64)), /CHECKSUM_FAILED/);
            await assert.rejects(() => storeEditorialRun(r.id, { forged: true }), /KEY_UNAVAILABLE/);
          }
        },
      );
      await t.test(
        "database constraints reject duplicate roles, publisher actors and a published state",
        async () => {
          const original = rows[0]!;
          await assert.rejects(() =>
            db.insert(valoEditorialRuns).values({ ...original, id: fixtureIds[0]! }),
          );
          await assert.rejects(() =>
            db
              .insert(valoEditorialRuns)
              .values({ ...original, id: fixtureIds[1]!, pipelineId: randomUUID(), role: "publisher" }),
          );
          await assert.rejects(() =>
            db
              .insert(valoEditorialRuns)
              .values({ ...original, id: fixtureIds[2]!, pipelineId: randomUUID(), status: "published" }),
          );
          assert.equal(
            (await db.select().from(valoEditorialRuns).where(inArray(valoEditorialRuns.id, fixtureIds)))
              .length,
            0,
          );
        },
      );
      await t.test(
        "dashboard metadata excludes bodies, prompts, provider credentials and private locators",
        async () => {
          const publicMetadata = await editorialRunRegister(),
            serialized = JSON.stringify(publicMetadata);
          for (const forbidden of [
            '"objectKey"',
            '"sourceBundle"',
            '"systemPrompt"',
            '"output"',
            '"paragraphs"',
            '"apiKey"',
          ])
            assert.ok(!serialized.includes(forbidden), forbidden);
          assert.ok(publicMetadata.every((r) => r.publication === "held"));
        },
      );
    } finally {
      await db.delete(valoEditorialRuns).where(inArray(valoEditorialRuns.id, fixtureIds));
      await pool.end();
    }
  },
);
