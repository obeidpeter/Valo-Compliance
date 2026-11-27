import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The server takes a change only as JSON from Valo's own pages (`sameOriginMutation`). Three of the
 * contract's changes send nothing: saving a template, removing a saved one and making a copy of one,
 * the buttons on a template's page. The real browser client, compiled as the paths test compiles it,
 * sends each of them as an empty JSON object through the real check, with the origin a browser adds to
 * a change, and each reaches its route. A change sent with no body, as the client sent these before, is
 * still refused: the check itself is unchanged.
 */
test("the web client's changes that send nothing still reach their routes through the same-origin check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "valo-client-writes-"));
  const source = fileURLToPath(new URL("../../../../lib/api-client-react/src/", import.meta.url));
  const original = globalThis.fetch;
  const saved = { trusted: process.env.VALO_TRUSTED_ORIGIN, mode: process.env.NODE_ENV };
  const reached: string[] = [];
  // The middleware's module reaches the database package, which needs an address to load; nothing
  // here connects to it.
  process.env.DATABASE_URL ??= "postgres://synthetic@127.0.0.1:1/none";
  const { sameOriginMutation } = await import("../middlewares/valo-identity");
  const app = express();
  app.use(express.json({ limit: "128kb", inflate: false }));
  app.use("/api/workspace", sameOriginMutation, (req, res) => {
    reached.push(req.method + " " + req.originalUrl);
    res.json({ items: [], recommendations: [], notice: "" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    // The trusted origin is the test server's own, as a development server's is.
    process.env.VALO_TRUSTED_ORIGIN = origin;
    process.env.NODE_ENV = "development";
    const bundle = await build({
      stdin: {
        contents: `export * from ${JSON.stringify(join(source, "generated/api.ts"))};
          export { setBaseUrl } from ${JSON.stringify(join(source, "custom-fetch.ts"))};`,
        resolveDir: source,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const entry = join(dir, "client.mjs");
    await writeFile(entry, bundle.outputFiles![0]!.contents);
    const client = (await import(pathToFileURL(entry).href)) as {
      setBaseUrl: (url: string | null) => void;
      saveReleasedTemplate: (id: string) => Promise<unknown>;
      unsaveTemplate: (templateId: string) => Promise<unknown>;
      createTemplateDraft: (id: string) => Promise<unknown>;
    };
    client.setBaseUrl(origin);
    // A browser names the page's origin on every change it sends; Node's fetch does not.
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      return original(input, { ...init, headers });
    }) as typeof fetch;
    const release = "00000000-0000-4000-8000-00000000a001";
    await client.saveReleasedTemplate(release);
    await client.unsaveTemplate("manual-" + release);
    await client.createTemplateDraft(release);
    assert.deepEqual(reached, [
      "PUT /api/workspace/saved-templates/" + release,
      "DELETE /api/workspace/saved-templates/by-template/manual-" + release,
      "POST /api/workspace/templates/" + release + "/draft",
    ]);
    // The same changes from the same origin with no body, as the client sent them before, are refused
    // before their routes, whether or not they say they are JSON.
    for (const [method, path, headers] of [
      ["PUT", "/api/workspace/saved-templates/" + release, { origin }],
      ["DELETE", "/api/workspace/saved-templates/by-template/manual-" + release, { origin }],
      [
        "DELETE",
        "/api/workspace/saved-templates/by-template/manual-" + release,
        { origin, "content-type": "application/json" },
      ],
    ] as const) {
      const refused = await original(origin + path, { method, headers });
      assert.equal(refused.status, 403, method + " " + path);
      assert.equal(((await refused.json()) as { code: string }).code, "UNTRUSTED_ORIGIN");
    }
    assert.equal(reached.length, 3);
  } finally {
    globalThis.fetch = original;
    if (saved.trusted === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
    else process.env.VALO_TRUSTED_ORIGIN = saved.trusted;
    if (saved.mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.mode;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
