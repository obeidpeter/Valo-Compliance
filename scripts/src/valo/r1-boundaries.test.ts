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
    "lib/valo-records/package.json",
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
        "artifacts/api-server/src/modules/commerce/valo-paystack-contract.ts",
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

type Contract = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { additionalProperties?: unknown; properties?: Schema }> };
};
const contract = () => parse(read("lib/api-spec/openapi.yaml")) as Contract;
const pathSegments = (spec: Contract) => [
  ...new Set(Object.keys(spec.paths).flatMap((path) => path.split("/").filter(Boolean))),
];
function tableNames() {
  const tables = new Set<string>();
  for (const file of sourceFiles("lib/db/src/schema", /\.ts$/))
    for (const m of read(file).matchAll(/pgTable\(\s*["']([a-z_0-9]+)["']/g)) tables.add(m[1]!);
  assert.ok(tables.size > 50, "the schema's tables were read");
  return [...tables];
}
function webRoutes() {
  const routes = [...read("artifacts/valo/src/App.tsx").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(routes.length > 20, "the web app's routes were read");
  // The pages the server renders (decision 0011): each page.tsx under app/(public), at its address.
  const server = sourceFiles("artifacts/valo/app/(public)", /^page\.tsx$/).map(
    (file) => file.replace(/^artifacts\/valo\/app\/\(public\)/, "").replace(/\/page\.tsx$/, "") || "/",
  );
  assert.ok(server.includes("/library/[slug]"), "the server's routes were read");
  return [...routes, ...server];
}
const webSource = () => [
  ...sourceFiles("artifacts/valo/src", /\.tsx?$/),
  ...sourceFiles("artifacts/valo/app", /\.tsx?$/),
];

/** Sentences in `file` that match `claim` and do not deny it, as in release-notices.test.tsx. */
function undeniedClaims(
  file: string,
  claim: RegExp,
  denial = /\b(not|no|never|nor|without|isn't|aren't|doesn't|don't|cannot)\b/i,
): string[] {
  const text = read(file);
  const found: string[] = [];
  for (const match of text.matchAll(claim)) {
    const before = text.slice(0, match.index);
    const start = Math.max(...[". ", ".\n", ">", "{", "}", '"', "`"].map((end) => before.lastIndexOf(end)));
    const rest = text.slice(match.index);
    const end = Math.min(...[".", "<", "{", "}", '"', "`"].map((e) => rest.indexOf(e)).filter((i) => i >= 0));
    const sentence = text
      .slice(start + 1, match.index + end)
      .replace(/\s+/g, " ")
      .trim();
    if (!denial.test(sentence)) found.push(`${file}: ${sentence}`);
  }
  return found;
}

// SRV-003: "Publish providers only after identity, relevant credentials, permission and service
// descriptions are checked; show the scope/date of verification", accepted when "no fictional
// provider, fabricated rating or unsupported 'accredited' claim reaches production". R1 lists no
// providers at all: a service enquiry goes to Valo's own support, so nothing claims a vetted provider.
test("R1 lists no service providers: no provider directory, profile or rating, and no accreditation claim", () => {
  const spec = contract();
  const providerWords =
    /^(providers?|professionals?|experts?|consultants?|partners?|directory|listings?|ratings?|reviews?|marketplace)$/i;
  assert.deepEqual(
    pathSegments(spec).filter((segment) => providerWords.test(segment)),
    [],
    "no API path lists or describes providers",
  );
  assert.deepEqual(
    Object.keys(spec.components.schemas).filter((name) =>
      /provider|professional|expert|consultant|partner|rating/i.test(name),
    ),
    [],
    "no API schema describes a provider or a rating",
  );
  assert.deepEqual(
    tableNames().filter((name) =>
      /provider|professional|expert|consultant|partner|directory|listing|rating/.test(name),
    ),
    [],
    "no table holds providers, listings or ratings",
  );
  assert.deepEqual(
    webRoutes().filter((route) =>
      /provider|professional|expert|consultant|partner|director|listing|marketplace/i.test(route),
    ),
    [],
    "no web page lists providers",
  );
  const web = webSource();
  assert.ok(web.length > 50, "the web app source was read");
  const claim =
    /\baccredit\w*|\bcertified\b|\bvetted\b|\blicensed (?:providers?|professionals?|experts?|accountants?|lawyers?|partners?|firms?)\b|\bverified (?:providers?|partners?|professionals?|experts?|firms?)\b|\btop[- ]rated\b/gi;
  assert.deepEqual(
    web.flatMap((file) => undeniedClaims(file, claim)),
    [],
    "no sentence claims an accredited, certified, licensed, verified or vetted provider",
  );
});

// SRV-004: "R2 enables quote and availability requests. R3 paid booking requires a separately gated
// cancellation, refund, dispute and settlement flow", accepted when "booking or payment controls
// remain feature-disabled until that gate is approved". R1 has neither, and an enquiry takes no payment.
test("R1 offers no booking: no booking, appointment, availability or quote request, and an enquiry takes no payment", () => {
  const spec = contract();
  const bookingWords = /book|appointment|availab|reservation|quote|slot|calendar|schedul/i;
  assert.deepEqual(
    pathSegments(spec).filter((segment) => bookingWords.test(segment)),
    [],
    "no API path books, schedules or quotes a service",
  );
  assert.deepEqual(
    Object.keys(spec.components.schemas).filter((name) =>
      /booking|appointment|availability|reservation|quote|timeslot/i.test(name),
    ),
    [],
    "no API schema describes a booking or a quote request",
  );
  assert.deepEqual(
    tableNames().filter((name) =>
      /booking|appointment|availability|reservation|quote|slot|calendar/.test(name),
    ),
    [],
    "no table holds bookings, appointments or quote requests",
  );
  assert.deepEqual(
    webRoutes().filter((route) => bookingWords.test(route)),
    [],
    "no web page books or schedules a service",
  );
  // A service enquiry and a reply carry only their text, contact and consent, and accept nothing else.
  for (const [name, fields] of [
    ["TicketInput", ["category", "contactEmail", "scope", "sharingConsent"]],
    ["SupportReplyInput", ["body", "expectedVersion", "idempotencyKey"]],
  ] as const) {
    const schema = spec.components.schemas[name]!;
    assert.equal(schema.additionalProperties, false, `${name} accepts no other fields`);
    assert.deepEqual(
      Object.keys(schema.properties ?? {}).sort(),
      fields,
      `${name} changed: keep it payment-free`,
    );
  }
  // The support case code never reaches the payment code.
  const support = sourceFiles("artifacts/api-server/src", /\.ts$/).filter((file) =>
    /\/valo-support-[^/]+$/.test(file),
  );
  assert.ok(support.length >= 3, "the support case code was read");
  assert.deepEqual(
    support.filter((file) => /modules\/commerce|paystack|checkout/i.test(read(file))),
    [],
    "support case code imports or calls no payment code",
  );
});

// OPS-006 is accepted when there is "no claim that Nigerian customer data stays in Nigeria without
// proof", and PRV-002 with a "documented review covers Replit, identity, email, payments, AI and
// monitoring; no unverified 'zero retention' promise". docs/valo/processor-review.md is that review,
// a draft awaiting the privacy owner.
test("the web app claims neither that data stays in Nigeria nor that a provider keeps nothing, and the processor review covers every kind of service", () => {
  const web = webSource();
  assert.ok(web.length > 50, "the web app source was read");
  const location =
    /\b(?:stays?|remains?|kept|stored|held|hosted|processed)\b[^.<{}"`]{0,40}\bin nigeria\b|\bnigerian (?:servers?|data cent(?:re|er)s?|hosting|cloud)\b|\bdata (?:residency|sovereignty|locali[sz]ation)\b/gi;
  assert.deepEqual(
    web.flatMap((file) => undeniedClaims(file, location)),
    [],
    "no sentence claims customer data stays in Nigeria",
  );
  // A retention promise reads as a denial ("never stored by the provider"), so only a sentence that
  // disclaims the promise itself passes.
  const retention =
    /\bzero[- ](?:data[- ])?retention\b|\bno[- ](?:data[- ])?retention\b|\b(?:never|not) (?:stored|retained|kept|logged|saved) by (?:the |our |any )?(?:ai|model|provider|processor|openai|clerk|paystack|resend|third part(?:y|ies))\b|\bnot used (?:for|to) train\w*|\b(?:deleted|erased) immediately\b/gi;
  const disclaimed = /\b(?:no|not|never|cannot|without)\b[^.]{0,40}\b(?:promise|claim|guarantee)\w*/i;
  assert.deepEqual(
    web.flatMap((file) => undeniedClaims(file, retention, disclaimed)),
    [],
    "no sentence promises that a provider keeps nothing",
  );

  const review = read("docs/valo/processor-review.md");
  assert.match(review, /^\*\*Status: draft, not approved\.\*\*/m, "the review says it is not approved");
  const rows = review
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Service") && !line.startsWith("| ---"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  assert.ok(
    rows.every((cells) => cells.length === 6 && cells.every(Boolean)),
    "every service states what it receives, its region, its retention and its contract",
  );
  assert.ok(
    rows.some(([service]) => service === "Replit"),
    "the review covers Replit",
  );
  for (const kind of ["Hosting", "Identity", "Email", "Payments", "AI", "Monitoring"])
    assert.ok(
      rows.some((cells) => cells[1]!.startsWith(kind)),
      `the review covers ${kind.toLowerCase()}`,
    );
});
