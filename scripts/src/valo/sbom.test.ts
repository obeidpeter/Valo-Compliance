import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";
import { billOfMaterials, packageUrl } from "./sbom";

const lockText = readFileSync(join(repositoryRoot, "pnpm-lock.yaml"), "utf8");
const revision = "0".repeat(40);

test("the bill of materials lists every package the lockfile installs, from the registry, with its version and checksum (SEC-007)", () => {
  const bill = billOfMaterials(lockText, revision, "2026-11-26T12:00:00.000Z");
  const lock = parse(lockText) as { packages: Record<string, unknown> };
  assert.equal(bill.bomFormat, "CycloneDX");
  assert.equal(bill.specVersion, "1.5");
  assert.match(bill.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(bill.metadata.component.version, revision);
  // Every package once, under its registry address, with its SHA-512 checksum in hexadecimal.
  assert.equal(bill.components.length, Object.keys(lock.packages).length);
  assert.equal(new Set(bill.components.map((c) => c["bom-ref"])).size, bill.components.length);
  for (const component of bill.components) {
    assert.match(component.purl, /^pkg:npm\/(%40[^/]+\/)?[^/@]+@[^@]+$/, component.purl);
    assert.ok(
      component.hashes.length > 0 && component.hashes.every((h) => /^[0-9a-f]+$/.test(h.content)),
      component.purl,
    );
  }
  const find = (name: string) =>
    bill.components.filter((c) => [c.group, c.name].filter(Boolean).join("/") === name);
  // A scoped package keeps its scope as the package URL's namespace.
  const clerk = find("@clerk/express")[0]!;
  assert.equal(clerk.group, "@clerk");
  assert.equal(clerk.purl, packageUrl("@clerk/express", clerk.version));
  assert.match(clerk.purl, /^pkg:npm\/%40clerk\/express@/);
  // The checksum is the lockfile's own, written in hexadecimal.
  const integrity = (
    lock.packages[`@clerk/express@${clerk.version}`] as { resolution: { integrity: string } }
  ).resolution.integrity;
  assert.deepEqual(clerk.hashes, [
    { alg: "SHA-512", content: Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex") },
  ]);
  // What the API needs at run time is required, with what it brings in; a tool only development
  // needs is excluded.
  for (const name of ["express", "@clerk/express", "@clerk/backend"])
    assert.ok(
      find(name).every((c) => c.scope === "required"),
      name,
    );
  for (const name of ["prettier", "oxlint", "yaml"])
    assert.ok(
      find(name).every((c) => c.scope === "excluded"),
      name,
    );
  // Every dependency named is listed, and the lockfile's own checksum ties the bill to it.
  const listed = new Set(bill.components.map((c) => c.purl));
  assert.equal(bill.dependencies.length, bill.components.length);
  assert.ok(
    bill.dependencies.every((d) => listed.has(d.ref) && d.dependsOn.every((target) => listed.has(target))),
  );
  const express = bill.dependencies.find((d) => d.ref === find("express")[0]!.purl)!;
  assert.ok(express.dependsOn.length > 0);
  assert.ok(
    bill.metadata.properties.some((p) => p.name === "valo:lockfile-sha256" && /^[0-9a-f]{64}$/.test(p.value)),
  );
});

test("a package from anywhere but the registry, or without a checksum, stops the bill of materials", () => {
  const lock = (resolution: string) =>
    [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      synthetic-package:",
      "        specifier: 1.0.0",
      "        version: 1.0.0",
      "packages:",
      "  synthetic-package@1.0.0:",
      `    resolution: ${resolution}`,
      "snapshots:",
      "  synthetic-package@1.0.0: {}",
      "",
    ].join("\n");
  const make = (resolution: string) =>
    billOfMaterials(lock(resolution), revision, "2026-11-26T12:00:00.000Z");
  const sound = make("{integrity: sha512-c3ludGhldGlj}");
  assert.equal(sound.components[0]!.scope, "required");
  assert.deepEqual(sound.components[0]!.hashes, [{ alg: "SHA-512", content: "73796e746865746963" }]);
  assert.throws(
    () => make("{tarball: https://example.invalid/synthetic-package-1.0.0.tgz}"),
    /SBOM_PACKAGE_NOT_FROM_REGISTRY: synthetic-package@1.0.0/,
  );
  assert.throws(
    () => make("{integrity: sha512-c3ludGhldGlj, tarball: https://example.invalid/synthetic.tgz}"),
    /SBOM_PACKAGE_NOT_FROM_REGISTRY/,
  );
  assert.throws(
    () => make("{type: git, repo: https://example.invalid/synthetic.git, commit: abc}"),
    /SBOM_PACKAGE_NOT_FROM_REGISTRY/,
  );
  assert.throws(() => make("{}"), /SBOM_PACKAGE_WITHOUT_CHECKSUM/);
  assert.throws(() => make("{integrity: md5-c3ludGhldGlj}"), /SBOM_PACKAGE_WITHOUT_CHECKSUM/);
  assert.throws(
    () => billOfMaterials(lock("{integrity: sha512-c3ludGhldGlj}").replace("'9.0'", "'6.0'"), revision, ""),
    /SBOM_LOCKFILE_UNSUPPORTED/,
  );
});
