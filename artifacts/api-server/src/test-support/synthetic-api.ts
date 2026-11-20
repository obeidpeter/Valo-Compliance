import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

/** One answer: an HTTP status and a JSON body, sent after an optional delay. */
export type SyntheticAnswer = { status: number; body: unknown; delayMs?: number };

/** What one request to the synthetic API carried. */
export type SyntheticRequest = {
  method: string;
  path: string;
  search: string;
  cookie: string | undefined;
  authorization: string | undefined;
  forwardedFor: string | undefined;
};

/**
 * A synthetic API for the checks that run the compiled web app (decision 0011): an HTTP server on
 * this machine's loopback address that the web server is pointed at with VALO_API_INTERNAL_ORIGIN.
 * It answers /api/... requests from the test's own function, with the same contract-checked
 * synthetic data the in-page routes give the browser, and records what every request carried. A
 * request it has no answer for gets 404 and is listed in `unknown`. It never reaches a database, a
 * provider or a real API.
 */
export async function startSyntheticApi(
  answer: (method: string, url: URL) => SyntheticAnswer | undefined | Promise<SyntheticAnswer | undefined>,
) {
  const requests: SyntheticRequest[] = [];
  const unknown = new Set<string>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://synthetic-api.invalid");
    const method = req.method ?? "GET";
    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
      forwardedFor: req.headers["x-forwarded-for"] as string | undefined,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      const found = url.pathname.startsWith("/api/") ? await answer(method, url) : undefined;
      if (!found) {
        unknown.add(`${method} ${url.pathname}`);
        send(404, { error: "Not found" });
        return;
      }
      if (found.delayMs) await delay(found.delayMs);
      send(found.status, found.body);
    })().catch((error: unknown) => {
      // A broken test answer is a test failure: report it as a server error the page must survive.
      unknown.add(`${method} ${url.pathname} (answer threw: ${String(error)})`);
      if (!res.headersSent) send(500, { error: "Synthetic answer failed" });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    unknown,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
