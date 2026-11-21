import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { GetBuildStatusResponse } from "@workspace/api-zod";
import {
  apiOrigin,
  isPublicPath,
  MAX_ANSWER_BYTES,
  READ_TIMEOUT_MS,
  readPublic,
  segment,
} from "./public-api";

/**
 * Decision 0011, point 3: the web server reads the public API as an anonymous visitor, from an
 * address only configuration chooses, and every answer is schema-checked, bounded in size and time,
 * and never followed through a redirect. A synthetic API on this machine's loopback address answers.
 */
const status = {
  receivedRequirements: 127,
  expectedRequirements: 127,
  publishedTemplates: 0,
  p0Passed: false,
  r2Unlocked: false,
  livePaymentsEnabled: false,
  notice: "Synthetic test fixture.",
};
const seen: { path: string; headers: IncomingHttpHeaders }[] = [];
let server: Server;
let env: NodeJS.ProcessEnv;

before(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "";
    seen.push({ path, headers: req.headers });
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (path === "/api/public/status") json(200, status);
    else if (path === "/api/public/status-wrong-shape") json(200, { ...status, p0Passed: "no" });
    else if (path === "/api/public/not-json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json</html>");
    } else if (path === "/api/public/missing") json(404, { error: "Not found" });
    else if (path === "/api/public/limited") json(429, { error: "Request limit reached." });
    else if (path === "/api/public/broken") json(500, { error: "Internal error" });
    else if (path === "/api/public/moved") {
      res.writeHead(302, { location: "/api/public/redirect-target" });
      res.end();
    } else if (path === "/api/public/redirect-target") json(200, status);
    else if (path === "/api/public/padded-streamed") {
      // A valid answer padded with whitespace, which JSON allows, past the cap and chunked with no
      // declared length: the cap has to count the bytes as they arrive.
      res.writeHead(200, { "content-type": "application/json" });
      res.write(JSON.stringify(status));
      const chunk = " ".repeat(64 * 1024);
      let sent = 0;
      const more = () => {
        while (sent <= MAX_ANSWER_BYTES) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", more);
        }
        res.end();
      };
      more();
    } else if (path.startsWith("/api/public/padded-")) {
      // The same valid answer padded to a total size in bytes, with that length declared: only the
      // size cap can refuse it.
      const total = Number(path.slice("/api/public/padded-".length));
      const body = JSON.stringify(status).padEnd(total, " ");
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
    } else if (path === "/api/public/silent") {
      // Never answers; the client must give up on its own.
    } else json(404, { error: "Not found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  env = { NODE_ENV: "production", VALO_API_INTERNAL_ORIGIN: `http://127.0.0.1:${port}` };
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const hits = (path: string) => seen.filter((request) => request.path === path);

test("the web server reads the public API as an anonymous visitor and passes on the X-Forwarded-For it received unchanged", async () => {
  const forwardedFor = "203.0.113.7, 198.51.100.2";
  const read = await readPublic("/public/status", GetBuildStatusResponse, { env, forwardedFor });
  assert.deepEqual(read, { ok: true, data: status });
  const request = hits("/api/public/status").at(-1)!;
  assert.equal(request.headers.cookie, undefined, "no cookie");
  assert.equal(request.headers.authorization, undefined, "no Authorization header");
  assert.equal(request.headers["x-forwarded-for"], forwardedFor);
  assert.equal(request.headers.accept, "application/json");

  // A value that is not a list of addresses is not passed on at all.
  for (const unusable of ["synthetic-visitor", "203.0.113.7; rm", "x".repeat(600)]) {
    await readPublic("/public/status", GetBuildStatusResponse, { env, forwardedFor: unusable });
    assert.equal(hits("/api/public/status").at(-1)!.headers["x-forwarded-for"], undefined, unusable);
  }
});

test("an answer the contract's schema rejects, or that is not JSON, is a failure, not data", async () => {
  assert.deepEqual(await readPublic("/public/status-wrong-shape", GetBuildStatusResponse, { env }), {
    ok: false,
    reason: "failed",
  });
  assert.deepEqual(await readPublic("/public/not-json", GetBuildStatusResponse, { env }), {
    ok: false,
    reason: "failed",
  });
});

test("not found, a refusal and a server error are reported, never thrown", async () => {
  const reasons = [];
  for (const path of ["/public/missing", "/public/limited", "/public/broken"])
    reasons.push(await readPublic(path, GetBuildStatusResponse, { env }));
  assert.deepEqual(reasons, [
    { ok: false, reason: "not-found" },
    { ok: false, reason: "refused" },
    { ok: false, reason: "failed" },
  ]);
});

test("a redirect is refused and never followed", async () => {
  assert.deepEqual(await readPublic("/public/moved", GetBuildStatusResponse, { env }), {
    ok: false,
    reason: "failed",
  });
  assert.equal(hits("/api/public/redirect-target").length, 0, "the redirect's target was never requested");
});

test("an answer over the size cap is refused, whether its length is declared or streamed", async () => {
  // The same valid answer just under the cap is read, so only its size refuses the others.
  assert.deepEqual(await readPublic(`/public/padded-${MAX_ANSWER_BYTES}`, GetBuildStatusResponse, { env }), {
    ok: true,
    data: status,
  });
  for (const path of [`/public/padded-${MAX_ANSWER_BYTES + 1}`, "/public/padded-streamed"])
    assert.deepEqual(
      await readPublic(path, GetBuildStatusResponse, { env }),
      { ok: false, reason: "failed" },
      path,
    );
});

test("a read gives up after the time limit", async () => {
  const started = performance.now();
  const read = await readPublic("/public/silent", GetBuildStatusResponse, { env });
  const took = performance.now() - started;
  assert.deepEqual(read, { ok: false, reason: "failed" });
  assert.ok(took >= READ_TIMEOUT_MS - 50 && took < READ_TIMEOUT_MS + 1000, `gave up after ${took} ms`);
});

test("only configuration chooses the API's address, and a set but unusable address is refused, not replaced", async () => {
  const production = { NODE_ENV: "production" } as const;
  assert.equal(
    apiOrigin({ ...production, VALO_API_INTERNAL_ORIGIN: "https://api.example.test" }),
    "https://api.example.test",
  );
  for (const loopback of ["http://127.0.0.1:8080", "http://localhost:8080", "http://[::1]:8080"])
    assert.equal(apiOrigin({ ...production, VALO_API_INTERNAL_ORIGIN: loopback }), loopback);
  for (const unusable of [
    "http://api.example.test",
    "http://10.0.0.5:8080",
    "https://u:p@api.example.test",
    "https://api.example.test/api",
    "https://api.example.test/?x=1",
    "ftp://api.example.test",
    "not a url",
  ])
    assert.equal(
      apiOrigin({
        ...production,
        VALO_API_INTERNAL_ORIGIN: unusable,
        VALO_TRUSTED_ORIGIN: "https://example.test",
      }),
      null,
      unusable,
    );
  // Plain http beyond the loopback address is a development convenience only.
  assert.equal(
    apiOrigin({ NODE_ENV: "development", VALO_API_INTERNAL_ORIGIN: "http://api.example.test" }),
    "http://api.example.test",
  );
  // Without it, the configured public origin, which serves the API under /api.
  assert.equal(
    apiOrigin({ ...production, VALO_TRUSTED_ORIGIN: "https://example.test" }),
    "https://example.test",
  );
  assert.equal(apiOrigin({ ...production, REPLIT_DEV_DOMAIN: "untrusted.example" }), null);
  assert.equal(
    apiOrigin({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "dev.example.test" }),
    "https://dev.example.test",
  );

  const before = seen.length;
  assert.deepEqual(await readPublic("/public/status", GetBuildStatusResponse, { env: production }), {
    ok: false,
    reason: "unconfigured",
  });
  assert.equal(seen.length, before, "nothing was requested without a configured address");
});

test("only public endpoint paths are read, and any slug from the address makes one", async () => {
  for (const path of [
    "/public/status",
    "/public/templates/synthetic-template-1",
    "/public/catalogue?q=a+b&page=2",
  ])
    assert.ok(isPublicPath(path), path);
  for (const path of [
    "/workspace",
    "/public",
    "/public/",
    "//evil.example/public/status",
    "/public//status",
    "/public/../workspace",
    "/public/./status",
    "/public/status#x",
    "/public/status?a=b?c",
    "/publicity",
  ]) {
    assert.ok(!isPublicPath(path), path);
    await assert.rejects(readPublic(path, GetBuildStatusResponse, { env }), /PUBLIC_API_PATH_INVALID/);
  }
  for (const slug of ["..", ".", "../workspace", "a/b", "x?y", "x#y", "(a)*!'", "%2e%2e", "naïve slug", ""]) {
    const path = `/public/templates/${segment(slug)}`;
    assert.ok(isPublicPath(path), `${JSON.stringify(slug)} → ${path}`);
    assert.equal(decodeURIComponent(segment(slug)), slug || " ");
  }
});
