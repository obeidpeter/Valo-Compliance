import assert from "node:assert/strict";
import test from "node:test";
import { API_READS, PAGES, localOrigin, parseOptions, summarise, webServerKind } from "./site-timings";

test("the site timings command only ever times this machine's own servers", () => {
  for (const origin of [
    "http://127.0.0.1:8080",
    "http://localhost:20147",
    "http://[::1]:8080",
    "https://127.0.0.9",
  ])
    assert.equal(localOrigin(origin), new URL(origin).origin);
  for (const elsewhere of [
    "https://example-workspace.replit.dev",
    "http://10.0.0.5:8080",
    "http://127.0.0.1.example:8080",
    "http://user:secret@127.0.0.1:8080",
    "http://127.0.0.1:8080/api",
    "file:///etc/passwd",
    "not an address",
  ])
    assert.throws(() => localOrigin(elsewhere), elsewhere);
  assert.deepEqual(parseOptions([], { api: "8181", web: "3100" }), {
    api: "http://127.0.0.1:8181",
    web: "http://127.0.0.1:3100",
    rounds: 3,
  });
  assert.deepEqual(parseOptions(["--rounds=1", "--web=http://localhost:3000"]), {
    api: "http://127.0.0.1:8080",
    web: "http://localhost:3000",
    rounds: 1,
  });
  // A round is about 13 anonymous reads; more than three would pass the 60-a-minute limit.
  for (const wrong of [
    "--rounds=0",
    "--rounds=4",
    "--rounds=two",
    "--api=https://valo.example",
    "--cookie=x",
  ])
    assert.throws(() => parseOptions([wrong]), wrong);
  assert.ok(API_READS.every((path) => path.startsWith("/api/public/")));
  assert.deepEqual(PAGES, ["/", "/library", "/compliance", "/resources", "/industries", "/pricing", "/help"]);
});

test("the site timings command reports the fastest, median and slowest time and counts the answers", () => {
  assert.deepEqual(
    summarise([
      { ms: 30, status: 200 },
      { ms: 10, status: 200 },
      { ms: 20, status: 429 },
    ]),
    { fastest: 10, median: 20, slowest: 30, answers: "200 ×2, 429 ×1" },
  );
  assert.equal(
    summarise([
      { ms: 10, status: 200 },
      { ms: 30, status: "no answer" },
    ]).median,
    20,
  );
});

test("the site timings command tells the compiled build from the development server by the page they send", () => {
  assert.equal(
    webServerKind('<script src="/_next/static/chunks/webpack.js?v=1763900000000" async=""></script>'),
    "development server",
  );
  assert.equal(
    webServerKind('<script src="/_next/static/chunks/webpack-7e3b5d4f1a2c9b80.js" async=""></script>'),
    "compiled build",
  );
  assert.equal(webServerKind("<p>The site is starting</p>"), "unknown");
});
