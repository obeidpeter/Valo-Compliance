import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";

/**
 * The software bill of materials (SEC-007; OWASP ASVS 5.0.0 V15.1.2 in the security baseline),
 * made from the lockfile on each merge and kept with the run (docs/valo/dependency-advisories.md).
 * It lists every package the lockfile installs, in CycloneDX 1.5 JSON: its name and version, its
 * registry address as a package URL, its checksum, what it depends on, and whether anything a
 * workspace package needs at run time reaches it ("required") or only its development tools do
 * ("excluded"). A package from anywhere but the registry, or without a checksum, stops the bill.
 */
export const SBOM_FILE = "generated-artifacts/valo-security/sbom.cdx.json";

type LockDependencies = Record<string, string>;
type Lockfile = {
  lockfileVersion?: unknown;
  importers?: Record<string, Record<string, Record<string, { version?: unknown }> | undefined>>;
  packages?: Record<string, { resolution?: Record<string, unknown> }>;
  snapshots?: Record<string, { dependencies?: LockDependencies; optionalDependencies?: LockDependencies }>;
};

/** A package as the bill lists it: a CycloneDX component. */
type Component = {
  type: "library";
  "bom-ref": string;
  /** A scoped package's scope, such as "@clerk". */
  group?: string;
  name: string;
  version: string;
  scope: "required" | "excluded";
  hashes: { alg: string; content: string }[];
  purl: string;
};

const ALGORITHMS: Record<string, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/** A package's name and version from its key in the lockfile's packages, "name@version". */
function nameAndVersion(key: string) {
  const at = key.lastIndexOf("@");
  if (at <= 0) throw Error(`SBOM_PACKAGE_KEY_INVALID: ${key}`);
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

/** The package URL of an npm package: pkg:npm/%40scope/name@version. */
export function packageUrl(name: string, version: string) {
  const path = name
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
}

/** The package a dependency resolves to: "name" at "version(peers)", or an alias, "other@version". */
function packageKey(name: string, version: string) {
  const base = version.split("(")[0]!;
  return base.lastIndexOf("@") > 0 ? base : `${name}@${base}`;
}

/** The bill of materials for the lockfile's text, for the commit `revision`, made at `timestamp`. */
export function billOfMaterials(text: string, revision: string, timestamp: string) {
  const lock = parse(text) as Lockfile;
  if (lock.lockfileVersion !== "9.0") throw Error("SBOM_LOCKFILE_UNSUPPORTED");
  const packages = lock.packages ?? {};
  const snapshots = lock.snapshots ?? {};
  // What each package depends on, from every snapshot of it (one per set of peers).
  const dependsOn = new Map<string, Set<string>>();
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const own = key.split("(")[0]!;
    const set = dependsOn.get(own) ?? new Set<string>();
    for (const [name, version] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    }))
      if (!String(version).startsWith("link:")) set.add(packageKey(name, String(version)));
    dependsOn.set(own, set);
  }
  // Everything a workspace package's own or optional dependencies reach is required at run time.
  const required = new Set<string>();
  const roots = Object.values(lock.importers ?? {}).flatMap((importer) =>
    ["dependencies", "optionalDependencies"].flatMap((kind) =>
      Object.entries(importer[kind] ?? {}).map(([name, entry]) => ({ name, version: String(entry.version) })),
    ),
  );
  const queue = roots
    .filter(({ version }) => !version.startsWith("link:"))
    .map(({ name, version }) => packageKey(name, version));
  while (queue.length) {
    const key = queue.pop()!;
    if (required.has(key)) continue;
    required.add(key);
    queue.push(...(dependsOn.get(key) ?? []));
  }
  const ref = (key: string) => {
    const { name, version } = nameAndVersion(key);
    return packageUrl(name, version);
  };
  const components = Object.entries(packages).map(([key, entry]): Component => {
    const { name, version } = nameAndVersion(key);
    const resolution = entry.resolution ?? {};
    if (Object.keys(resolution).some((field) => field !== "integrity"))
      throw Error(`SBOM_PACKAGE_NOT_FROM_REGISTRY: ${key}`);
    if (typeof resolution.integrity !== "string" || !resolution.integrity)
      throw Error(`SBOM_PACKAGE_WITHOUT_CHECKSUM: ${key}`);
    const hashes = resolution.integrity.split(/\s+/).map((value) => {
      const dash = value.indexOf("-");
      const alg = ALGORITHMS[value.slice(0, dash)];
      const content = Buffer.from(value.slice(dash + 1), "base64").toString("hex");
      if (!alg || dash < 0 || !content) throw Error(`SBOM_PACKAGE_WITHOUT_CHECKSUM: ${key}`);
      return { alg, content };
    });
    const slash = name.startsWith("@") ? name.indexOf("/") : -1;
    return {
      type: "library",
      "bom-ref": packageUrl(name, version),
      ...(slash > 0 ? { group: name.slice(0, slash), name: name.slice(slash + 1) } : { name }),
      version,
      scope: required.has(key) ? "required" : "excluded",
      hashes,
      purl: packageUrl(name, version),
    };
  });
  components.sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  const listed = new Set(components.map((component) => component.purl));
  const dependencies = Object.keys(packages)
    .map((key) => ({
      ref: ref(key),
      dependsOn: [...(dependsOn.get(key) ?? [])].map(ref).sort(),
    }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  for (const { dependsOn: refs } of dependencies)
    for (const target of refs) if (!listed.has(target)) throw Error(`SBOM_DEPENDENCY_UNLISTED: ${target}`);
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      tools: { components: [{ type: "application", name: "valo-sbom", version: "1" }] },
      component: { type: "application", "bom-ref": "valo", name: "valo", version: revision },
      properties: [
        { name: "valo:lockfile", value: "pnpm-lock.yaml" },
        { name: "valo:lockfile-sha256", value: createHash("sha256").update(text).digest("hex") },
      ],
    },
    components,
    dependencies,
  };
}

function main() {
  const root = repositoryRoot;
  const revision =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const bill = billOfMaterials(
    readFileSync(join(root, "pnpm-lock.yaml"), "utf8"),
    revision,
    new Date().toISOString(),
  );
  const out = join(root, SBOM_FILE);
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify(bill, null, 2) + "\n");
  const required = bill.components.filter((component) => component.scope === "required").length;
  console.log(
    `${SBOM_FILE}: ${bill.components.length} packages, ${required} needed at run time and ` +
      `${bill.components.length - required} by development tools only, for ${revision}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
