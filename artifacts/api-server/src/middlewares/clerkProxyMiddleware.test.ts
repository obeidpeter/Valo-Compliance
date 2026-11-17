import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { CLERK_PROXY_PATH, clerkProxy } from "./clerkProxyMiddleware";

type Seen = {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
};
type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
};
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

function send(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** A stand-in for Clerk's Frontend API that records what reaches it. */
function frontendApi(seen: Seen[]) {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url?.startsWith("/v1/sized")) {
        res.writeHead(200, { "content-type": "text/plain", "content-length": "5" });
        res.end("sized");
      } else if (req.url?.startsWith("/v1/streamed")) {
        // No Content-Length: Node sends it chunked, as Clerk's dynamic responses arrive.
        res.writeHead(200, { "content-type": "application/json", "keep-alive": "timeout=99" });
        res.write('{"a":');
        res.end("1}");
      } else if (req.url?.startsWith("/v1/empty")) {
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404, { "content-length": "0" });
        res.end();
      }
    });
  });
}

const siteOrigin = "https://valo.example";
const secretKey = "synthetic-proxy-key";

test("the Clerk proxy forwards only what Clerk should see and returns responses the edge accepts", async (t) => {
  const seen: Seen[] = [];
  const upstream = frontendApi(seen);
  const upstreamPort = await listen(upstream);
  const app = express();
  app.use(
    CLERK_PROXY_PATH,
    clerkProxy({ target: `http://127.0.0.1:${upstreamPort}`, secretKey, siteOrigin }),
  );
  const server = createServer(app);
  const port = await listen(server);
  try {
    await t.test("a request reaches the Frontend API path with Clerk's headers only", async () => {
      const reply = await send(port, `${CLERK_PROXY_PATH}/v1/sized?_clerk_js_version=5`, {
        method: "POST",
        body: "synthetic-body",
        headers: {
          "content-type": "text/plain",
          cookie: "__client_uat=1",
          forwarded: "for=203.0.113.9;host=attacker.example",
          "x-real-ip": "203.0.113.9",
          "x-forwarded-for": "203.0.113.9",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "8443",
        },
      });
      assert.deepEqual([reply.status, reply.body, reply.headers["content-length"]], [200, "sized", "5"]);
      const [request] = seen.splice(0);
      assert.equal(request!.method, "POST");
      assert.equal(request!.url, "/v1/sized?_clerk_js_version=5");
      assert.equal(request!.body, "synthetic-body");
      assert.equal(request!.headers.host, `127.0.0.1:${upstreamPort}`, "the Host is the Frontend API's");
      assert.equal(request!.headers.cookie, "__client_uat=1");
      assert.equal(request!.headers["clerk-proxy-url"], `${siteOrigin}${CLERK_PROXY_PATH}`);
      assert.equal(request!.headers["clerk-secret-key"], secretKey);
      // Forwarding headers come from the server's configuration and socket, never the client.
      assert.equal(request!.headers["x-forwarded-host"], "valo.example");
      assert.equal(request!.headers["x-forwarded-proto"], "https");
      assert.equal(request!.headers["x-forwarded-for"], "127.0.0.1");
      for (const header of ["forwarded", "x-real-ip", "x-forwarded-port"])
        assert.equal(request!.headers[header], undefined, header);
    });

    await t.test("a response without a length is re-sent with one and no hop-by-hop headers", async () => {
      const reply = await send(port, `${CLERK_PROXY_PATH}/v1/streamed`);
      assert.equal(reply.status, 200);
      assert.equal(reply.body, '{"a":1}');
      assert.equal(reply.headers["content-length"], "7");
      assert.equal(reply.headers["transfer-encoding"], undefined);
      // Node adds its own Keep-Alive to persistent connections; the Frontend API's is dropped.
      assert.notEqual(reply.headers["keep-alive"], "timeout=99");
      seen.splice(0);
    });

    await t.test("a response with no body carries no length", async () => {
      const reply = await send(port, `${CLERK_PROXY_PATH}/v1/empty`);
      assert.equal(reply.status, 204);
      assert.equal(reply.headers["content-length"], undefined);
      seen.splice(0);
    });
  } finally {
    await close(server);
    await close(upstream);
  }
});

test("an unreachable Frontend API answers an empty 502 with a length and no detail", async () => {
  const unused = createServer();
  const closedPort = await listen(unused);
  await close(unused);
  const app = express();
  app.use(CLERK_PROXY_PATH, clerkProxy({ target: `http://127.0.0.1:${closedPort}`, secretKey, siteOrigin }));
  const server = createServer(app);
  const port = await listen(server);
  try {
    const reply = await send(port, `${CLERK_PROXY_PATH}/v1/client`);
    assert.equal(reply.status, 502);
    assert.equal(reply.headers["content-length"], "0");
    assert.equal(reply.body, "");
  } finally {
    await close(server);
  }
});
