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
 * - publisher-connection: see publisherConnectionViolations.
 * - drafter-connection: see drafterConnectionViolations.
 * - reviewer-connection: see reviewerConnectionViolations.
 * - module-boundary: see moduleBoundaryViolations.
 * - public-server: see publicServerViolations.
 * - web-formatting: see webFormattingViolations.
 * - history-reseed: see historyReseedViolations.
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

const posixPath = (value: string) => value.replaceAll("\\", "/");
const posixRelative = (from: string, to: string) => posixPath(relative(from, to));
const posixJoin = (...parts: string[]) => posixPath(join(...parts));

const isSource = (path: string) =>
  /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts") && !path.endsWith(".generated.ts");
const isProductSource = (path: string) =>
  isSource(path) && !/\.test\.tsx?$/.test(path) && !posixPath(path).includes("/test-support/");

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
          edges.add(posixRelative(root, candidate));
          break;
        }
    }
    graph.set(posixRelative(root, file), edges);
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
 * identity middleware, for the workspace it resolved from the membership; background
 * work, for the workspace of the stored record it processes; and the unsubscribe link's
 * action, for the workspace a link Valo signed names. A new caller needs review.
 */
export const WORKSPACE_SCOPE_ENTRIES = [
  "artifacts/api-server/src/middlewares/valo-identity.ts",
  "artifacts/api-server/src/modules/exports/valo-exports.ts",
  "artifacts/api-server/src/modules/privacy/valo-privacy-processing.ts",
  "artifacts/api-server/src/modules/tasks/valo-reminder-worker.ts",
  "artifacts/api-server/src/modules/tasks/reminder-unsubscribe.ts",
  "artifacts/api-server/src/modules/messages/valo-message-dispatcher.ts",
  "artifacts/api-server/src/modules/messages/valo-email-events.ts",
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
    workspaceActorViolations(posixRelative(root, file), readFileSync(file, "utf8")),
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
    inferenceBindingViolations(posixRelative(root, file), readFileSync(file, "utf8")),
  );
}

/** The one file that releases a content version, on the publisher's own database connection. */
export const PUBLISHER_CONNECTION_ENTRY =
  "artifacts/api-server/src/modules/publication/publication-publisher.ts";

/**
 * publisher-connection (decision 0017): the database publishes a content version only in a session
 * that logged in as the publisher. `publisherDb` opens such a session, so it may be named only by
 * the publisher itself. Any other code that reached for it could publish past the gates. Tests
 * may name it, to stand in for it or to check the boundary.
 */
export function publisherConnectionViolations(path: string, text: string): string[] {
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || !text.includes("publisherDb")) return [];
  if (path === PUBLISHER_CONNECTION_ENTRY) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "publisherDb")
      violations.push(
        `${path}:${lineOf(source, node.getStart(source))} publisher-connection only the publisher may use the publisher's database connection`,
      );
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function publisherConnectionReport(root = repositoryRoot): string[] {
  return sourceFiles(join(root, "artifacts/api-server/src"), isProductSource).flatMap((file) =>
    publisherConnectionViolations(posixRelative(root, file), readFileSync(file, "utf8")),
  );
}

/**
 * The files that may name drafting's own database connection: the three drafting paths
 * (docs/architecture/service-logins.md, part 1), the check that drafting can log in, and the record of
 * drafting's own AI attempt.
 */
export const DRAFTER_CONNECTION_ENTRIES = [
  "artifacts/api-server/src/modules/ai-lanes/inference-reviewed-publication.ts",
  "artifacts/api-server/src/modules/editorial/guidance-preparation.ts",
  "artifacts/api-server/src/modules/editorial/operational-authoring.ts",
  "artifacts/api-server/src/modules/editorial/operational-preparation.ts",
  "artifacts/api-server/src/modules/publication/drafting-login.ts",
];

/** The one file that records an AI review's attempt, on review's own database connection (part 2). */
export const REVIEWER_CONNECTION_ENTRIES = [
  "artifacts/api-server/src/modules/editorial/operational-review.ts",
];

/** Reports each naming of a service login's connection outside the files that may use it. */
function serviceConnectionViolations(
  path: string,
  text: string,
  service: { rule: string; names: readonly string[]; entries: readonly string[]; message: string },
): string[] {
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || !service.names.some((n) => text.includes(n)))
    return [];
  if (service.entries.includes(path)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && service.names.includes(node.text))
      violations.push(`${path}:${lineOf(source, node.getStart(source))} ${service.rule} ${service.message}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/**
 * drafter-connection (docs/architecture/service-logins.md, part 1; SEC-006): the database adds a content
 * version or a prepared candidate, and records a drafting attempt, only in a session that logged in as
 * the drafting login. `drafterDb` and `drafterLogin` open such a session, so they may be named only by
 * the drafting paths and the check that drafting can log in. Any other code that reached for them could
 * add content past the preparers' checks. Tests and their fixtures may name them, to stand in for them,
 * to add synthetic content or to check the boundary.
 */
export function drafterConnectionViolations(path: string, text: string): string[] {
  return serviceConnectionViolations(path, text, {
    rule: "drafter-connection",
    names: ["drafterDb", "drafterLogin"],
    entries: DRAFTER_CONNECTION_ENTRIES,
    message: "only the drafting paths may use drafting's database connection",
  });
}

export function drafterConnectionReport(root = repositoryRoot): string[] {
  return sourceFiles(join(root, "artifacts/api-server/src"), isProductSource).flatMap((file) =>
    drafterConnectionViolations(posixRelative(root, file), readFileSync(file, "utf8")),
  );
}

/**
 * reviewer-connection (docs/architecture/service-logins.md, part 2; SEC-006): the database records and
 * updates an AI review's attempt only in a session that logged in as the review login. `reviewerDb` and
 * `reviewerLogin` open such a session, so they may be named only by the code that records a review's
 * attempt. Any other code that reached for them could record a review that was never run. Tests may
 * name them, to stand in for them or to check the boundary.
 */
export function reviewerConnectionViolations(path: string, text: string): string[] {
  return serviceConnectionViolations(path, text, {
    rule: "reviewer-connection",
    names: ["reviewerDb", "reviewerLogin"],
    entries: REVIEWER_CONNECTION_ENTRIES,
    message: "only the review's record may use review's database connection",
  });
}

export function reviewerConnectionReport(root = repositoryRoot): string[] {
  return sourceFiles(join(root, "artifacts/api-server/src"), isProductSource).flatMap((file) =>
    reviewerConnectionViolations(posixRelative(root, file), readFileSync(file, "utf8")),
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
      const path = posixRelative(root, full);
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
      ? posixJoin(WEB, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? posixJoin(dirname(from), specifier)
        : undefined;
    if (!base) return undefined;
    return [
      `${base}.ts`,
      `${base}.tsx`,
      posixJoin(base, "index.ts"),
      posixJoin(base, "index.tsx"),
      base,
    ].find((p) => files.has(p));
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
      webFormattingViolations(posixRelative(root, file), readFileSync(file, "utf8")),
    ),
  );
}

export const HISTORY_RESEED = "valo_history_digest_reseed";
const HISTORY_RESEED_RULE = "scripts/src/valo/architecture-check.ts";

/**
 * history-reseed (ADM-009, docs/architecture/audit-trail.md): only a migration that changes a
 * history's columns reseeds its digest, in that migration's transaction. Product code never names the
 * reseed function, so the application cannot rewrite a digest to hide a change to its history.
 */
export function historyReseedViolations(path: string, text: string): string[] {
  if (path === HISTORY_RESEED_RULE || !text.includes(HISTORY_RESEED)) return [];
  return text
    .split("\n")
    .flatMap((line, index) =>
      line.includes(HISTORY_RESEED)
        ? [`${path}:${index + 1} history-reseed only a migration reseeds a history's digest`]
        : [],
    );
}

export function historyReseedReport(root = repositoryRoot): string[] {
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
      historyReseedViolations(posixRelative(root, file), readFileSync(file, "utf8")),
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
      silentCatchViolations(posixRelative(root, file), readFileSync(file, "utf8")),
    ),
  );
}

/** Product source of the API, the web app and the shared libraries, where the two rules below read. */
function productSourceUnder(root: string, dirs: string[]) {
  return dirs.flatMap((dir) => {
    const full = join(root, dir);
    return statSync(full, { throwIfNoEntry: false })?.isDirectory() ? sourceFiles(full, isProductSource) : [];
  });
}
const libraryDirs = (root: string) =>
  readdirSync(join(root, "lib"))
    .map((name) => `lib/${name}/src`)
    .filter((dir) => statSync(join(root, dir), { throwIfNoEntry: false })?.isDirectory());
const parse = (path: string, text: string) =>
  ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/**
 * The places that hand a browser HTML, each with why what it hands over cannot run (SEC-003,
 * docs/architecture/hostile-input.md, part 4). The linter's react/no-danger keeps raw HTML out of JSX.
 */
export const RAW_HTML_ENTRIES: Record<string, string> = {
  "artifacts/api-server/src/lib/valo-render.ts":
    "draws a document's PDF from HTML in which every text is escaped, with scripts off and every request the page makes refused (valo-render.test.ts)",
  "artifacts/api-server/src/modules/sources/source-extract.ts":
    "reads an official source's own HTML for its text, with scripts off and every request the page makes refused (source-controls.test.ts)",
};
const HTML_PROPERTIES = new Set(["innerHTML", "outerHTML"]);
const HTML_METHODS = new Set(["insertAdjacentHTML", "createContextualFragment", "setContent"]);

/** Each place a file puts text into a page as HTML, or hands a browser HTML. */
function htmlSinks(path: string, text: string) {
  const source = parse(path, text);
  const found: { line: number; what: string }[] = [];
  const add = (node: ts.Node, what: string) => found.push({ line: lineOf(source, node.getStart()), what });
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      ts.isPropertyAccessExpression(node.left) &&
      HTML_PROPERTIES.has(node.left.name.text)
    )
      add(node.left.name, node.left.name.text);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (HTML_METHODS.has(name)) add(node.expression.name, `${name}()`);
      else if (
        (name === "write" || name === "writeln") &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "document"
      )
        add(node.expression.name, `document.${name}()`);
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /^srcdoc$/i.test(node.name.text))
      add(node.name, node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * raw-html (SEC-003): product code puts no text into a page as HTML, and hands a browser HTML only in
 * the reviewed places above. Valo has no rich text: every text a person types is drawn as text.
 */
export function rawHtmlViolations(path: string, text: string): string[] {
  if (RAW_HTML_ENTRIES[path] !== undefined) return [];
  return htmlSinks(path, text).map(
    ({ line, what }) =>
      `${path}:${line} raw-html ${what} puts text into a page as HTML; draw it as text, or add a reviewed entry`,
  );
}

export function rawHtmlReport(root = repositoryRoot): string[] {
  const files = productSourceUnder(root, [
    "artifacts/api-server/src",
    `${WEB}src`,
    `${WEB}app`,
    ...libraryDirs(root),
  ]);
  const violations = files.flatMap((file) =>
    rawHtmlViolations(posixRelative(root, file), readFileSync(file, "utf8")),
  );
  // A reviewed entry that hands a browser no HTML any more is taken out, so the list stays true.
  for (const path of Object.keys(RAW_HTML_ENTRIES)) {
    const full = join(root, path);
    if (!statSync(full, { throwIfNoEntry: false }) || !htmlSinks(path, readFileSync(full, "utf8")).length)
      violations.push(`${path} raw-html is reviewed, but hands a browser no HTML; take it off the list`);
  }
  return violations;
}

/**
 * The places that build SQL text while the program runs, each with how many there are and why the text
 * cannot come from a request (SEC-003, docs/architecture/hostile-input.md, part 4). Everywhere else,
 * values reach the database as parameters, through Drizzle or its `sql` template.
 */
export const RAW_SQL_ENTRIES: Record<string, { texts: number; reason: string }> = {
  "artifacts/api-server/src/modules/ai-lanes/inference-history-loader.ts": {
    texts: 1,
    reason: "names one of two AI run tables from a fixed list",
  },
  "artifacts/api-server/src/modules/ai/inference-allocation-package.ts": {
    texts: 9,
    reason:
      "the inference ledger's schema name, checked against ^[a-z_][a-z0-9_]*$ before any query names it",
  },
  "artifacts/api-server/src/modules/ai/inference-batch-dispatch.ts": {
    texts: 2,
    reason:
      "the inference ledger's schema name, checked against ^[a-z_][a-z0-9_]*$ before any query names it",
  },
  "artifacts/api-server/src/modules/ai/inference-budget-store.ts": {
    texts: 6,
    reason:
      "the inference ledger's schema name, checked against ^[a-z_][a-z0-9_]*$ before any query names it",
  },
  "artifacts/api-server/src/modules/editorial/editorial-lifecycle-sandbox.ts": {
    texts: 2,
    reason: "names a disposable development database made from a random UUID",
  },
  "artifacts/api-server/src/modules/editorial/editorial-permission-evaluation.ts": {
    texts: 1,
    reason: "sets a role from the fixed list editorialRestrictedRoles",
  },
  "artifacts/api-server/src/modules/recovery/valo-recovery-erasure.ts": {
    texts: 3,
    reason:
      "names tables from a fixed list, and columns read from pg_attribute and checked against ^[a-z_]+$",
  },
  "artifacts/api-server/src/scripts/apply-dispute-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-editorial-meter.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-erasure-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-erasure-hardening-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-privacy-information-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-privacy-keys-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-refund-lifecycle.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-reminder-retry.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-reminder-window.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/apply-workspace-export-development.ts": {
    texts: 1,
    reason: "an operator command that applies the SQL of a committed migration file",
  },
  "artifacts/api-server/src/scripts/customer-experience-journey.ts": {
    texts: 1,
    reason: "removes a synthetic workspace's rows over a fixed list of tables",
  },
  "artifacts/api-server/src/scripts/inference-dispatch-crash-child.ts": {
    texts: 1,
    reason: "names an isolated ledger schema checked against ^finite_[a-f0-9]{32}$",
  },
  "artifacts/api-server/src/scripts/isolated-recovery.ts": {
    texts: 2,
    reason: "counts rows in tables from the recovery drill's fixed list",
  },
  "artifacts/api-server/src/scripts/privacy-case-proof.ts": {
    texts: 1,
    reason: "removes a synthetic workspace's rows over a fixed list of tables",
  },
  "artifacts/api-server/src/scripts/privacy-copy-migration.ts": {
    texts: 2,
    reason: "names an isolated schema made from a random UUID",
  },
  "artifacts/api-server/src/scripts/zod-upgrade-proof.ts": {
    texts: 1,
    reason: "removes a synthetic workspace's rows over a fixed list of tables",
  },
  "lib/db/src/index.ts": {
    texts: 1,
    reason: "writes the scope key's validity, a constant interval",
  },
};

/** Each place a file builds SQL text while the program runs: `sql.raw` of anything but a fixed string,
 * and a query whose text is a template with substitutions or a joined string. Text built elsewhere and
 * passed by name is not read here. */
function sqlTexts(path: string, text: string) {
  const source = parse(path, text);
  const found: { line: number; what: string }[] = [];
  const built = (node: ts.Expression | undefined) =>
    node !== undefined &&
    (ts.isTemplateExpression(node) ||
      (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken));
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const [first] = node.arguments;
      const name = node.expression.name.text;
      if (
        name === "raw" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "sql" &&
        !(first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)))
      )
        found.push({ line: lineOf(source, node.getStart()), what: "sql.raw()" });
      else if (name === "query" && built(first))
        found.push({ line: lineOf(source, node.getStart()), what: "a query built from text" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * raw-sql (SEC-003): product code builds no SQL text while the program runs, but in the reviewed places
 * above, each with as many such texts as its entry gives.
 */
export function rawSqlViolations(path: string, text: string): string[] {
  const found = sqlTexts(path, text);
  const entry = RAW_SQL_ENTRIES[path];
  if (entry && entry.texts === found.length) return [];
  if (entry)
    return [
      `${path} raw-sql builds ${found.length} SQL text(s) while it runs; its review lists ${entry.texts}, so review the change`,
    ];
  return found.map(
    ({ line, what }) =>
      `${path}:${line} raw-sql ${what} builds SQL from text; pass values as parameters, or add a reviewed entry`,
  );
}

export function rawSqlReport(root = repositoryRoot): string[] {
  const files = productSourceUnder(root, ["artifacts/api-server/src", ...libraryDirs(root)]);
  const read = new Set(files.map((file) => posixRelative(root, file)));
  const violations = files.flatMap((file) =>
    rawSqlViolations(posixRelative(root, file), readFileSync(file, "utf8")),
  );
  for (const path of Object.keys(RAW_SQL_ENTRIES))
    if (!read.has(path))
      violations.push(`${path} raw-sql is reviewed, but is not product source; take it off the list`);
  return violations;
}

/** The child_process functions that run their command through a shell. */
const SHELL_FUNCTIONS = new Set(["exec", "execSync"]);
const CHILD_PROCESS = new Set(["child_process", "node:child_process"]);

const isChildProcess = (node: ts.Node | undefined) =>
  node !== undefined && ts.isStringLiteralLike(node) && CHILD_PROCESS.has(node.text);

/** The name of an object literal's property, when it is written out. */
function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/**
 * Each place a file starts a shell: it takes exec or execSync from child_process, by import, require
 * or a dynamic import, or, in a file that takes anything from child_process, it writes a `shell`
 * option, which would make spawn, execFile or their synchronous forms run the command through a
 * shell. The option is refused wherever it is written in such a file, since a call may reach it
 * through a wrapper such as promisify.
 */
function shellStarts(path: string, text: string) {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.m?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const found: { line: number; what: string }[] = [];
  const add = (node: ts.Node, what: string) => found.push({ line: lineOf(source, node.getStart()), what });
  /** Local names bound to the whole of child_process. */
  const modules = new Set<string>();
  let takesChildProcess = false;
  const fromBinding = (binding: ts.BindingName) => {
    if (ts.isIdentifier(binding)) modules.add(binding.text);
    else if (ts.isObjectBindingPattern(binding))
      for (const element of binding.elements) {
        const taken = element.propertyName ?? element.name;
        if (ts.isIdentifier(taken) && SHELL_FUNCTIONS.has(taken.text))
          add(element, `${taken.text}() from child_process`);
      }
  };
  const takes = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && isChildProcess(node.moduleSpecifier)) {
      takesChildProcess = true;
      const clause = node.importClause;
      if (clause?.name) modules.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) modules.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          const taken = (element.propertyName ?? element.name).text;
          if (SHELL_FUNCTIONS.has(taken)) add(element, `${taken}() from child_process`);
        }
    }
    if (
      ts.isCallExpression(node) &&
      isChildProcess(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      takesChildProcess = true;
      let parent = node.parent;
      while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
      if (ts.isVariableDeclaration(parent)) fromBinding(parent.name);
      else if (ts.isPropertyAccessExpression(parent) && SHELL_FUNCTIONS.has(parent.name.text))
        add(parent.name, `${parent.name.text}() from child_process`);
    }
    ts.forEachChild(node, takes);
  };
  takes(source);
  if (!takesChildProcess) return found;
  const uses = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      modules.has(node.expression.text) &&
      SHELL_FUNCTIONS.has(node.name.text)
    )
      add(node.name, `${node.name.text}() from child_process`);
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      propertyName(node.name) === "shell"
    )
      add(node.name, "a shell option");
    ts.forEachChild(node, uses);
  };
  uses(source);
  return found.sort((a, b) => a.line - b.line);
}

/**
 * no-shell (small hardening, part 4): product code starts no shell. A program is started with its
 * arguments as a list (execFile, spawn, fork or their synchronous forms), so no text it is given is
 * read as a command.
 */
export function noShellViolations(path: string, text: string): string[] {
  return shellStarts(path, text).map(
    ({ line, what }) =>
      `${path}:${line} no-shell ${what} runs a command through a shell; give execFile or spawn the program and its arguments`,
  );
}

const isProductModule = (path: string) =>
  isProductSource(path) ||
  (path.endsWith(".mjs") && !path.endsWith(".test.mjs") && !posixPath(path).includes("/test-support/"));

export function noShellReport(root = repositoryRoot): string[] {
  const dirs = [
    "artifacts/api-server/src",
    `${WEB}src`,
    `${WEB}app`,
    ...libraryDirs(root),
    "lib/db/scripts",
    "scripts/src",
    "scripts/ops",
  ];
  const files = dirs.flatMap((dir) => {
    const full = join(root, dir);
    return statSync(full, { throwIfNoEntry: false })?.isDirectory() ? sourceFiles(full, isProductModule) : [];
  });
  return files.flatMap((file) => noShellViolations(posixRelative(root, file), readFileSync(file, "utf8")));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const violations = [
    ...silentCatchReport(),
    ...cycleViolations(),
    ...workspaceActorReport(),
    ...inferenceBindingReport(),
    ...publisherConnectionReport(),
    ...drafterConnectionReport(),
    ...reviewerConnectionReport(),
    ...moduleBoundaryViolations(),
    ...publicServerViolations(),
    ...webFormattingReport(),
    ...historyReseedReport(),
    ...rawHtmlReport(),
    ...rawSqlReport(),
    ...noShellReport(),
  ];
  for (const violation of violations) process.stdout.write(`${violation}\n`);
  process.stdout.write(`architecture check: ${violations.length} violation(s)\n`);
  if (violations.length) process.exitCode = 1;
}
