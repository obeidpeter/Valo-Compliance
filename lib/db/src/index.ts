import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { currentWorkspaceScope, scopeClient, verifyWorkspaceScope } from "./workspace-scope";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

/**
 * How long a caller waits for a pooled connection, or for a new connection to open,
 * before failing. Requests normally get one at once. A wait this long means every
 * connection is busy, for example because transactions are waiting on second
 * connections; without a limit those callers would wait forever and the service would
 * stop answering.
 */
export const POOL_ACQUIRE_TIMEOUT_MS = 10_000;
/** Codes set on the timeout errors. pg reports them with a message only, and logs never
 * keep messages. */
export const POOL_ACQUIRE_TIMEOUT_CODE = "DB_POOL_ACQUIRE_TIMEOUT";
export const CONNECT_TIMEOUT_CODE = "DB_CONNECT_TIMEOUT";

function withTimeoutCode(error: Error) {
  // The exact messages pg-pool uses for each kind of timeout.
  if (error.message === "timeout exceeded when trying to connect")
    return Object.assign(error, { code: POOL_ACQUIRE_TIMEOUT_CODE });
  if (error.message === "Connection terminated due to connection timeout")
    return Object.assign(error, { code: CONNECT_TIMEOUT_CODE });
  return error;
}

type ConnectCallback = (
  err: Error | undefined,
  client: pg.PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

class ValoPool extends pg.Pool {
  #scopeVerified = false;

  // pg's own query() takes its connection through connect(callback), so both forms are
  // covered. A connection taken inside runInWorkspaceScope is scoped until it is released.
  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    // Read when the caller asks: a pool callback can run in another request's context.
    const workspaceId = currentWorkspaceScope();
    const acquired = super.connect().catch((error: Error) => {
      throw withTimeoutCode(error);
    });
    const ready = workspaceId === undefined ? acquired : acquired.then((c) => this.#scope(c, workspaceId));
    if (!callback) return ready;
    ready.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error | boolean)),
      (error: Error) => callback(error, undefined, () => undefined),
    );
  }

  async #scope(client: pg.PoolClient, workspaceId: string) {
    if (!this.#scopeVerified) {
      await verifyWorkspaceScope(client);
      this.#scopeVerified = true;
    }
    scopeClient(client, workspaceId);
    return client;
  }
}

/** A pool configured like the shared one; tests may override options. */
export function createPool(options: pg.PoolConfig = {}) {
  // Signed privacy projections include PostgreSQL JSON timestamps. Pin every app
  // session to UTC so restores on hosts with another timezone verify identically.
  return new ValoPool({
    connectionString: process.env.DATABASE_URL,
    options: "-c timezone=UTC",
    connectionTimeoutMillis: POOL_ACQUIRE_TIMEOUT_MS,
    ...options,
  });
}

export const pool = createPool();
export const db = drizzle(pool, { schema });
export { schema };
export {
  runInWorkspaceScope,
  currentWorkspaceScope,
  WORKSPACE_SCOPE_ROLE,
  WORKSPACE_SCOPE_UNAVAILABLE_CODE,
} from "./workspace-scope";

export * from "./schema";
