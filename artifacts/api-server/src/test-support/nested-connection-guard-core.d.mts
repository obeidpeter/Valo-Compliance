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
export function guardNestedConnections(database: { db: Transactional; pool: Pooled }): {
  /** One readable line per finding, naming where its transaction was opened. */
  violations: string[];
  records: { kind: "db.transaction" | "pool.connect" | "pool.query"; opened: string[] }[];
  restore(): void;
};
