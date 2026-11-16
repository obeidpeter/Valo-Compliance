import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { configureProxyBoundary, clientAddress, trustedProxyRanges } from "./valo-proxy-boundary";

test("proxy configuration rejects hop counts, names and universal networks", () => {
  assert.deepEqual(trustedProxyRanges(undefined), []);
  assert.deepEqual(trustedProxyRanges("127.0.0.1/32,::1/128"), ["127.0.0.1/32", "::1/128"]);
  for (const raw of [
    "true",
    "1",
    "loopback",
    "uniquelocal",
    "0.0.0.0/0",
    "::/0",
    "127.0.0.1/33",
    "::1/129",
    "127.0.0.1,",
    "127.0.0.1/1/2",
    "bad.invalid",
    Array(17).fill("127.0.0.1").join(","),
  ])
    assert.throws(() => trustedProxyRanges(raw));
});
test("real HTTP walks only explicitly trusted proxies and stops before forged client prefixes", async () => {
  for (const [ranges, expected] of [
    [undefined, "127.0.0.1"],
    ["127.0.0.1/32", "198.51.100.7"],
    ["127.0.0.1/32,198.51.100.7/32", "203.0.113.8"],
  ] as const) {
    const app = express();
    configureProxyBoundary(app, { VALO_TRUSTED_PROXY_CIDRS: ranges });
    app.get("/", (req, res) => res.json({ address: clientAddress(req) }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
    try {
      const result = await fetch(url, {
        headers: {
          "x-forwarded-for": "192.0.2.99, 203.0.113.8, 198.51.100.7",
          "x-real-ip": "192.0.2.98",
          forwarded: "for=192.0.2.97",
        },
      });
      assert.equal(((await result.json()) as { address: string }).address, expected);
      assert.equal(((await (await fetch(url)).json()) as { address: string }).address, "127.0.0.1");
      assert.equal(
        (
          (await (await fetch(url, { headers: { "x-forwarded-for": "not-an-ip" } })).json()) as {
            address: string;
          }
        ).address,
        "127.0.0.1",
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
});
