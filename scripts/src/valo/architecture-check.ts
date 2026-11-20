import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Repository rules that the formatter and compiler cannot express. Each rule
 * returns violations as "path:line rule message" strings so CI output is stable.
 *
 * - silent-catch: an empty catch block, or a `.catch()` handler that does
 *   nothing, must carry a comment explaining why the error is ignored. A catch
 *   that records, returns or rethrows a failure is handling it.
 * - import-cycle: no import cycles between API source files, counting type-only
 *   and lazy imports.
 * - workspace-actor: see workspaceActorViolations.
 * - inference-bindings: see inferenceBindingViolations.
 * - module-boundary: see moduleBoundaryViolations.
 * - public-server: see publicServerViolations.
 * - web-formatting: see webFormattingViolations.
 */

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function lineOf(source: ts.SourceFile, position: number) {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function commentsIn(source: ts.SourceFile, node: ts.Node): string {
  const text = source.getFullText();
  const ranges = [
    ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
    ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
  ];
  const own = node.getText(source);
  const inside = own.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];
  return [...ranges.map((r) => text.slice(r.pos, r.end)), ...inside].join("\n");
}

/** The statement containing a node, whose leading comments explain the whole statement. */
function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isBlock(current.parent) &&
    !ts.isSourceFile(current.parent) &&
    !ts.isCaseClause(current.parent) &&
    !ts.isDefaultClause(current.parent)
  )
    current = current.parent;
  return current;
}

/** Returns silent-catch violations for one source text. */
export function silentCatchViolations(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node)) {
      const explained = commentsIn(source, node.block).trim().length > 0;
      if (node.block.statements.length === 0 && !explained)
        violations.push(
          `${path}:${lineOf(source, node.getStart(source))} silent-catch empty catch block needs a comment explaining why the error is ignored`,
        );
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1
    ) {
      const handler = node.arguments[0]!;
      if (
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
        handler.parameters.length === 0
      ) {
        const body = handler.body;
        const empty =
          (ts.isBlock(body) && body.statements.length === 0) ||
          (!ts.isBlock(body) &&
            (body.kind === ts.SyntaxKind.UndefinedKeyword ||
              (ts.isIdentifier(body) && body.text === "undefined") ||
              body.kind === ts.SyntaxKind.NullKeyword));
        if (empty && !commentsIn(source, enclosingStatement(node)).trim())
          violations.push(
            `${path}:${lineOf(source, node.getStart(source))} silent-catch .catch handler discards the rejection without an explanatory comment`,
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function sourceFiles(directory: string, include: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry === "generated") continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, include));
    else if (include(full)) out.push(full);
  }
  return out.sort();
}

const isSource = (path: string) =>
  /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts") && !path.endsWith(".generated.ts");
const isProductSource = (path: string) =>
  isSource(path) && !/\.test\.tsx?$/.test(path) && !path.includes("/test-support/");

/** Import graph of API server product source, keyed by repository-relative path. */
export function apiImportGraph(root = repositoryRoot): Map<string, Set<string>> {
  const base = join(root, "artifacts/api-server/src");
  const files = sourceFiles(base, isProductSource);
  const known = new Set(files);
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    const edges = new Set<string>();
    const text = readFileSync(file, "utf8");
    const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["'](\.[^"']+)["']/g;
    for (const match of text.matchAll(pattern)) {
      const target = resolve(dirname(file), match[1]!);
      for (const candidate of [`${target}.ts`, `${target}.tsx`, join(target, "index.ts"), target])
        if (known.has(candidate)) {
          edges.add(relative(root, candidate));
          break;
        }
    }
    graph.set(relative(root, file), edges);
  }
  return graph;
}

/** Strongly connected components with more than one member (Tarjan). */
export function importCycles(graph: Map<string, Set<string>>): string[][] {
  let index = 0;
  const order = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    onStack = new Set<string>();
  const cycles: string[][] = [];
  const strongConnect = (node: string) => {
    order.set(node, index);
    low.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!order.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, order.get(next)!));
    }
    if (low.get(node) === order.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const node of graph.keys()) if (!order.has(node)) strongConnect(node);
  return cycles.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}

/** HTTP code: routes, middlewares, `*-http.ts` handlers and the app itself. */
export const isHttpSource = (path: string) =>
  /^artifacts\/api-server\/src\/(routes|middlewares)\//.test(path) ||
  /^artifacts\/api-server\/src\/lib\/[^/]+-http\.ts$/.test(path) ||
  path === "artifacts/api-server/src/app.ts";

/**
 * The only code that may enter a workspace's database scope (runInWorkspaceScope): the
 * identity middleware, for the workspace it resolved from the membership, and background
 * work for the workspace of the stored record it processes. A new caller needs review.
 */
export const WORKSPACE_SCOPE_ENTRIES = [
  "artifacts/api-server/src/middlewares/valo-identity.ts",
  "artifacts/api-server/src/modules/exports/valo-exports.ts",
  "artifacts/api-server/src/modules/privacy/valo-privacy-processing.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-worker.ts",
  "artifacts/api-server/src/modules/privacy/valo-workspace-export-jobs.ts",
];

/**
 * workspace-actor: a workspace named by the browser must never become the workspace a
 * request acts in (see platform/workspace-context.ts). HTTP code may not create an
 * actor, cast to WorkspaceActor, or write a `workspaceId` in an object literal. No
 * code may copy an actor while changing its workspace or identity.
 * `workspaceActorFromMembership` belongs to resolveWorkspace alone, and only the files in
 * WORKSPACE_SCOPE_ENTRIES may enter a workspace scope.
 */
export function workspaceActorViolations(path: string, text: string): string[] {
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const http = isHttpSource(path);
  const report = (node: ts.Node, message: string) =>
    violations.push(`${path}:${lineOf(source, node.getStart(source))} workspace-actor ${message}`);
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      if (http && node.text === "workspaceActorFromRecord")
        report(node, "HTTP code may not create a workspace actor from a record");
      if (
        node.text === "workspaceActorFromMembership" &&
        path !== "artifacts/api-server/src/modules/workspaces/valo-workspaces.ts" &&
        path !== "artifacts/api-server/src/platform/workspace-context.ts"
      )
        report(node, "only resolveWorkspace may issue an actor from a membership");
      if (node.text === "runInWorkspaceScope" && !WORKSPACE_SCOPE_ENTRIES.includes(path))
        report(node, "only the reviewed entries in WORKSPACE_SCOPE_ENTRIES may enter a workspace scope");
    }
    if (
      http &&
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      ts.isTypeReferenceNode(node.type) &&
      node.type.typeName.getText(source) === "WorkspaceActor"
    )
      report(node, "HTTP code may not cast a value to WorkspaceActor");
    if (ts.isObjectLiteralExpression(node)) {
      const named = (property: ts.ObjectLiteralElementLike) =>
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
        ["workspaceId", "identityId"].includes(property.name.getText(source).replace(/["']/g, ""));
      const spreadsActor = node.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) && /(^|\.)\w*[aA]ctor$/.test(property.expression.getText(source)),
      );
      if (spreadsActor && node.properties.some(named))
        report(node, "do not change the workspace or identity of an existing actor");
    }
    if (http && ts.isObjectLiteralExpression(node))
      for (const property of node.properties)
        if (
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          property.name.getText(source).replace(/["']/g, "") === "workspaceId"
        )
          report(property, "HTTP code may not write a workspaceId; use the server-issued actor");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function workspaceActorReport(root = repositoryRoot): string[] {
  return sourceFiles(join(root, "artifacts/api-server/src"), isProductSource).flatMap((file) =>
    workspaceActorViolations(relative(root, file), readFileSync(file, "utf8")),
  );
}

export function cycleViolations(graph = apiImportGraph()): string[] {
  return importCycles(graph).map((cycle) => `${cycle[0]}:1 import-cycle import cycle: ${cycle.join(" -> ")}`);
}

/**
 * The only code that may hand the inference dispatcher the checks that compare approved work
 * with the current code (provideFiniteWorkBindings): the operator commands that run approved
 * inference work. A new caller needs review.
 */
export const FINITE_WORK_BINDING_ENTRIES = [
  "artifacts/api-server/src/scripts/finite-customer-evaluation.ts",
  "artifacts/api-server/src/scripts/finite-inference-run.ts",
];

/**
 * inference-bindings: outside its own module, provideFiniteWorkBindings may appear only in the
 * entries in FINITE_WORK_BINDING_ENTRIES, and there only as a call that passes the real
 * assertFiniteWorkBindings, or where it is destructured from the module. Tests may pass
 * stand-ins.
 */
export function inferenceBindingViolations(path: string, text: string): string[] {
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || !text.includes("provideFiniteWorkBindings"))
    return [];
  if (path === "artifacts/api-server/src/modules/ai/managed-inference.ts") return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const report = (node: ts.Node, message: string) =>
    violations.push(`${path}:${lineOf(source, node.getStart(source))} inference-bindings ${message}`);
  const entry = FINITE_WORK_BINDING_ENTRIES.includes(path);
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "provideFiniteWorkBindings") {
      const parent = node.parent;
      const call = ts.isCallExpression(parent) && parent.expression === node ? parent : undefined;
      const destructured = ts.isBindingElement(parent) && parent.name === node && !parent.propertyName;
      if (!entry)
        report(
          node,
          "only the reviewed entries in FINITE_WORK_BINDING_ENTRIES may provide work-binding checks",
        );
      else if (call) {
        const [checks] = call.arguments;
        if (
          call.arguments.length !== 1 ||
          !checks ||
          !ts.isIdentifier(checks) ||
          checks.text !== "assertFiniteWorkBindings"
        )
          report(node, "provide the real assertFiniteWorkBindings");
      } else if (!destructured)
        report(node, "call provideFiniteWorkBindings directly; do not pass it on or rename it");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function inferenceBindingReport(root = repositoryRoot): string[] {
  return sourceFiles(join(root, "artifacts/api-server/src"), isProductSource).flatMap((file) =>
    inferenceBindingViolations(relative(root, file), readFileSync(file, "utf8")),
  );
}

const MODULES = "artifacts/api-server/src/modules/";

/**
 * module-boundary (decision 0001): product code outside a module imports it only through the
 * module's index.ts, so a module's other files can change without breaking callers. Imports
 * within a module are free; tests may reach a module's files directly.
 */
export function moduleBoundaryViolations(graph = apiImportGraph()): string[] {
  const moduleOf = (path: string) =>
    path.startsWith(MODULES) ? path.slice(MODULES.length).split("/")[0] : undefined;
  const violations: string[] = [];
  for (const [file, edges] of graph)
    for (const target of edges) {
      const owner = moduleOf(target);
      if (!owner || moduleOf(file) === owner || target === `${MODULES}${owner}/index.ts`) continue;
      violations.push(
        `${file}:1 module-boundary imports ${target.slice(MODULES.length)}; import modules/${owner} through its index.ts`,
      );
    }
  return violations.sort();
}

const WEB = "artifacts/valo/";
const CLERK = /^@clerk\//;

type WebFile = { client: boolean; imports: { specifier: string; line: number; dynamic: boolean }[] };

/** Each web app product file's value imports (type-only ones carry no code) and whether it is a
 * "use client" file, keyed by repository-relative path. */
function webFiles(root: string): Map<string, WebFile> {
  const files = new Map<string, WebFile>();
  for (const dir of ["src", "app"])
    for (const full of sourceFiles(join(root, WEB, dir), isProductSource)) {
      const path = relative(root, full);
      const source = ts.createSourceFile(
        path,
        readFileSync(full, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const first = source.statements[0];
      const client =
        !!first &&
        ts.isExpressionStatement(first) &&
        ts.isStringLiteral(first.expression) &&
        first.expression.text === "use client";
      const imports: WebFile["imports"] = [];
      const add = (literal: ts.Node, dynamic: boolean) => {
        if (ts.isStringLiteral(literal))
          imports.push({ specifier: literal.text, line: lineOf(source, literal.getStart()), dynamic });
      };
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          const typeOnly =
            !!clause &&
            (clause.isTypeOnly ||
              (!clause.name &&
                !!clause.namedBindings &&
                ts.isNamedImports(clause.namedBindings) &&
                clause.namedBindings.elements.length > 0 &&
                clause.namedBindings.elements.every((element) => element.isTypeOnly)));
          if (!typeOnly) add(node.moduleSpecifier, false);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly)
          add(node.moduleSpecifier, false);
        else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0]
        )
          add(node.arguments[0], true);
        ts.forEachChild(node, visit);
      };
      visit(source);
      files.set(path, { client, imports });
    }
  return files;
}

/** Where the server code of the public pages starts: the server-only folder, the public routes, the
 * root layout and the sitemap. */
export function publicServerEntries(root = repositoryRoot): string[] {
  return [...webFiles(root).keys()].filter(
    (path) =>
      path.startsWith(`${WEB}src/server/`) ||
      path.startsWith(`${WEB}app/(public)/`) ||
      path === `${WEB}app/layout.tsx` ||
      path === `${WEB}app/sitemap.ts`,
  );
}

/**
 * public-server (decision 0011): a server-rendered public page holds only what any anonymous visitor
 * may see, and the identity provider runs in the browser alone.
 *
 * - The server code a public page runs (its route files and what they import, up to a "use client"
 *   file) imports neither the identity SDK (`@clerk/*`) nor the browser's API client
 *   (`@workspace/api-client-react`), whose base address and token getter are module-level settings
 *   that every request on a server would share. It reads the API through src/server/public-api.ts.
 * - A "use client" island such a page renders, and every file it imports, loads the identity SDK only
 *   with import(), after the page is interactive: an island's module code also runs in the server's
 *   render, and the content must not wait for the SDK. Files an island loads with import() are not
 *   part of the page's first render, so they are not checked.
 */
export function publicServerViolations(root = repositoryRoot): string[] {
  const files = webFiles(root);
  const resolveWeb = (from: string, specifier: string) => {
    const base = specifier.startsWith("@/")
      ? join(WEB, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? join(dirname(from), specifier)
        : undefined;
    if (!base) return undefined;
    return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base].find((p) =>
      files.has(p),
    );
  };
  const violations = new Set<string>();
  const seen = new Set<string>();
  const visit = (path: string, mode: "server" | "island") => {
    if (seen.has(`${mode} ${path}`)) return;
    seen.add(`${mode} ${path}`);
    for (const { specifier, line, dynamic } of files.get(path)?.imports ?? []) {
      const target = resolveWeb(path, specifier);
      if (!target) {
        if (mode === "server" && (CLERK.test(specifier) || specifier === "@workspace/api-client-react"))
          violations.add(
            `${path}:${line} public-server server code of a public page imports ${specifier}; read the API through src/server/public-api.ts, as an anonymous visitor`,
          );
        else if (mode === "island" && CLERK.test(specifier) && !dynamic)
          violations.add(
            `${path}:${line} public-server an island of a public page imports ${specifier} as it loads; load it with import() once the page is interactive`,
          );
        continue;
      }
      if (mode === "island" && dynamic) continue;
      visit(target, files.get(target)!.client ? "island" : mode);
    }
  };
  for (const entry of publicServerEntries(root)) visit(entry, files.get(entry)!.client ? "island" : "server");
  return [...violations].sort();
}

/** The one file of the web app that writes dates, times, amounts and counts. */
export const WEB_FORMATTER = `${WEB}src/lib/format.ts`;
const LOCALE_METHODS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);
const INTL_FORMATS = new Set(["DateTimeFormat", "NumberFormat", "RelativeTimeFormat"]);

/**
 * web-formatting (NFR-008): the web app writes dates, times, amounts and counts through
 * src/lib/format.ts alone: on a Lagos clock, the month as a word, amounts in naira. A file that calls
 * toLocaleString, toLocaleDateString or toLocaleTimeString, or uses Intl.DateTimeFormat,
 * Intl.NumberFormat or Intl.RelativeTimeFormat, writes them its own way: in the viewer's own locale
 * and time zone, or differently on the server and in the browser.
 */
export function webFormattingViolations(path: string, text: string): string[] {
  if (path === WEB_FORMATTER) return [];
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const flag = (node: ts.Node, what: string) =>
    violations.push(
      `${path}:${lineOf(source, node.getStart())} web-formatting ${what} writes a date, amount or count its own way; use src/lib/format.ts`,
    );
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (LOCALE_METHODS.has(name) && ts.isCallExpression(node.parent) && node.parent.expression === node)
        flag(node.name, `${name}()`);
      else if (INTL_FORMATS.has(name) && ts.isIdentifier(node.expression) && node.expression.text === "Intl")
        flag(node, `Intl.${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function webFormattingReport(root = repositoryRoot): string[] {
  return ["src", "app"].flatMap((dir) =>
    sourceFiles(join(root, WEB, dir), isProductSource).flatMap((file) =>
      webFormattingViolations(relative(root, file), readFileSync(file, "utf8")),
    ),
  );
}

export function silentCatchReport(root = repositoryRoot): string[] {
  const roots = [
    "artifacts/api-server/src",
    "artifacts/valo/src",
    "artifacts/valo/app",
    "lib/valo-core/src",
    "lib/valo-records/src",
    "lib/db/src",
    "scripts/src",
  ];
  return roots.flatMap((dir) =>
    sourceFiles(join(root, dir), isProductSource).flatMap((file) =>
      silentCatchViolations(relative(root, file), readFileSync(file, "utf8")),
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const violations = [
    ...silentCatchReport(),
    ...cycleViolations(),
    ...workspaceActorReport(),
    ...inferenceBindingReport(),
    ...moduleBoundaryViolations(),
    ...publicServerViolations(),
    ...webFormattingReport(),
  ];
  for (const violation of violations) process.stdout.write(`${violation}\n`);
  process.stdout.write(`architecture check: ${violations.length} violation(s)\n`);
  if (violations.length) process.exitCode = 1;
}
