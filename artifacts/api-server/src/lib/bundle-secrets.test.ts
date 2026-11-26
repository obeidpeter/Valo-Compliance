import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBrowserFiles, secretValues, SHORTEST_SEARCHED_VALUE } from "./bundle-secrets";

/** A scratch web app folder with these files, removed after the test. */
function webApp(t: { after: (fn: () => void) => void }, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "valo-bundle-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const synthetic = (prefix: string) => `${prefix}${randomBytes(16).toString("hex")}`;

test("no file the browser is sent may hold a secret setting's value or a secret's shape (SEC-002, OPS-004)", async (t) => {
  await t.test("a clean build passes, publishable keys and the words around keys included", (t) => {
    const root = webApp(t, {
      ".next/static/chunks/app.js": `var publishable="pk_test_${"a".repeat(40)}";if(!k.startsWith("sk_"))fail("a secret key begins sk_");`,
      ".next/static/css/app.css": "body{color:#111}",
      "public/logo.svg": "<svg></svg>",
    });
    const { files, built, findings } = scanBrowserFiles(root, {});
    assert.equal(files, 3);
    assert.equal(built, 2);
    assert.deepEqual(findings, []);
  });

  await t.test(
    "a secret setting's value is found in a static file or a public one, by its name only",
    (t) => {
      const session = synthetic("synthetic-session-"),
        login = synthetic("synthetic_login_password_");
      const root = webApp(t, {
        ".next/static/chunks/leak.js": `var s="${session}";`,
        "public/config.json": JSON.stringify({ password: login }),
      });
      const { findings } = scanBrowserFiles(root, {
        SESSION_SECRET: session,
        VALO_DRAFTER_LOGIN_PASSWORD: login,
      });
      assert.deepEqual(findings, [
        { file: ".next/static/chunks/leak.js", what: "the value of SESSION_SECRET" },
        { file: "public/config.json", what: "the value of VALO_DRAFTER_LOGIN_PASSWORD" },
      ]);
      assert.ok(!JSON.stringify(findings).includes(session), "a finding never carries the secret");
    },
  );

  await t.test("the shapes of secrets are found without their values", (t) => {
    const root = webApp(t, {
      ".next/static/chunks/a.js": `var k="${synthetic("sk_live_")}";`,
      ".next/static/chunks/b.js": "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
      ".next/static/chunks/c.js": `var u="postgresql://valo_drafter_login:${synthetic("p")}@db.internal:5432/valo";`,
    });
    assert.deepEqual(
      scanBrowserFiles(root, {}).findings.map((finding) => `${finding.file}: ${finding.what}`),
      [
        ".next/static/chunks/a.js: a payment or identity provider's secret key",
        ".next/static/chunks/b.js: a private key",
        ".next/static/chunks/c.js: a database connection string with a password",
      ],
    );
  });

  await t.test(
    "only secret settings are searched for, and only values long enough to mean something",
    (t) => {
      const root = webApp(t, { ".next/static/chunks/app.js": "listen(8080);level='info';short='abc123'" });
      const env = { PORT: "8080", LOG_LEVEL: "info", PAYSTACK_WEBHOOK_SECRET: "abc123" };
      assert.deepEqual(secretValues(env), []);
      assert.ok("abc123".length < SHORTEST_SEARCHED_VALUE);
      assert.deepEqual(scanBrowserFiles(root, env).findings, []);
    },
  );

  await t.test("the server's own bundle is not what the browser is sent, so it is not read", (t) => {
    const session = synthetic("synthetic-session-");
    const root = webApp(t, {
      ".next/server/app/page.js": `var s="${session}";`,
      ".next/static/chunks/app.js": "var x=1;",
    });
    assert.deepEqual(scanBrowserFiles(root, { SESSION_SECRET: session }).findings, []);
  });

  await t.test("without a build there is nothing of the build's own to read", (t) => {
    const root = webApp(t, { "public/logo.svg": "<svg></svg>" });
    assert.equal(scanBrowserFiles(root, {}).built, 0);
  });
});
