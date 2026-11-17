import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";

/** Things R1 must not offer, checked in the code itself rather than in a flag. */
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

function sourceFiles(directory: string, extensions: RegExp): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (["node_modules", "dist", ".next", "generated-artifacts"].includes(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (extensions.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(relative(repositoryRoot, path));
    }
  };
  walk(join(repositoryRoot, directory));
  return found.sort();
}

type Schema = { [key: string]: unknown };
type Operation = { requestBody?: { content?: Record<string, { schema?: Schema }> } };

/** Every request schema value that would carry file bytes. */
function fileFields(schema: unknown, path: string, found: string[]) {
  if (Array.isArray(schema)) schema.forEach((value, index) => fileFields(value, `${path}[${index}]`, found));
  else if (schema && typeof schema === "object") {
    const fields = schema as Schema;
    if (
      ["binary", "byte"].includes(String(fields.format)) ||
      fields.contentEncoding ||
      fields.contentMediaType
    )
      found.push(path);
    for (const [key, value] of Object.entries(fields)) fileFields(value, `${path}.${key}`, found);
  }
}

// WRK-005: "R1 stores structured task notes and references, not uploaded identity or regulatory
// evidence files", accepted when "upload controls are absent or disabled". Evidence uploads are R2
// and need malware scanning, access controls and retention review first.
test("R1 has no way to upload a file: the API takes JSON only and the web app has no file input", () => {
  const spec = parse(read("lib/api-spec/openapi.yaml")) as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, { additionalProperties?: unknown; properties?: Schema }> };
  };
  const bodyTypes = new Set<string>();
  const carriesFiles: string[] = [];
  let bodies = 0;
  for (const [path, item] of Object.entries(spec.paths))
    for (const [method, operation] of Object.entries(item))
      for (const [type, media] of Object.entries(operation?.requestBody?.content ?? {})) {
        bodies++;
        bodyTypes.add(type);
        fileFields(media.schema, `${method.toUpperCase()} ${path}`, carriesFiles);
      }
  assert.ok(bodies > 40, "the contract's request bodies were read");
  assert.deepEqual([...bodyTypes], ["application/json"]);
  assert.deepEqual(carriesFiles, [], "no request field carries file bytes");
  // A task holds a title, notes, dates and references to an assessment or rule, nothing else.
  for (const [name, fields] of [
    ["TaskInput", ["assessmentId", "dateConfirmed", "dueDate", "notes", "ruleId", "title"]],
    ["TaskUpdate", ["dateConfirmed", "dueDate", "expectedRevision", "notes", "state", "title"]],
  ] as const) {
    const schema = spec.components.schemas[name]!;
    assert.equal(schema.additionalProperties, false, `${name} accepts no other fields`);
    assert.deepEqual(
      Object.keys(schema.properties ?? {}).sort(),
      fields,
      `${name} changed: keep it file-free`,
    );
  }

  // The API parses JSON bodies only and depends on no upload parser.
  const api = sourceFiles("artifacts/api-server/src", /\.ts$/);
  assert.ok(api.length > 100, "the API source was read");
  for (const file of api) {
    const source = read(file);
    assert.doesNotMatch(source, /\burlencoded\(|\bexpress\.text\(|multipart\/form-data/, file);
    for (const call of source.matchAll(/\braw\(\s*\{([^}]*)\}/g))
      assert.match(call[1]!, /type:\s*"application\/json"/, `${file} reads a raw body that is not JSON`);
  }
  const uploadParsers = [
    "multer",
    "busboy",
    "formidable",
    "multiparty",
    "express-fileupload",
    "connect-busboy",
  ];
  for (const manifest of [
    "package.json",
    "artifacts/api-server/package.json",
    "artifacts/valo/package.json",
    "scripts/package.json",
    "lib/db/package.json",
    "lib/valo-core/package.json",
  ]) {
    const json = JSON.parse(read(manifest)) as Record<string, Record<string, string> | undefined>;
    const names = Object.keys({ ...json.dependencies, ...json.devDependencies });
    assert.deepEqual(
      names.filter((name) => uploadParsers.includes(name)),
      [],
      `${manifest} depends on an upload parser`,
    );
  }

  // The web app offers no file input, drop zone or file reader.
  const web = [
    ...sourceFiles("artifacts/valo/src", /\.tsx?$/),
    ...sourceFiles("artifacts/valo/app", /\.tsx?$/),
  ];
  assert.ok(web.length > 50, "the web app source was read");
  assert.deepEqual(
    web.filter((file) =>
      /type=\{?["'`]file["'`]\}?|useDropzone|onDrop=|new FileReader|DataTransfer|showOpenFilePicker/.test(
        read(file),
      ),
    ),
    [],
  );
});

// PAY-010: "Keep recurring subscriptions, wallets, split settlements and provider collections off
// in R1". The checkout body and the events Valo processes are checked in valo-paystack-contract.test.ts.
test("R1 calls Paystack only for one-time charges, refunds and disputes and keeps no subscriptions, wallets or payouts", () => {
  const api = sourceFiles("artifacts/api-server/src", /\.ts$/);
  const calls: string[] = [];
  for (const file of api) {
    const source = read(file);
    if (source.includes("api.paystack.co"))
      assert.equal(
        file,
        "artifacts/api-server/src/lib/valo-paystack-contract.ts",
        "every call goes through paystackRequest",
      );
    const all = [...source.matchAll(/\bpaystackRequest\(/g)].length;
    const literal = [...source.matchAll(/\bpaystackRequest\(\s*["'`]([^"'`$]+)/g)].map((m) => m[1]!);
    const definitions = [...source.matchAll(/function paystackRequest\(/g)].length;
    assert.equal(literal.length, all - definitions, `${file} names a Paystack path that is not written out`);
    calls.push(...literal);
  }
  assert.ok(calls.length >= 4, "the Paystack calls were read");
  const allowed = ["/transaction/initialize", "/transaction/verify/", "/refund", "/dispute/"];
  assert.deepEqual(
    calls.filter((path) => !allowed.some((prefix) => path === prefix || path.startsWith(prefix))),
    [],
    "only charge, refund and dispute endpoints",
  );
  const tables = new Set<string>();
  for (const file of sourceFiles("lib/db/src/schema", /\.ts$/))
    for (const m of read(file).matchAll(/pgTable\(\s*["']([a-z_0-9]+)["']/g)) tables.add(m[1]!);
  assert.ok(tables.size > 50, "the schema's tables were read");
  assert.deepEqual(
    [...tables].filter((name) =>
      /subscription|wallet|payout|transfer|split|subaccount|balance|(^|_)plans?(_|$)|collection/.test(name),
    ),
    [],
  );
});
