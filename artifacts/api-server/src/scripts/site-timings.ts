/**
 * How long the menu's pages take on this machine: `pnpm --filter @workspace/api-server perf:site`.
 *
 * It times, a few rounds each, the API reads the public menu pages make and each page as the web
 * server renders it, API reads included, and says whether the web server is the compiled build or
 * the development server. It sends read-only requests to this machine's own servers only, with no
 * cookie or credential, and writes nothing. It leaves out the browser and the network between the
 * person using the site and the server, so a page in the browser takes longer than its time here.
 *
 *   --api=http://127.0.0.1:8080    the API (default: this machine, port $PORT or 8080)
 *   --web=http://127.0.0.1:20147   the web server (default: this machine, port $VALO_FRONTEND_PORT or 20147)
 *   --rounds=3                     1 to 3; each round makes about 13 of the 60 anonymous reads a minute allows
 */
import { pathToFileURL } from "node:url";
import { setting } from "../platform/settings";

/** The API reads the public menu's pages make (artifacts/valo/app/(public)). */
export const API_READS = [
  "/api/public/status",
  "/api/public/catalogue?type=all&page=1&access=all&sort=relevance",
  "/api/public/catalogue?type=guidance",
  "/api/public/coverage",
  "/api/public/resources",
  "/api/public/discovery",
] as const;
/** The public menu's pages, in the order the header lists them, the home page first. */
export const PAGES = [
  "/",
  "/library",
  "/compliance",
  "/resources",
  "/industries",
  "/pricing",
  "/help",
] as const;
export const MAX_ROUNDS = 3;

/** An origin on this machine: http or https to localhost, 127.0.0.0/8 or ::1, with no path. Any other
 * address is refused, so the command never sends a request elsewhere. */
export function localOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Error(`not an address: ${raw}`);
  }
  const loopback =
    url.hostname === "localhost" || url.hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopback ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(`only this machine's own servers are timed, not ${raw}`);
  return url.origin;
}

export type Options = { api: string; web: string; rounds: number };

export function parseOptions(
  argv: readonly string[],
  ports: { api?: string | undefined; web?: string | undefined } = {},
): Options {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? undefined;
  for (const arg of argv)
    if (!/^--(api|web|rounds)=/.test(arg)) throw Error(`unknown option ${arg}: use --api, --web or --rounds`);
  const rounds = Number(value("rounds") ?? 3);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS)
    throw Error(`--rounds is a whole number from 1 to ${MAX_ROUNDS}`);
  return {
    api: localOrigin(value("api") ?? `http://127.0.0.1:${ports.api || "8080"}`),
    web: localOrigin(value("web") ?? `http://127.0.0.1:${ports.web || "20147"}`),
    rounds,
  };
}

export type Timing = { ms: number; status: number | "no answer" };
export type Summary = { fastest: number; median: number; slowest: number; answers: string };

/** The fastest, median and slowest of a target's timings, and the answers it gave, counted. */
export function summarise(timings: readonly Timing[]): Summary {
  const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const counts = new Map<string, number>();
  for (const t of timings) counts.set(String(t.status), (counts.get(String(t.status)) ?? 0) + 1);
  return {
    fastest: sorted[0] ?? Number.NaN,
    median,
    slowest: sorted.at(-1) ?? Number.NaN,
    answers: [...counts].map(([status, count]) => `${status} ×${count}`).join(", "),
  };
}

/** What the home page's HTML says the web server is: the development server's pages load its
 * unhashed runtime and reload over a socket; a compiled build's do not. */
export function webServerKind(html: string): "compiled build" | "development server" | "unknown" {
  if (/\/_next\/static\/chunks\/webpack\.js|\/_next\/static\/development\/|react-refresh/.test(html))
    return "development server";
  if (
    /\/_next\/static\/chunks\/webpack-[0-9a-f]+\.js|\/_next\/static\/[A-Za-z0-9_-]+\/_buildManifest\.js/.test(
      html,
    )
  )
    return "compiled build";
  return "unknown";
}

/** One timed GET with no cookie or credential, read to its end. */
async function timed(url: string): Promise<Timing & { body: string }> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { accept: url.includes("/api/") ? "application/json" : "text/html" },
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    return { ms: performance.now() - started, status: response.status, body };
  } catch {
    return { ms: performance.now() - started, status: "no answer", body: "" };
  }
}

const ms = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "—");
function table(title: string, rows: [string, Summary][]) {
  const width = Math.max(...rows.map(([name]) => name.length), 10);
  const lines = [
    title,
    `  ${"".padEnd(width)}  ${"fastest".padStart(8)}  ${"median".padStart(8)}  ${"slowest".padStart(8)}  answers`,
  ];
  for (const [name, s] of rows)
    lines.push(
      `  ${name.padEnd(width)}  ${ms(s.fastest).padStart(8)}  ${ms(s.median).padStart(8)}  ${ms(s.slowest).padStart(8)}  ${s.answers}`,
    );
  return lines.join("\n");
}

async function main() {
  const options = parseOptions(process.argv.slice(2), {
    api: setting("PORT"),
    web: setting("VALO_FRONTEND_PORT"),
  });
  const home = await timed(options.web + "/");
  const reads = new Map<string, Timing[]>(API_READS.map((path) => [path, []]));
  const pages = new Map<string, Timing[]>(PAGES.map((path) => [path, []]));
  for (let round = 0; round < options.rounds; round++) {
    for (const path of API_READS) reads.get(path)!.push(await timed(options.api + path));
    for (const path of PAGES) pages.get(path)!.push(await timed(options.web + path));
  }
  const refused = [...reads.values(), ...pages.values()].flat().some((t) => t.status === 429);
  console.log(
    [
      `Valo site timings on this machine, ${options.rounds} round${options.rounds === 1 ? "" : "s"} each.`,
      "Server side only: the browser and the network between you and the server are not included.",
      "",
      `Web server (${options.web}): ${home.status === "no answer" ? "did not answer" : webServerKind(home.body)}`,
      `API (${options.api})`,
      "",
      table(
        "API reads the menu's pages make",
        [...reads].map(([path, t]) => [path, summarise(t)]),
      ),
      "",
      table(
        "Pages, rendered by the web server with their API reads",
        [...pages].map(([path, t]) => [path, summarise(t)]),
      ),
      ...(refused
        ? [
            "",
            "Some reads met the anonymous read limit (429). Wait a minute and run it again with --rounds=1.",
          ]
        : []),
    ].join("\n"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
