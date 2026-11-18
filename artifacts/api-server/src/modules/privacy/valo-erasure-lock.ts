/** Use a dedicated bounded pool, never the pool needed by fn's transactions. */
export type PrivacyLockQuery = { text: string; values: string[]; query_timeout: number };
export interface PrivacyLockClient {
  query(config: PrivacyLockQuery): Promise<{ rows: { held?: boolean; released?: boolean }[] }>;
  release(destroy?: boolean): void;
}
export interface PrivacyLockPool {
  connect(): Promise<PrivacyLockClient>;
}

export class ErasureLockBusyError extends Error {
  readonly code = "ERASURE_LOCK_BUSY";
  constructor() {
    super("This erasure/recovery batch is already running.");
    this.name = "ErasureLockBusyError";
  }
}

const queryTimeoutMs = 1000;

/** A timed-out query may already have acquired the session lock. Destroy that
 * connection rather than returning uncertain ownership to the pool. Likewise,
 * a failed/unconfirmed unlock must never leave a pooled session holding it.
 * Cleanup preserves fn's outcome; destroying the connection releases its locks.
 */
export async function withPrivacyCaseLock<T>(
  pool: PrivacyLockPool,
  caseId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let acquired = false,
    destroy = false;
  try {
    let result: Awaited<ReturnType<PrivacyLockClient["query"]>>;
    try {
      result = await client.query({
        text: "SELECT pg_try_advisory_lock(hashtextextended($1,217)) AS held",
        values: [caseId],
        query_timeout: queryTimeoutMs,
      });
    } catch (error) {
      destroy = true;
      throw error;
    }
    if (result.rows[0]?.held === false) throw new ErasureLockBusyError();
    if (result.rows[0]?.held !== true) {
      destroy = true;
      throw Error("ERASURE_LOCK_ACQUIRE_UNCONFIRMED");
    }
    acquired = true;
    return await fn();
  } finally {
    if (acquired) {
      try {
        const result = await client.query({
          text: "SELECT pg_advisory_unlock(hashtextextended($1,217)) AS released",
          values: [caseId],
          query_timeout: queryTimeoutMs,
        });
        if (result.rows[0]?.released !== true) destroy = true;
      } catch {
        destroy = true;
      }
    }
    client.release(destroy);
  }
}
