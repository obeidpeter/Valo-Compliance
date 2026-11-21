import test from "node:test";
import assert from "node:assert/strict";
import { guardNestedConnections } from "./nested-connection-guard";

test("only connections taken while a transaction holds one are recorded", async () => {
  const pool = {
    connect: async () => ({ release() {} }),
    query: async (_text: string) => ({ rows: [] }),
  };
  // Shaped like drizzle: the transaction takes its connection, then runs the callback.
  const db = {
    transaction: async <T>(run: (tx: { query: () => Promise<void> }) => Promise<T>) => {
      await pool.connect();
      return run({ query: async () => undefined });
    },
  };
  const originals = { transaction: db.transaction, connect: pool.connect, query: pool.query };
  const guard = guardNestedConnections({ db, pool });
  try {
    await pool.query("before any transaction");
    await db.transaction(async (tx) => tx.query());
    await db.transaction(async () => {
      await pool.query("a second connection while holding the first");
    });
    await db.transaction(async () => {
      await db.transaction(async () => undefined);
    });
    // Another flow may use the pool while a transaction is open elsewhere.
    let release!: () => void, entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const open = db.transaction(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          entered();
        }),
    );
    await inside;
    await pool.query("concurrent flow without a transaction");
    release();
    await open;
    await pool.query("after the transaction");
    assert.equal(guard.violations.length, 2, guard.violations.join("\n"));
    assert.match(
      guard.violations[0]!,
      /^pool\.query inside the transaction opened\n.*nested-connection-guard\.test\.ts/s,
    );
    assert.match(guard.violations[1]!, /^db\.transaction inside the transaction opened/);
  } finally {
    guard.restore();
  }
  assert.equal(db.transaction, originals.transaction);
  assert.equal(pool.connect, originals.connect);
  assert.equal(pool.query, originals.query);
});

test("a transaction opened with BEGIN on a pooled connection holds it until it ends", async () => {
  // Shaped like pg: each checkout gets its own release, and Pool#query takes a connection of
  // its own through connect() and runs one statement on it.
  const statements: string[] = [];
  class Client {
    query(text: string | { text: string }) {
      statements.push(typeof text === "string" ? text : text.text);
      return Promise.resolve({ rows: [] });
    }
    release = () => {};
  }
  const idle: Client[] = [new Client(), new Client(), new Client()];
  type Checkout = (error: Error | undefined, client: Client, done: () => void) => void;
  const checkout = () => {
    const client = idle.shift() ?? new Client();
    client.release = () => {
      idle.push(client);
    };
    return client;
  };
  const pool = {
    connect(callback?: Checkout): Promise<Client> {
      const client = checkout();
      if (!callback) return Promise.resolve(client);
      callback(undefined, client, client.release);
      return Promise.resolve(client);
    },
    async query(text: string) {
      const { client, done } = await new Promise<{ client: Client; done: () => void }>((resolve) => {
        void pool.connect((_error, client, done) => resolve({ client, done }));
      });
      try {
        return await client.query(text);
      } finally {
        done();
      }
    },
  };
  const db = {
    transaction: async <T>(run: (tx: Client) => Promise<T>) => {
      const client = (await pool.connect()) as Client;
      await client.query("begin");
      try {
        return await run(client);
      } finally {
        await client.query("commit");
        client.release();
      }
    },
  };
  // These transactions stand for application code, so the test's own frames count as such here.
  const guard = guardNestedConnections({ db, pool }, { testFrame: () => false });
  const raw = async (body: (client: Client) => Promise<void>, end = "COMMIT") => {
    const client = (await pool.connect()) as Client;
    try {
      await client.query("BEGIN");
      await body(client);
      if (end) await client.query(end);
    } finally {
      client.release();
    }
  };
  try {
    // Its own statements, and the pool after it ends, are fine.
    await raw(async (client) => {
      await client.query("SELECT 1");
      await client.query("SAVEPOINT s");
      await client.query("ROLLBACK TO SAVEPOINT s");
    });
    await pool.query("after a committed transaction");
    // A pooled query while it is open is recorded, also after a rollback to a savepoint.
    await raw(async (client) => {
      await client.query("SAVEPOINT s");
      await client.query({ text: "ROLLBACK TO s" });
      await pool.query("a second connection while holding the first");
    }, "ROLLBACK");
    // A connection taken while it is open is recorded too; one released without COMMIT ends it.
    await raw(async () => {
      (await pool.connect()).release();
    }, "");
    await pool.query("after a released transaction");
    // A callee that issues BEGIN before its first await, on a connection its caller lent it,
    // leaves the caller holding nothing once its transaction ends.
    const inspect = async (client: Client) => {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT 1");
      await client.query("ROLLBACK");
    };
    const lent = (await pool.connect()) as Client;
    await inspect(lent);
    await pool.query("after the callee's transaction");
    lent.release();
    // A raw transaction inside db.transaction restores the outer one when it ends.
    await db.transaction(async () => {
      await raw(async () => undefined);
      await pool.query("still inside the outer transaction");
    });
    // Neither drizzle's own BEGIN nor the pool's single-query connection opens one.
    await db.transaction(async (tx) => {
      await tx.query("SELECT 1");
    });
    await pool.query("BEGIN");
    await pool.query("after a stray single-query BEGIN");
    // Another flow may use the pool while a transaction is open elsewhere.
    let release!: () => void, entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const open = raw(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          entered();
        }),
    );
    await inside;
    await pool.query("concurrent flow without a transaction");
    release();
    await open;
    assert.deepEqual(
      guard.records.map((r) => [r.kind, r.transaction]),
      [
        ["pool.query", "BEGIN"],
        ["pool.connect", "BEGIN"],
        ["pool.connect", "db.transaction"],
        ["pool.query", "db.transaction"],
      ],
      guard.violations.join("\n"),
    );
    assert.match(
      guard.violations[0]!,
      /^pool\.query inside the transaction opened with BEGIN\n.*nested-connection-guard\.test\.ts/s,
    );
    assert.ok(statements.includes("ROLLBACK TO s"));
  } finally {
    guard.restore();
  }
  assert.equal(idle.length, 3, "every connection went back to the pool");
  assert.ok(idle.every((client) => !Object.prototype.hasOwnProperty.call(client, "query")));
});

test("a guard installed over another sees what the other sees, and restores it", async () => {
  // As when a test guards its own run under the CI preload's guard.
  class Client {
    query(_text: string) {
      return Promise.resolve({ rows: [] });
    }
    release = () => {};
  }
  const client = new Client();
  const pool = {
    connect: async () => {
      client.release = () => undefined;
      return client;
    },
    query: async (_text: string) => ({ rows: [] }),
  };
  const db = { transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(undefined) };
  const outer = guardNestedConnections({ db, pool }, { testFrame: () => false });
  const inner = guardNestedConnections({ db, pool }, { testFrame: () => false });
  const open = async () => {
    const c = await pool.connect();
    await c.query("BEGIN");
    await pool.query("a second connection while holding the first");
    await c.query("COMMIT");
    c.release();
  };
  try {
    await open();
    inner.restore();
    await open();
  } finally {
    outer.restore();
  }
  assert.equal(inner.records.length, 1);
  assert.equal(outer.records.length, 2);
  assert.ok([...inner.records, ...outer.records].every((r) => r.transaction === "BEGIN"));
  assert.ok(!Object.prototype.hasOwnProperty.call(client, "query"));
});

test("a transaction a test opens itself stands for another session and is not watched", async () => {
  // As when a test holds a row lock while the code under test runs and waits for it.
  class Client {
    query(_text: string) {
      return Promise.resolve({ rows: [] });
    }
    release = () => {};
  }
  const pool = {
    connect: async () => {
      const client = new Client();
      client.release = () => undefined;
      return client;
    },
    query: async (_text: string) => ({ rows: [] }),
  };
  const db = { transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(undefined) };
  const guard = guardNestedConnections({ db, pool });
  try {
    const session = await pool.connect();
    await session.query("BEGIN");
    await session.query("SELECT id FROM synthetic_rows WHERE id=$1 FOR UPDATE");
    await db.transaction(async () => undefined);
    await pool.query("the code under test, waiting for the lock");
    await session.query("COMMIT");
    session.release();
  } finally {
    guard.restore();
  }
  assert.deepEqual(guard.records, []);
});
