type Transactional = { transaction: (...args: any[]) => Promise<unknown> };
type Pooled = { connect: (...args: any[]) => unknown; query: (...args: any[]) => unknown };

/**
 * Records every pooled connection taken while the same asynchronous flow already holds
 * a transaction's connection. Such a flow waits for a second connection while keeping
 * the first, so as many concurrent callers as the pool has connections wait forever.
 *
 * A transaction is one opened with `db.transaction`, or one opened with `BEGIN` (or
 * `START TRANSACTION`) on a connection the flow took from the pool itself. The latter
 * lasts until `COMMIT`, `ROLLBACK` or their synonyms, or until the connection is released.
 * A BEGIN that a test issues itself stands for another session and is not watched.
 *
 * Install it on the shared `db` and `pool` from `@workspace/db` before the code under
 * test runs, and call `restore()` afterwards. A transaction's own queries use the
 * connection it already holds, so they are never recorded.
 */
export function guardNestedConnections(
  database: { db: Transactional; pool: Pooled },
  options?: {
    /** Whether the frame that issued a BEGIN is test code, whose own transaction stands for
     * another session and is not watched. By default, any frame in a `.test.` file. */
    testFrame?: (frame: string) => boolean;
  },
): {
  /** One readable line per finding, naming where its transaction was opened. */
  violations: string[];
  records: {
    kind: "db.transaction" | "pool.connect" | "pool.query";
    /** How the transaction that held a connection was opened. */
    transaction: "db.transaction" | "BEGIN";
    opened: string[];
  }[];
  restore(): void;
};
