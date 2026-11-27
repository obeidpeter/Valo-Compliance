import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket, type AddressInfo } from "node:net";

test(
  "the shared pool fails a connection wait after its timeout instead of hanging",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 30_000 },
  async (t) => {
    const {
      pool,
      createPool,
      configuredPoolMax,
      DEFAULT_POOL_MAX,
      POOL_ACQUIRE_TIMEOUT_MS,
      POOL_ACQUIRE_TIMEOUT_CODE,
      CONNECT_TIMEOUT_CODE,
    } = await import("@workspace/db");
    try {
      assert.equal(pool.options.connectionTimeoutMillis, POOL_ACQUIRE_TIMEOUT_MS);
      assert.ok(POOL_ACQUIRE_TIMEOUT_MS > 0);
      assert.equal(configuredPoolMax(undefined), DEFAULT_POOL_MAX);
      assert.equal(configuredPoolMax("16"), 16);
      assert.throws(() => configuredPoolMax("0"), /INVALID_DB_POOL_MAX/);
      assert.throws(() => configuredPoolMax("101"), /INVALID_DB_POOL_MAX/);
      assert.throws(() => configuredPoolMax("10 "), /INVALID_DB_POOL_MAX/);

      await t.test("a full pool refuses a waiting caller with a code, then serves again", async () => {
        // Same configuration as the shared pool, scaled down so the test is quick.
        const small = createPool({ max: 1, connectionTimeoutMillis: 200 });
        try {
          const held = await small.connect();
          try {
            const started = Date.now();
            await assert.rejects(small.connect(), { code: POOL_ACQUIRE_TIMEOUT_CODE });
            await assert.rejects(small.query("select 1"), { code: POOL_ACQUIRE_TIMEOUT_CODE });
            assert.ok(Date.now() - started < 5000, "the waits ended at the timeout");
          } finally {
            held.release();
          }
          assert.equal((await small.query("select 1 as ok")).rows[0].ok, 1);
        } finally {
          await small.end();
        }
      });

      await t.test("a database that never answers fails the connection attempt with a code", async () => {
        const sockets = new Set<Socket>();
        // Accepts connections and never replies, like a database that has stopped responding.
        const silent = createServer((socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
        });
        await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
        const { port } = silent.address() as AddressInfo;
        const unreachable = createPool({
          connectionString: `postgresql://synthetic-pool-probe@127.0.0.1:${port}/none`,
          max: 1,
          connectionTimeoutMillis: 200,
        });
        try {
          await assert.rejects(unreachable.connect(), { code: CONNECT_TIMEOUT_CODE });
        } finally {
          await unreachable.end();
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((resolve) => silent.close(() => resolve()));
        }
      });
    } finally {
      await pool.end();
    }
  },
);
