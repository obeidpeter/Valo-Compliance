import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  FINITE_WORK_BINDING_ENTRIES,
  HISTORY_RESEED,
  apiImportGraph,
  historyReseedReport,
  historyReseedViolations,
  cycleViolations,
  importCycles,
  inferenceBindingReport,
  inferenceBindingViolations,
  PUBLISHER_CONNECTION_ENTRY,
  RAW_HTML_ENTRIES,
  RAW_SQL_ENTRIES,
  rawHtmlReport,
  rawHtmlViolations,
  rawSqlReport,
  rawSqlViolations,
  publisherConnectionReport,
  publisherConnectionViolations,
  DRAFTER_CONNECTION_ENTRIES,
  drafterConnectionReport,
  drafterConnectionViolations,
  REVIEWER_CONNECTION_ENTRIES,
  reviewerConnectionReport,
  reviewerConnectionViolations,
  moduleBoundaryViolations,
  publicServerEntries,
  publicServerViolations,
  silentCatchReport,
  silentCatchViolations,
  WEB_FORMATTER,
  webFormattingReport,
  webFormattingViolations,
  WORKSPACE_SCOPE_ENTRIES,
  workspaceActorReport,
  workspaceActorViolations,
} from "./architecture-check";

test("an empty catch needs a comment; a catch that handles the error does not", () => {
  const flagged = silentCatchViolations("a.ts", "try { work(); } catch {}\n");
  assert.equal(flagged.length, 1);
  assert.match(flagged[0]!, /^a\.ts:1 silent-catch /);
  assert.deepEqual(
    silentCatchViolations("b.ts", "try { work(); } catch {\n  // Expected: retried below.\n}\n"),
    [],
  );
  assert.deepEqual(silentCatchViolations("c.ts", "try { work(); } catch { failed++; }\n"), []);
  assert.deepEqual(silentCatchViolations("d.ts", "try { work(); } catch (error) { throw error; }\n"), []);
});

test("an empty promise rejection handler needs a comment on its statement", () => {
  assert.equal(silentCatchViolations("e.ts", "void job().catch(() => {});\n").length, 1);
  assert.equal(silentCatchViolations("f.ts", "const v = await res.json().catch(() => null);\n").length, 1);
  assert.deepEqual(
    silentCatchViolations("g.ts", "// Best-effort cleanup.\nawait unlink(path).catch(() => {});\n"),
    [],
  );
  assert.deepEqual(silentCatchViolations("h.ts", "void job().catch((error) => log(error));\n"), []);
});

test("an import cycle fails", () => {
  const graph = new Map([
    ["a.ts", new Set(["b.ts"])],
    ["b.ts", new Set(["a.ts"])],
    ["c.ts", new Set<string>()],
  ]);
  assert.deepEqual(importCycles(graph), [["a.ts", "b.ts"]]);
  assert.equal(cycleViolations(graph).length, 1);
});

test("HTTP code cannot create, cast or redirect a workspace actor", () => {
  const route = "artifacts/api-server/src/routes/example.ts";
  const flagged = (path: string, text: string) => workspaceActorViolations(path, text).length;
  assert.match(
    workspaceActorViolations(route, "await getDocument(workspaceActorFromRecord(record), id);").join("\n"),
    /may not create a workspace actor/,
  );
  assert.equal(flagged(route, "await getDocument(res.locals.valoActor as WorkspaceActor, id);"), 1);
  assert.equal(flagged(route, "const scope = { workspaceId: req.params.workspace };"), 1);
  assert.equal(flagged("artifacts/api-server/src/lib/valo-orders-http.ts", "run({ workspaceId });"), 1);
  assert.equal(flagged(route, "await getDocument(res.locals.valoActor, req.params.id);"), 0);
  assert.equal(flagged("artifacts/api-server/src/routes/example.test.ts", "run({ workspaceId });"), 0);
  // Background work may act for a stored requester; every use re-checks membership.
  assert.equal(
    flagged(
      "artifacts/api-server/src/modules/exports/valo-exports.ts",
      "workspaceActorFromRecord({ workspaceId, identityId })",
    ),
    0,
  );
  assert.equal(
    flagged(
      "artifacts/api-server/src/modules/exports/valo-exports.ts",
      "insert({ id, workspaceId, ...values })",
    ),
    0,
    "rows that spread other values are not actors",
  );
});

test("only resolveWorkspace issues actors from memberships, and no code redirects an actor", () => {
  const lib = "artifacts/api-server/src/modules/tasks/valo-tasks.ts";
  assert.equal(workspaceActorViolations(lib, "workspaceActorFromMembership(row);").length, 1);
  assert.equal(
    workspaceActorViolations(
      "artifacts/api-server/src/modules/workspaces/valo-workspaces.ts",
      "workspaceActorFromMembership(row);",
    ).length,
    0,
  );
  assert.equal(workspaceActorViolations(lib, "const other = { ...actor, workspaceId: target };").length, 1);
  assert.equal(
    workspaceActorViolations(lib, "const other = { ...ownerActor, identityId: target };").length,
    1,
  );
  assert.equal(workspaceActorViolations(lib, "const copy = { ...res.locals.valoActor };").length, 0);
});

test("only the reviewed entries may enter a workspace scope", () => {
  const scoped = "runInWorkspaceScope(job.workspaceId, () => read(job));";
  assert.equal(
    workspaceActorViolations("artifacts/api-server/src/modules/tasks/valo-tasks.ts", scoped).length,
    1,
  );
  assert.equal(workspaceActorViolations("artifacts/api-server/src/routes/valo.ts", scoped).length, 1);
  for (const entry of WORKSPACE_SCOPE_ENTRIES)
    assert.equal(workspaceActorViolations(entry, scoped).length, 0);
});

test("only the publisher names the publisher's database connection", () => {
  const use =
    "const { publisherDb } = await import('@workspace/db');\nawait publisherDb().transaction(run);\n";
  assert.deepEqual(publisherConnectionViolations(PUBLISHER_CONNECTION_ENTRY, use), []);
  const elsewhere = publisherConnectionViolations("artifacts/api-server/src/routes/valo.ts", use);
  assert.equal(elsewhere.length, 2, "the import and the call are each reported");
  assert.match(
    elsewhere[0]!,
    /^artifacts\/api-server\/src\/routes\/valo\.ts:1 publisher-connection only the publisher/,
  );
  // Renaming it on the way in does not hide it.
  assert.equal(
    publisherConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "import { publisherDb as other } from '@workspace/db';\n",
    ).length,
    1,
  );
  // A test may stand in for the connection, or check the boundary.
  assert.deepEqual(publisherConnectionViolations("artifacts/api-server/src/lib/example.test.ts", use), []);
  // The word in a comment or a string is not a use.
  assert.deepEqual(
    publisherConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "// publisherDb is for the publisher\nconst name = 'publisherDb';\n",
    ),
    [],
  );
  assert.deepEqual(publisherConnectionReport(), [], "the repository keeps the rule");
});

test("only the drafting paths name drafting's database connection", () => {
  const use = "const { drafterDb } = await import('@workspace/db');\nawait drafterDb().transaction(run);\n";
  for (const entry of DRAFTER_CONNECTION_ENTRIES)
    assert.deepEqual(drafterConnectionViolations(entry, use), []);
  const elsewhere = drafterConnectionViolations("artifacts/api-server/src/routes/valo.ts", use);
  assert.equal(elsewhere.length, 2, "the import and the call are each reported");
  assert.match(
    elsewhere[0]!,
    /^artifacts\/api-server\/src\/routes\/valo\.ts:1 drafter-connection only the drafting paths/,
  );
  // The publisher may not draft, nor may the module that requests a preparation.
  for (const path of [
    "artifacts/api-server/src/modules/publication/publication-publisher.ts",
    "artifacts/api-server/src/modules/editorial/review-preparation.ts",
  ])
    assert.equal(drafterConnectionViolations(path, use).length, 2, path);
  // The login's own pool is the same connection, and renaming either on the way in does not hide it.
  assert.equal(
    drafterConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "import { drafterLogin as login, drafterDb as other } from '@workspace/db';\nlogin.pool();\n",
    ).length,
    2,
  );
  // A test may stand in for the connection, or check the boundary.
  assert.deepEqual(drafterConnectionViolations("artifacts/api-server/src/lib/example.test.ts", use), []);
  // The word in a comment or a string is not a use.
  assert.deepEqual(
    drafterConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "// drafterDb is for drafting\nconst name = 'drafterLogin';\n",
    ),
    [],
  );
  assert.deepEqual(drafterConnectionReport(), [], "the repository keeps the rule");
});

test("only the review's record names review's database connection", () => {
  const use = "const { reviewerDb } = await import('@workspace/db');\nawait reviewerDb().transaction(run);\n";
  for (const entry of REVIEWER_CONNECTION_ENTRIES)
    assert.deepEqual(reviewerConnectionViolations(entry, use), []);
  // Drafting may not record a review of what it drafted, nor may the publisher.
  for (const path of [
    "artifacts/api-server/src/modules/editorial/operational-preparation.ts",
    "artifacts/api-server/src/modules/editorial/operational-authoring.ts",
    "artifacts/api-server/src/modules/publication/publication-publisher.ts",
    "artifacts/api-server/src/routes/valo.ts",
  ]) {
    const found = reviewerConnectionViolations(path, use);
    assert.equal(found.length, 2, path);
    assert.match(found[0]!, /reviewer-connection only the review's record may use/);
  }
  // Neither connection's names reach the other's files.
  for (const entry of REVIEWER_CONNECTION_ENTRIES)
    assert.equal(
      drafterConnectionViolations(entry, "import { drafterDb } from '@workspace/db';\n").length,
      1,
      entry,
    );
  // The login's own pool is the same connection, and renaming either on the way in does not hide it.
  assert.equal(
    reviewerConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "import { reviewerLogin as login, reviewerDb as other } from '@workspace/db';\nlogin.pool();\n",
    ).length,
    2,
  );
  assert.deepEqual(reviewerConnectionViolations("artifacts/api-server/src/lib/example.test.ts", use), []);
  assert.deepEqual(
    reviewerConnectionViolations(
      "artifacts/api-server/src/lib/example.ts",
      "// reviewerDb is for review\nconst name = 'reviewerLogin';\n",
    ),
    [],
  );
  assert.deepEqual(reviewerConnectionReport(), [], "the repository keeps the rule");
});

test("only the reviewed operator commands provide the dispatcher's binding checks, and only the real ones", () => {
  const [entry] = FINITE_WORK_BINDING_ENTRIES;
  const flagged = (path: string, text: string) => inferenceBindingViolations(path, text);
  const real =
    "const { provideFiniteWorkBindings } = await import('../modules/ai');\nprovideFiniteWorkBindings(assertFiniteWorkBindings);\n";
  assert.deepEqual(flagged(entry!, real), []);
  assert.match(
    flagged("artifacts/api-server/src/lib/example.ts", real)[0]!,
    /inference-bindings only the reviewed entries/,
  );
  assert.match(
    flagged(entry!, "provideFiniteWorkBindings(async () => {});\n")[0]!,
    /provide the real assertFiniteWorkBindings/,
  );
  assert.match(
    flagged(entry!, "provideFiniteWorkBindings(assertFiniteWorkBindings, extra);\n")[0]!,
    /provide the real assertFiniteWorkBindings/,
  );
  assert.match(
    flagged(entry!, "const provide = provideFiniteWorkBindings;\n")[0]!,
    /do not pass it on or rename it/,
  );
  assert.match(
    flagged(entry!, "const { provideFiniteWorkBindings: provide } = managed;\n")[0]!,
    /do not pass it on or rename it/,
  );
  // Tests may compose the dispatcher with stand-ins, and the module defines the function.
  assert.deepEqual(
    flagged("artifacts/api-server/src/lib/example.test.ts", "provideFiniteWorkBindings(async () => {});\n"),
    [],
  );
  assert.deepEqual(
    flagged(
      "artifacts/api-server/src/modules/ai/managed-inference.ts",
      "export function provideFiniteWorkBindings() {}\n",
    ),
    [],
  );
});

test("code outside a module reaches it only through its index", () => {
  const m = "artifacts/api-server/src/modules/";
  const graph = new Map([
    ["artifacts/api-server/src/routes/a.ts", new Set([`${m}ai/index.ts`])],
    ["artifacts/api-server/src/lib/b.ts", new Set([`${m}ai/managed-inference.ts`])],
    [`${m}ai/index.ts`, new Set([`${m}ai/managed-inference.ts`])],
    [`${m}ai/managed-inference.ts`, new Set(["artifacts/api-server/src/lib/c.ts"])],
    [`${m}docs/index.ts`, new Set([`${m}ai/inference-budget.ts`])],
  ]);
  const flagged = moduleBoundaryViolations(graph);
  assert.equal(flagged.length, 2, flagged.join("\n"));
  assert.match(flagged[0]!, /lib\/b\.ts:1 module-boundary imports ai\/managed-inference\.ts/);
  assert.match(flagged[1]!, /modules\/docs\/index\.ts:1 module-boundary imports ai\/inference-budget\.ts/);
});

test("public pages' server code never holds the visitor's identity, and their islands load the identity SDK only after the page is interactive", () => {
  const root = mkdtempSync(join(tmpdir(), "public-server-rule-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const web = "artifacts/valo/";
  try {
    write(`${web}src/server/public-api.ts`, 'import { z } from "@workspace/api-zod";\nexport const x = z;\n');
    write(
      `${web}src/server/identity.ts`,
      'import { auth } from "@clerk/nextjs/server";\nexport const y = auth;\n',
    );
    write(
      `${web}app/(public)/terms/page.tsx`,
      'import type { User } from "@clerk/react";\nimport { Shell } from "@/components/shell";\nimport { Account } from "@/islands/account";\nimport { Menu } from "@/islands/menu";\nexport default function P() { return null; }\n',
    );
    // Server code imported by a route is server code too.
    write(
      `${web}src/components/shell.tsx`,
      '\nimport { getBaseUrl } from "@workspace/api-client-react";\nexport const Shell = getBaseUrl;\n',
    );
    // An island may use the browser's API client, but loads the identity SDK only with import().
    write(
      `${web}src/islands/account.tsx`,
      '"use client";\nimport { useQuery } from "@workspace/api-client-react";\nimport { Show } from "@clerk/react";\nexport const Account = [useQuery, Show];\n',
    );
    write(
      `${web}src/islands/menu.tsx`,
      '"use client";\nimport { helper } from "./helper";\nexport const Menu = () => [helper, import("@clerk/react"), import("./bridge")];\n',
    );
    write(
      `${web}src/islands/helper.ts`,
      'import { SignIn } from "@clerk/react";\nexport const helper = SignIn;\n',
    );
    // Loaded with import() after the page is interactive, so not part of its first render.
    write(
      `${web}src/islands/bridge.tsx`,
      '"use client";\nimport { ClerkProvider } from "@clerk/react";\nexport const b = ClerkProvider;\n',
    );
    // Not reached from a public page: the private app may use the identity SDK as it does today.
    write(
      `${web}src/screens/workspace.tsx`,
      'import { useAuth } from "@clerk/react";\nexport const w = useAuth;\n',
    );

    assert.deepEqual(publicServerEntries(root).sort(), [
      `${web}app/(public)/terms/page.tsx`,
      `${web}src/server/identity.ts`,
      `${web}src/server/public-api.ts`,
    ]);
    const flagged = publicServerViolations(root);
    assert.equal(flagged.length, 4, flagged.join("\n"));
    assert.match(
      flagged[0]!,
      /src\/components\/shell\.tsx:2 public-server server code .* imports @workspace\/api-client-react/,
    );
    assert.match(
      flagged[1]!,
      /src\/islands\/account\.tsx:3 public-server an island .* imports @clerk\/react as it loads/,
    );
    assert.match(
      flagged[2]!,
      /src\/islands\/helper\.ts:1 public-server an island .* imports @clerk\/react as it loads/,
    );
    assert.match(
      flagged[3]!,
      /src\/server\/identity\.ts:1 public-server server code .* imports @clerk\/nextjs\/server/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the web app writes dates, times, amounts and counts only through its formatter (NFR-008)", () => {
  const screen = "artifacts/valo/src/screens/example.tsx";
  for (const [code, what] of [
    ["const shown = new Date(row.createdAt).toLocaleString();", "toLocaleString()"],
    ['const shown = new Date(row.reviewBy).toLocaleDateString("en-GB");', "toLocaleDateString()"],
    ["const shown = new Date(row.at).toLocaleTimeString();", "toLocaleTimeString()"],
    ['const shown = size.toLocaleString("en-NG");', "toLocaleString()"],
    [
      'const shown = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(1);',
      "Intl.NumberFormat",
    ],
    ['const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos" });', "Intl.DateTimeFormat"],
    ['const ago = new Intl.RelativeTimeFormat("en");', "Intl.RelativeTimeFormat"],
  ] as const) {
    const flagged = webFormattingViolations(screen, code + "\n");
    assert.equal(flagged.length, 1, code);
    assert.ok(flagged[0]!.startsWith(`${screen}:1 web-formatting ${what} `), flagged[0]);
  }
  // The formatter's own calls, and a screen that writes through it, are what the rule asks for.
  assert.deepEqual(webFormattingViolations(WEB_FORMATTER, 'new Intl.DateTimeFormat("en-GB");\n'), []);
  assert.deepEqual(
    webFormattingViolations(
      screen,
      'import { formatDay, formatNaira } from "@/lib/format";\nconst shown = formatDay(row.dueDate) + formatNaira(row.amountKobo);\n',
    ),
    [],
  );
  // Other locale-aware calls write no date, amount or count.
  assert.deepEqual(
    webFormattingViolations(screen, "const first = a.localeCompare(b); const up = a.toLocaleUpperCase();\n"),
    [],
  );
});

test("only a migration names the function that reseeds a history's digest", () => {
  const call = `await db.execute(sql\`select ${HISTORY_RESEED}('valo_events')\`);\n`;
  const found = historyReseedViolations("artifacts/api-server/src/modules/operations/example.ts", call);
  assert.deepEqual(found, [
    "artifacts/api-server/src/modules/operations/example.ts:1 history-reseed only a migration reseeds a history's digest",
  ]);
  assert.deepEqual(
    historyReseedViolations("artifacts/valo/src/components/example.tsx", "const a = 1;\n"),
    [],
  );
  // The migrations are SQL, outside the product source the rule reads; the repository keeps the rule.
  assert.deepEqual(historyReseedReport(), []);
});

test("product code puts no text into a page as HTML, and hands a browser HTML only where it is reviewed (SEC-003)", () => {
  const screen = "artifacts/valo/src/screens/example.tsx";
  for (const [code, what] of [
    ["element.innerHTML = note;", "innerHTML"],
    ["element.outerHTML += note;", "outerHTML"],
    ['element.insertAdjacentHTML("beforeend", note);', "insertAdjacentHTML()"],
    ["const part = range.createContextualFragment(note);", "createContextualFragment()"],
    ["document.write(note);", "document.write()"],
    ["document.writeln(note);", "document.writeln()"],
    ["await page.setContent(note);", "setContent()"],
    ['const frame = <iframe title="x" sandbox="" srcDoc={note} />;', "srcDoc"],
  ] as const) {
    const flagged = rawHtmlViolations(screen, code + "\n");
    assert.equal(flagged.length, 1, code);
    assert.ok(flagged[0]!.startsWith(`${screen}:1 raw-html ${what} `), flagged[0]);
  }
  // Text drawn as text, a state setter that happens to share a name, and reading HTML are not sinks.
  assert.deepEqual(
    rawHtmlViolations(
      screen,
      "const a = <p>{note}</p>; setContent(next); const b = element.innerHTML; element.textContent = note;\n",
    ),
    [],
  );
  // A reviewed file may hand a browser HTML, and the repository keeps the rule.
  const renderer = Object.keys(RAW_HTML_ENTRIES)[0]!;
  assert.deepEqual(rawHtmlViolations(renderer, "await page.setContent(html);\n"), []);
  assert.deepEqual(rawHtmlReport(), []);
});

test("product code builds no SQL from text but where it is reviewed, and each review counts its texts (SEC-003)", () => {
  const route = "artifacts/api-server/src/modules/documents/example.ts";
  for (const [code, what] of [
    ["await db.execute(sql.raw(`DELETE FROM ${table}`));", "sql.raw()"],
    ["await db.execute(sql.raw(text));", "sql.raw()"],
    ["await pool.query(`SELECT * FROM valo_tasks WHERE title = '${title}'`);", "a query built from text"],
    ['await client.query("SELECT * FROM " + table, []);', "a query built from text"],
  ] as const) {
    const flagged = rawSqlViolations(route, code + "\n");
    assert.equal(flagged.length, 1, code);
    assert.ok(flagged[0]!.startsWith(`${route}:1 raw-sql ${what} `), flagged[0]);
  }
  // Values passed as parameters, through Drizzle's sql template or a fixed text, build no SQL.
  assert.deepEqual(
    rawSqlViolations(
      route,
      'await db.execute(sql`SELECT * FROM valo_tasks WHERE title = ${title}`);\nawait pool.query("SELECT 1 WHERE $1", [x]);\nawait db.execute(sql.raw("SET LOCAL statement_timeout = 1000"));\n',
    ),
    [],
  );
  // A reviewed file passes with as many texts as its review gives, and fails with another number.
  const [reviewed, entry] = Object.entries(RAW_SQL_ENTRIES).find(([, e]) => e.texts === 1)!;
  const one = "await pool.query(`SELECT count(*) FROM ${table}`);\n";
  assert.deepEqual(rawSqlViolations(reviewed, one), []);
  assert.equal(entry.texts, 1);
  assert.deepEqual(rawSqlViolations(reviewed, one + one), [
    `${reviewed} raw-sql builds 2 SQL text(s) while it runs; its review lists 1, so review the change`,
  ]);
  assert.deepEqual(rawSqlReport(), []);
});

test("the repository has no silent catches, no import cycles and no unreviewed binding checks", () => {
  assert.deepEqual(silentCatchReport(), []);
  assert.deepEqual(workspaceActorReport(), []);
  assert.deepEqual(inferenceBindingReport(), []);
  const graph = apiImportGraph();
  assert.ok(graph.size > 100, "the API import graph was actually read");
  assert.deepEqual(importCycles(graph), []);
  assert.deepEqual(cycleViolations(graph), []);
  assert.deepEqual(moduleBoundaryViolations(graph), []);
  assert.deepEqual(publicServerViolations(), []);
  assert.deepEqual(webFormattingReport(), []);
  assert.ok(
    publicServerEntries().includes("artifacts/valo/src/server/public-api.ts"),
    "the public pages' server code was read",
  );
  assert.ok(
    [...graph.keys()].some((file) => file.includes("/modules/ai/")),
    "the ai module was read",
  );
});
