import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startApp } from "./app-in-browser";

/**
 * The browser tests answer each API call a page makes through `startApp`, and several pass the call
 * to a real server first: they fetch its answer, then hand it to the page. A test that closed its
 * page between those two steps left the browser without the answer it was asked to hand over. The
 * harness then answered the request a second time, which is an error, and nothing caught it: the
 * error failed whichever test was running, with "Route is already handled!" and no word of the cause.
 *
 * It was seen once, in the stored-markup test of the postgres job, on a run of a change that touched
 * neither. This test closes pages at that instant.
 */
test("a page closed while its answers are on their way fails no test, an answer that fails on an open page is named in the page's unanswered requests, and a request with no answer gets the harness's own", async () => {
  const real = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json").end(JSON.stringify({ from: request.url }));
  });
  real.listen(0, "127.0.0.1");
  await once(real, "listening");
  const address = real.address();
  assert.ok(address && typeof address !== "string");
  const server = `http://127.0.0.1:${address.port}`;
  const app = await startApp("signed-in");
  const unhandled: string[] = [];
  const note = (error: unknown) => unhandled.push(String(error));
  process.on("unhandledRejection", note);
  try {
    // An open page: one request the test has no answer for, one whose answer fails after it began,
    // and one answered through the real server.
    const open = await app.desktop("/workspace", async (route, _method, path) => {
      if (path === "/none") throw Error("no answer for this one");
      if (path === "/twice") {
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"first":true}' });
        throw Error("the answer failed after it began");
      }
      if (path === "/through") return route.fulfill({ response: await route.fetch({ url: server + path }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    // A request the harness leaves hanging ends here after ten seconds, so that this test fails
    // where it stands.
    const ask = (path: string) =>
      open.page.evaluate(async (url) => {
        const reply = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return { status: reply.status, body: await reply.text() };
      }, `/api${path}`);
    assert.deepEqual(await ask("/through"), { status: 200, body: '{"from":"/through"}' });
    open.unknown.length = 0;
    assert.deepEqual(await ask("/none"), { status: 404, body: '{"error":"No test answer"}' });
    assert.deepEqual(open.unknown, ["GET /none: Error: no answer for this one"]);
    // The page has the answer that was given, and the failure that followed is named, not thrown.
    assert.deepEqual(await ask("/twice"), { status: 200, body: '{"first":true}' });
    assert.deepEqual(open.unknown, [
      "GET /none: Error: no answer for this one",
      "GET /twice: Error: the answer failed after it began",
    ]);
    await open.close();

    // Pages closed with answers on their way. Each answer is fetched from the real server, then
    // handed over a moment after the test has begun to close the page: at once, and a little later.
    for (const pause of [0, 1, 5, 25]) {
      const fetched: string[] = [];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const closing = await app.desktop("/workspace", async (route, _method, path) => {
        if (!path.startsWith("/slow"))
          return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        const reply = await route.fetch({ url: server + path });
        fetched.push(path);
        await gate;
        await delay(pause);
        await route.fulfill({ response: reply });
      });
      await closing.page.evaluate(() => {
        for (let i = 0; i < 5; i++)
          fetch(`/api/slow/${i}`).catch(() => {
            // The page is closed before its answer comes: the request ends with it.
          });
      });
      for (let poll = 0; fetched.length < 5 && poll < 100; poll++) await delay(50);
      assert.equal(fetched.length, 5, `pause ${pause}: the five answers were fetched`);
      const closed = closing.close();
      release();
      await closed;
      // Long enough for each answer to be handed over, and for a failure to surface.
      await delay(pause + 400);
      assert.deepEqual(unhandled, [], `pause ${pause}: nothing was left uncaught`);
      // An answer cut off by the test's own close is not a request the test left unanswered.
      assert.deepEqual(closing.unknown, [], `pause ${pause}: the closed page has no unanswered request`);
    }

    // The harness still works afterwards: a new page is answered.
    const after = await app.desktop("/workspace", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"after":true}' }),
    );
    assert.equal(
      await after.page.evaluate(async () => (await fetch("/api/anything")).text()),
      '{"after":true}',
    );
    await after.close();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", note);
    await app.close();
    real.close();
  }
});
