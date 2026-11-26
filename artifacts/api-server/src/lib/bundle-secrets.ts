import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { OTHER_PACKAGE_SETTINGS, SETTINGS, type SettingDefinition } from "../platform/settings";

/**
 * What the web app sends to browsers holds no secret (SEC-002, "no secret-bearing client bundle";
 * OPS-004, "no keys in ... browser bundles"). The build's static files and the public folder are what
 * a browser is sent as they are; the server's own bundle is not.
 */
export const BROWSER_FOLDERS = [".next/static", "public"] as const;

/** The shapes of secrets Valo holds or could be handed, found without knowing their values. */
export const SECRET_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  // The payment provider's and the identity provider's secret keys both begin so; their publishable
  // keys begin pk_ and belong in the browser.
  { name: "a payment or identity provider's secret key", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: "a private key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  {
    name: "a database connection string with a password",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/"'`]+:[^\s@/"'`]+@/,
  },
];

/** Shorter values are not searched for: they would match ordinary text, and no secret Valo uses is that short. */
export const SHORTEST_SEARCHED_VALUE = 16;

export type BundleFinding = { file: string; what: string };

const definitions: Record<string, SettingDefinition> = { ...SETTINGS, ...OTHER_PACKAGE_SETTINGS };

/** Each secret setting that is set here, by name; never its value in a finding or a log. */
export function secretValues(env: Record<string, string | undefined>) {
  return Object.entries(definitions)
    .filter(([name, definition]) => definition.secret && (env[name]?.length ?? 0) >= SHORTEST_SEARCHED_VALUE)
    .map(([name]) => ({ name, value: env[name]! }));
}

function filesUnder(folder: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(folder, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Every file under the web app's browser folders, and what secret each holds: a secret setting's
 * value from `env`, or a secret's shape. A finding names the file and the setting or the shape, never
 * the secret itself.
 */
export function scanBrowserFiles(webRoot: string, env: Record<string, string | undefined>) {
  const values = secretValues(env);
  const built = filesUnder(join(webRoot, ".next/static")).length;
  const files = BROWSER_FOLDERS.flatMap((folder) => filesUnder(join(webRoot, folder)));
  const findings: BundleFinding[] = [];
  for (const path of files) {
    const text = readFileSync(path, "latin1");
    const file = relative(webRoot, path);
    for (const { name, value } of values)
      if (text.includes(value)) findings.push({ file, what: `the value of ${name}` });
    for (const { name, pattern } of SECRET_SHAPES)
      if (pattern.test(text)) findings.push({ file, what: name });
  }
  return { files: files.length, built, findings };
}
