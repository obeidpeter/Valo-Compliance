import { AsyncLocalStorage } from "node:async_hooks";

type Flow = { holding: boolean; opened: string };
type Transactional = { transaction: (...args: any[]) => Promise<unknown> };
type Pooled = { connect: (...args: any[]) => unknown; query: (...args: any[]) => unknown };

/**
 * Records every pooled connection taken while the same asynchronous flow already holds
 * a transaction's connection. Such a flow waits for a second connection while keeping
 * the first, so as many concurrent callers as the pool has connections wait forever.
 *
 * Install it on the shared `db` and `pool` from `@workspace/db` before the code under
 * test runs, and call `restore()` afterwards. A transaction's own queries use the
 * connection it already holds, so they are never recorded.
 */
export function guardNestedConnections(database: { db: Transactional; pool: Pooled }) {
  const flow = new AsyncLocalStorage<Flow>();
  const violations: string[] = [];
  // Application frames only. The driver's promise chain drops the code that awaited a
  // query from async traces, so a violation names where its transaction was opened.
  const caller = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const stack = new Error().stack ?? "";
    Error.stackTraceLimit = limit;
    return stack
      .split("\n")
      .slice(1)
      .filter(
        (line) =>
          !line.includes("/nested-connection-guard.ts:") &&
          !line.includes("node:") &&
          !line.includes("node_modules"),
      )
      .slice(0, 4)
      .map((line) => line.trim())
      .join("\n  ");
  };
  const record = (kind: string) => {
    const current = flow.getStore();
    if (current?.holding) violations.push(`${kind} inside the transaction opened\n  ${current.opened}`);
  };
  const { db, pool } = database;
  const transaction = db.transaction,
    connect = pool.connect,
    query = pool.query;
  const own = {
    transaction: Object.prototype.hasOwnProperty.call(db, "transaction"),
    connect: Object.prototype.hasOwnProperty.call(pool, "connect"),
    query: Object.prototype.hasOwnProperty.call(pool, "query"),
  };
  db.transaction = function (this: unknown, run: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) {
    record("db.transaction");
    const current: Flow = { holding: false, opened: caller() };
    return flow.run(current, () =>
      transaction.call(
        db,
        async (tx: unknown) => {
          current.holding = true;
          try {
            return await run(tx);
          } finally {
            current.holding = false;
          }
        },
        ...rest,
      ),
    );
  };
  pool.connect = function (this: unknown, ...args: unknown[]) {
    record("pool.connect");
    return connect.apply(pool, args);
  };
  pool.query = function (this: unknown, ...args: unknown[]) {
    record("pool.query");
    // pg's Pool#query takes its connection through connect(); count the acquisition once.
    return flow.run({ holding: false, opened: "" }, () => query.apply(pool, args));
  };
  return {
    violations,
    restore() {
      if (own.transaction) db.transaction = transaction;
      else delete (db as Partial<Transactional>).transaction;
      if (own.connect) pool.connect = connect;
      else delete (pool as Partial<Pooled>).connect;
      if (own.query) pool.query = query;
      else delete (pool as Partial<Pooled>).query;
    },
  };
}
