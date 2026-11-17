// Plain JavaScript so the CI preload can load it before any TypeScript loader starts.
import { AsyncLocalStorage } from "node:async_hooks";

/** Application frames only: the driver's promise chain drops the code that awaited a
 * query from async traces, so a finding names where its transaction was opened. */
function caller() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  return stack
    .split("\n")
    .slice(1)
    .filter(
      (line) =>
        !line.includes("/nested-connection-guard-core.mjs:") &&
        !line.includes("node:") &&
        !line.includes("node_modules"),
    )
    .slice(0, 4)
    .map((line) => line.trim());
}

/** See nested-connection-guard-core.d.mts. */
export function guardNestedConnections(database) {
  const flow = new AsyncLocalStorage();
  const records = [];
  const violations = [];
  const record = (kind) => {
    const current = flow.getStore();
    if (!current?.holding) return;
    records.push({ kind, opened: current.opened });
    violations.push(`${kind} inside the transaction opened\n  ${current.opened.join("\n  ")}`);
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
  db.transaction = function (run, ...rest) {
    record("db.transaction");
    const current = { holding: false, opened: caller() };
    return flow.run(current, () =>
      transaction.call(
        db,
        async (tx) => {
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
  pool.connect = function (...args) {
    record("pool.connect");
    return connect.apply(pool, args);
  };
  pool.query = function (...args) {
    record("pool.query");
    // pg's Pool#query takes its connection through connect(); count the acquisition once.
    return flow.run({ holding: false, opened: [] }, () => query.apply(pool, args));
  };
  return {
    violations,
    records,
    restore() {
      if (own.transaction) db.transaction = transaction;
      else delete db.transaction;
      if (own.connect) pool.connect = connect;
      else delete pool.connect;
      if (own.query) pool.query = query;
      else delete pool.query;
    },
  };
}
