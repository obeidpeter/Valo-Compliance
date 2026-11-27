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

/** A statement that opens a transaction, or ends the one open on its connection. Rolling back to a
 * savepoint ends nothing. */
const OPENS = /^\s*(?:begin|start\s+transaction)\b/i;
const ENDS = /^\s*(?:commit|end|abort|rollback)\b(?!\s+(?:(?:work|transaction)\s+)?to\b)/i;
const statement = (args) => String((typeof args[0] === "string" ? args[0] : args[0]?.text) ?? "");

/** See nested-connection-guard-core.d.mts. */
export function guardNestedConnections(database, { testFrame = (frame) => frame.includes(".test.") } = {}) {
  const flow = new AsyncLocalStorage();
  // Each guard marks the wrappers it installs, so a guard installed over another (a test's own
  // guard under the CI preload) wraps the other's and both see every statement.
  const GUARDED = Symbol("valo.nested-connection-guard");
  const records = [];
  const violations = [];
  // A transaction opened with BEGIN is the state of its connection, from BEGIN until COMMIT,
  // ROLLBACK or release; the flow that issued BEGIN keeps a mark naming the connection. A mark is
  // live only while that transaction is open, so one that reaches the caller (BEGIN issued before
  // the callee's first await) holds nothing once the callee's transaction ends.
  const open = new Map();
  const unwound = (store) => {
    let current = store;
    while (current?.kind === "BEGIN" && !open.has(current.client)) current = current.previous;
    return current;
  };
  const holding = (store) => {
    const current = unwound(store);
    if (!current || current.single) return null;
    if (current.kind === "BEGIN") return { kind: "BEGIN", opened: open.get(current.client) };
    return current.kind === "db.transaction" && current.holding
      ? { kind: "db.transaction", opened: current.opened }
      : null;
  };
  const record = (kind) => {
    const found = holding(flow.getStore());
    if (!found) return;
    records.push({ kind, transaction: found.kind, opened: found.opened });
    const how = found.kind === "BEGIN" ? " with BEGIN" : "";
    violations.push(`${kind} inside the transaction opened${how}\n  ${found.opened.join("\n  ")}`);
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

  // Only a connection the caller takes itself can open a transaction with BEGIN. One drizzle
  // takes for db.transaction is tracked by that wrapper, and one the pool takes for a single
  // query is released after it, so neither is watched.
  const checkedOut = new Set();
  const wrapped = new Set();
  const begin = (client) => {
    if (open.has(client)) return;
    const opened = caller();
    // A test that opens a transaction itself stands for another session, typically one holding a
    // lock while the code under test runs and waits for it; that code is not nested in it.
    if (opened[0] !== undefined && testFrame(opened[0])) return;
    open.set(client, opened);
    flow.enterWith({ kind: "BEGIN", client, previous: unwound(flow.getStore()) });
  };
  const end = (client) => {
    if (!open.delete(client)) return;
    const current = flow.getStore();
    if (current?.kind === "BEGIN" && current.client === client) flow.enterWith(unwound(current.previous));
  };
  const watch = (client) => {
    if (!client || typeof client !== "object") return client;
    checkedOut.add(client);
    if (!client.query?.[GUARDED]) {
      const statementQuery = client.query;
      const ownQuery = Object.prototype.hasOwnProperty.call(client, "query");
      const guarded = function (...args) {
        if (checkedOut.has(client)) {
          const text = statement(args);
          if (OPENS.test(text)) begin(client);
          else if (ENDS.test(text)) end(client);
        }
        return statementQuery.apply(this, args);
      };
      guarded[GUARDED] = { statementQuery, ownQuery };
      client.query = guarded;
      wrapped.add(client);
    }
    // The pool gives every checkout its own release function.
    const release = client.release;
    if (typeof release === "function" && !release[GUARDED]) {
      const guardedRelease = function (...args) {
        end(client);
        checkedOut.delete(client);
        return release.apply(this, args);
      };
      guardedRelease[GUARDED] = true;
      client.release = guardedRelease;
    }
    return client;
  };

  db.transaction = function (run, ...rest) {
    record("db.transaction");
    const current = { holding: false, opened: caller(), kind: "db.transaction" };
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
    const current = flow.getStore();
    // drizzle's own connection for this db.transaction, counted when the transaction opened.
    const forTransaction = current?.kind === "db.transaction" && !current.holding;
    if (!forTransaction) record("pool.connect");
    const pending = connect.apply(pool, args);
    if (forTransaction || current?.single || typeof args[0] === "function") return pending;
    return pending && typeof pending.then === "function" ? pending.then(watch) : pending;
  };
  pool.query = function (...args) {
    record("pool.query");
    // pg's Pool#query takes its connection through connect(); count the acquisition once.
    return flow.run({ single: true }, () => query.apply(pool, args));
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
      for (const client of wrapped) {
        const guarded = client.query?.[GUARDED];
        if (!guarded) continue;
        if (guarded.ownQuery) client.query = guarded.statementQuery;
        else delete client.query;
      }
      wrapped.clear();
      checkedOut.clear();
      open.clear();
    },
  };
}
