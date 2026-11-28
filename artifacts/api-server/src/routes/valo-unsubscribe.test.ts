import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";

/**
 * The unsubscribe routes' answer to what is not a link Valo signed (docs/architecture/messages.md,
 * part 4), with no database: the address of one here leads nowhere, so an answer of "refused" shows
 * that none was asked. What a real link does is the database test's to show
 * (valo-unsubscribe.integration.test.ts). Every key and value here is synthetic.
 */
test("what is not a link Valo signed is refused before any database is asked, and the refusal's log line holds nothing of the request", async () => {
  const before = { database: process.env.DATABASE_URL, secret: process.env.SESSION_SECRET };
  // The routes load the database client; nothing here may reach it.
  process.env.DATABASE_URL = "postgresql://unused@127.0.0.1:1/unused";
  process.env.SESSION_SECRET ??= "synthetic-session-secret-for-the-unsubscribe-routes";
  const { oneClickUnsubscribeRouter } = await import("./valo-unsubscribe");
  const lines: [string, unknown][] = [];
  const app = express();
  app.use((req, _res, next) => {
    // The request's logger, as the API's logging gives one to each request.
    Object.assign(req, {
      log: {
        info: (line: unknown) => lines.push(["info", line]),
        warn: (line: unknown) => lines.push(["warn", line]),
      },
    });
    next();
  });
  app.use(oneClickUnsubscribeRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const marker = "synthetic-marker-4f1d";
    const notLinks = [
      marker,
      `${marker}.aaaa.bbbb`,
      // Shaped as a link is, under a key's name the keyring does not hold.
      `${marker}.${"A".repeat(56)}.${"A".repeat(43)}`,
      "",
    ];
    for (const each of notLinks) {
      lines.length = 0;
      const answer = await fetch(`${base}/api/public/unsubscribe/one-click?t=${encodeURIComponent(each)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `synthetic=${marker}` },
        body: `List-Unsubscribe=One-Click&also=${marker}`,
      });
      assert.equal(answer.status, 400, each);
      assert.match(answer.headers.get("Cache-Control") ?? "", /no-store/);
      assert.deepEqual(await answer.json(), {
        error:
          "This link does not work. It may be incomplete, or older than Valo still accepts. Nothing was changed.",
      });
      // One line, which says that a link was refused and holds nothing else.
      assert.deepEqual(lines, [["info", { event: "unsubscribe.refused" }]], each);
    }
    // No token at all, and a token given twice: neither is read as one.
    for (const address of [
      "/api/public/unsubscribe/one-click",
      "/api/public/unsubscribe/one-click?t=a&t=b",
    ]) {
      lines.length = 0;
      const answer = await fetch(base + address, { method: "POST" });
      assert.equal(answer.status, 400, address);
      assert.deepEqual(lines, [["info", { event: "unsubscribe.refused" }]], address);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (before.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before.database;
    if (before.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = before.secret;
  }
});
