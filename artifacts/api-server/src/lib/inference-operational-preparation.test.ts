import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { candidateDigest, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { ArtifactRef } from "../editorial/publication-artifacts";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
} from "../modules/ai/inference-allocation-package";
import { selectPreparedProposal } from "./inference-prepared-report";
import type { finiteManifestProposal } from "../modules/ai/inference-manifest";

test("actual preparation and saved-readiness callers bind another form without authoring, review, approval or publication", async (t) => {
  // Native storage, DB and rendering are controlled. Source extraction,
  // permission predicates, mechanical gates, preparation and readiness are real.
  // These fixtures do not establish actual runtime rights/export readiness.
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    VALO_OPERATIONAL_AUTHORING: process.env.VALO_OPERATIONAL_AUTHORING,
  };
  process.env.NODE_ENV = "development";
  process.env.VALO_OPERATIONAL_AUTHORING = "recorded";
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw Error("NETWORK_DISABLED");
  };
  const dir = await mkdtemp(join(tmpdir(), "valo-preparation-control-"));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await rm(dir, { recursive: true, force: true });
  });
  const versions = Symbol("versions"),
    policies = Symbol("policies");
  const contentTable = { table: versions, id: "id", templateId: "templateId" },
    policyTable = { table: policies, id: "id" };
  const saved: any[] = [],
    savedPolicies: any[] = [],
    artifacts = new Map<string, Buffer>();
  let reviewCalls = 0,
    authoringCalls = 0,
    publishCalls = 0,
    holdCalls = 0;
  const database = {
    select: () => ({
      from: (table: unknown) => ({ where: async () => (table === contentTable ? saved : savedPolicies) }),
    }),
    insert: (table: unknown) => ({
      values: (row: any) => {
        (table === contentTable ? saved : savedPolicies).push({ ...row, status: "draft" });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...database, execute: async () => ({ rows: [] }) }),
  };
  const put = async (bytes: Buffer, extension: ArtifactRef["extension"]): Promise<ArtifactRef> => {
    const ref = { id: randomUUID(), hash: sha256(bytes), extension };
    artifacts.set(ref.id, Buffer.from(bytes));
    return ref;
  };
  const get = async (ref: ArtifactRef) => {
    const bytes = artifacts.get(ref.id);
    assert.ok(bytes);
    assert.equal(sha256(bytes), ref.hash);
    return bytes;
  };
  const inspect = async (candidate: PublicationBundle["candidate"], files: { docx: Buffer; pdf: Buffer }) => {
    const valid = Object.values(files).every((b) => JSON.parse(b.toString()).body === candidate.body);
    const format = {
      parsed: valid,
      completeContent: valid,
      disclosureIncluded: valid,
      scopeIncluded: valid,
      limitationsIncluded: valid,
      sourceDateIncluded: valid,
      missingTextHashes: [],
    };
    return {
      version: "controlled-reader",
      passed: valid,
      hashes: { docx: sha256(files.docx), pdf: sha256(files.pdf) },
      formats: { docx: format, pdf: format },
      checks: [],
    };
  };
  t.mock.module("@workspace/db", {
    namedExports: { db: database, valoContentVersions: contentTable, valoPublicationPolicies: policyTable },
  });
  t.mock.module(new URL("../editorial/publication-artifacts.ts", import.meta.url).href, {
    namedExports: { putPublicationArtifact: put, getPublicationArtifact: get },
  });
  t.mock.module(new URL("./valo-render.ts", import.meta.url).href, {
    namedExports: {
      renderDocument: async (document: unknown, format: string) =>
        Buffer.from(JSON.stringify({ format, body: JSON.stringify(document) })),
    },
  });
  t.mock.module(new URL("../editorial/operational-export-inspection.ts", import.meta.url).href, {
    namedExports: { inspectOperationalExports: inspect },
  });
  t.mock.module(new URL("../editorial/operational-authoring.ts", import.meta.url).href, {
    namedExports: {
      recordOriginalAuthoring: async () => {
        authoringCalls++;
        throw Error("AUTHORING_FORBIDDEN");
      },
    },
  });
  t.mock.module(new URL("../editorial/operational-review.ts", import.meta.url).href, {
    namedExports: {
      reviewOperationalCandidate: async () => {
        reviewCalls++;
        throw Error("REVIEW_FORBIDDEN");
      },
    },
  });
  t.mock.module(new URL("../editorial/publication-publisher.ts", import.meta.url).href, {
    namedExports: {
      publishOperationalVersion: async () => {
        publishCalls++;
        throw Error("PUBLICATION_FORBIDDEN");
      },
      recordActualPublicationHold: async () => {
        holdCalls++;
        return { decision: "held" };
      },
    },
  });
  const { prepareOperationalCandidateRelease } = await import("../editorial/operational-preparation");
  const { readOperationalInferenceReadiness } = await import("./inference-operational-ready");
  const now = new Date(),
    quote = "We hereby assign to you all our right, title, and interest, if any, in and to Output.";
  const snapshot = {
    kind: "official_provider_terms_snapshot",
    retrievedAt: now.toISOString(),
    pages: [
      { url: "https://openai.com/policies/terms-of-use/", text: quote, truncated: false },
      { url: "https://openai.com/policies/eu-terms-of-use/", text: quote, truncated: false },
      {
        url: "https://help.openai.com/en/articles/6783457-what-is-chatgpt",
        text: "regardless of whether output was generated through a free or paid plan",
        truncated: false,
      },
      {
        url: "https://openai.com/policies/service-terms/",
        text: "ChatGPT Enterprise, Edu, Healthcare and Business",
        truncated: false,
      },
      {
        url: "https://openai.com/policies/sharing-publication-policy/",
        text: "Content co-authored with the OpenAI API",
        truncated: false,
      },
    ],
  };
  const path = join(dir, "controlled-terms.json");
  await writeFile(path, JSON.stringify(snapshot));
  await assert.rejects(() => prepareOperationalCandidateRelease("TPL-13", path), /PREPARER_UNAVAILABLE/);
  assert.equal(saved.length, 0);
  const prepared = await prepareOperationalCandidateRelease("TPL-12", path);
  assert.equal(prepared.providerFailure, "FINITE_REVIEW_NOT_RUN");
  assert.equal(prepared.release.decision, "held");
  assert.equal(prepared.reviews.length, 0);
  assert.equal(holdCalls, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].templateId, "TPL-12");
  assert.equal(saved[0].slug, "tpl-12");
  const ready = await readOperationalInferenceReadiness(prepared.id);
  assert.equal(ready.candidate.id, "TPL-12");
  assert.equal(ready.candidate.hash, prepared.candidateHash);
  assert.ok(ready.checks.every((c) => c.result === "pass"));
  const row = saved[0],
    original = structuredClone(row);
  row.templateId = "TPL-02";
  await assert.rejects(() => readOperationalInferenceReadiness(prepared.id), /BINDING_CHANGED/);
  Object.assign(row, structuredClone(original));
  row.bundle.candidate.body = row.bundle.candidate.body.replace("Payment reminder letter", "Altered form");
  row.bundle.candidate.hash = candidateDigest(row.bundle.candidate);
  row.candidateHash = row.bundle.candidate.hash;
  await assert.rejects(() => readOperationalInferenceReadiness(prepared.id), /BODY_NOT_EXACT/);
  Object.assign(row, structuredClone(original));
  row.reviewBy = new Date(0);
  await assert.rejects(() => readOperationalInferenceReadiness(prepared.id), /UNAVAILABLE_OR_STALE/);
  Object.assign(row, structuredClone(original));
  const bad = await put(Buffer.from(JSON.stringify({ body: "different canonical document" })), "pdf");
  row.attestations.exports.pdf = bad;
  await assert.rejects(() => readOperationalInferenceReadiness(prepared.id), /EXPORT_HOLD/);
  Object.assign(row, structuredClone(original));
  row.bundle.candidate.risk = "contracts";
  row.bundle.candidate.hash = candidateDigest(row.bundle.candidate);
  row.candidateHash = row.bundle.candidate.hash;
  await assert.rejects(() => readOperationalInferenceReadiness(prepared.id), /MECHANICAL_HOLD/);
  Object.assign(row, structuredClone(original));
  process.env.REPLIT_DEPLOYMENT_ID = "0";
  try {
    await assert.rejects(() => prepareOperationalCandidateRelease("TPL-01", path), /development/);
  } finally {
    delete process.env.REPLIT_DEPLOYMENT_ID;
  }
  assert.equal(saved.length, 1);
  assert.equal(reviewCalls, 0);
  assert.equal(authoringCalls, 0);
  assert.equal(publishCalls, 0);
  assert.equal(networkCalls, 0);
  for (const id of ["TPL-22", "TPL-24", "TPL-34", "TPL-35", "TPL-38"]) {
    saved.length = 0;
    savedPolicies.length = 0;
    const prepared = await prepareOperationalCandidateRelease(id, path),
      current = await readOperationalInferenceReadiness(prepared.id);
    assert.equal(prepared.release.decision, "held");
    assert.equal(prepared.providerFailure, "FINITE_REVIEW_NOT_RUN");
    assert.equal(prepared.reviews.length, 0);
    assert.equal(current.candidate.id, id);
    assert.ok(current.checks.every((c) => c.result === "pass"));
  }
  assert.equal(holdCalls, 6);
  assert.equal(reviewCalls, 0);
  assert.equal(authoringCalls, 0);
  assert.equal(publishCalls, 0);
  assert.equal(networkCalls, 0);
});
test("multi-candidate reports require exact selection and retain old single-pair compatibility", async () => {
  const pkg = await prepareFiniteAllocationPackage(),
    id = allocationPackageId(pkg);
  const proposal = (candidateVersionId: string) =>
    ({ manifest: { packageId: id, works: [{ bindings: { candidateVersionId } }] } }) as ReturnType<
      typeof finiteManifestProposal
    >;
  const one = proposal("one"),
    two = proposal("two"),
    report = { package: pkg, proposals: [one, two] };
  assert.throws(() => selectPreparedProposal(report), /EXACT_PREPARED_CANDIDATE/);
  assert.throws(() => selectPreparedProposal(report, "missing"), /EXACT_PREPARED_CANDIDATE/);
  assert.equal(selectPreparedProposal(report, "two"), two);
  assert.equal(selectPreparedProposal({ package: pkg, proposal: one }), one);
  one.manifest.packageId = "finite-package:" + "f".repeat(64);
  assert.throws(() => selectPreparedProposal(report, "one"), /PACKAGE_BINDING_INVALID/);
});
