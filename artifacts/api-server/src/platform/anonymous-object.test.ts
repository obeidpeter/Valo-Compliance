import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { STORAGE_ORIGIN, anonymousObjectStatus } from "./anonymous-object";

const src = resolve(import.meta.dirname, "..");

test("an anonymous probe of a private object reports a redirect as its answer and never follows it (SEC-002)", async () => {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? "");
    if (req.url?.startsWith("/synthetic-bucket/")) {
      res.writeHead(req.url.endsWith("denied.json") ? 403 : 302, { location: "/elsewhere" });
      res.end();
    } else {
      // Where a redirect would lead: a public answer the probe must never report.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("public");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal(await anonymousObjectStatus("synthetic-bucket", "private/a b.json", origin), 302);
    assert.equal(await anonymousObjectStatus("synthetic-bucket", "private/denied.json", origin), 403);
    // Each part of the name is encoded on its own, and nothing else was asked for.
    assert.deepEqual(asked, [
      "/synthetic-bucket/private/a%20b.json",
      "/synthetic-bucket/private/denied.json",
    ]);
  } finally {
    server.close();
  }
});

test("only the anonymous probe addresses the storage service directly", () => {
  const files = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const full = join(directory, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  const addressing = files(src)
    .filter((file) => readFileSync(file, "utf8").includes(new URL(STORAGE_ORIGIN).host))
    .map((file) => relative(src, file));
  assert.deepEqual(addressing, ["platform/anonymous-object.ts"]);
});
