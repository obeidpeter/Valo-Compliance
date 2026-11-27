import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  currentWorkspaceScope,
  newScopeKey,
  WORKSPACE_LOGIN_ROLE,
  scopeClient,
  scopeKeyPads,
  verifyWorkspaceScope,
  workspaceCredential,
  workspaceScopeUnavailable,
  type ScopeKey,
} from "./workspace-scope";
import { endPublisherPool, publisherPool } from "./publisher-login";
import { drafterLogin, reviewerLogin } from "./service-login";
import { connectWith, loginRefused, reportIdleFailures, type ConnectCallback } from "./login-pool";

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
export const DEFAULT_POOL_MAX = 10;
export const MAX_CONFIGURED_POOL_SIZE = 100;
/** Codes set on the timeout errors. pg reports them with a message only, and logs never
 * keep messages. */
export const POOL_ACQUIRE_TIMEOUT_CODE = "DB_POOL_ACQUIRE_TIMEOUT";
export const CONNECT_TIMEOUT_CODE = "DB_CONNECT_TIMEOUT";

/** Parses an explicit pool size (1–100) or falls back when unset. Refuses invalid values. */
export function configuredPoolMax(raw: string | undefined, fallback = DEFAULT_POOL_MAX): number {
  if (raw === undefined || raw === "") return fallback;
  if (raw.trim() !== raw || !/^[1-9][0-9]{0,2}$/.test(raw)) throw Error("INVALID_DB_POOL_MAX");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONFIGURED_POOL_SIZE)
    throw Error("INVALID_DB_POOL_MAX");
  return value;
}

function withTimeoutCode(error: Error) {
  // The exact messages pg-pool uses for each kind of timeout.
  if (error.message === "timeout exceeded when trying to connect")
    return Object.assign(error, { code: POOL_ACQUIRE_TIMEOUT_CODE });
  if (error.message === "Connection terminated due to connection timeout")
    return Object.assign(error, { code: CONNECT_TIMEOUT_CODE });
  return error;
}

/** How long a process's credential key is accepted, and when it is replaced before that. */
const SCOPE_KEY_VALIDITY = "7 days";
const SCOPE_KEY_RENEW_MS = 24 * 60 * 60 * 1000;

class ValoPool extends pg.Pool {
  #customerOptions: pg.PoolConfig;
  #customer: pg.Pool | undefined;
  #key: ScopeKey | undefined;
  #registering: Promise<ScopeKey> | undefined;
  #verified = new WeakSet<pg.PoolClient>();

  constructor(options: pg.PoolConfig, customerOptions: pg.PoolConfig) {
    super(options);
    this.#customerOptions = customerOptions;
    // An idle connection that fails, as when the database restarts, is reported, not thrown.
    reportIdleFailures(this, "application");
  }

  // pg's own query() takes its connection through connect(callback), so both forms are
  // covered. A connection asked for inside runInWorkspaceScope comes from the workspace
  // login's own pool and is scoped until it is released.
  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    // Read when the caller asks: a pool callback can run in another request's context.
    const workspaceId = currentWorkspaceScope();
    const ready =
      workspaceId === undefined
        ? super.connect().catch((error: Error) => {
            throw withTimeoutCode(error);
          })
        : this.#scoped(workspaceId);
    if (!callback) return ready;
    connectWith(ready, callback);
  }

  /** Connections of the workspace login, open now, for tests and diagnostics. */
  get scopedTotalCount() {
    return this.#customer?.totalCount ?? 0;
  }

  override async end(): Promise<void> {
    await this.#customer?.end();
    await endPublisherPool();
    await drafterLogin.end();
    await reviewerLogin.end();
    return super.end();
  }

  async #scoped(workspaceId: string) {
    if (!this.#customerOptions.connectionString)
      throw workspaceScopeUnavailable("VALO_CUSTOMER_DATABASE_URL is not set");
    if (!this.#customer) {
      this.#customer = new pg.Pool(this.#customerOptions);
      // An idle customer connection's failure is reported, as its session's end in an emergency
      // revocation would be, not thrown.
      reportIdleFailures(this.#customer, WORKSPACE_LOGIN_ROLE);
    }
    const key = await this.#scopeKey();
    const client = await this.#customer.connect().catch((error: Error) => {
      // A login the database refuses, as after an emergency revocation, fails with the scope's code.
      if (loginRefused(error))
        throw workspaceScopeUnavailable("the database refused the workspace login", error);
      throw withTimeoutCode(error);
    });
    if (!this.#verified.has(client)) {
      await verifyWorkspaceScope(client, key);
      this.#verified.add(client);
    }
    scopeClient(client, ({ pid, started }) => workspaceCredential(key, workspaceId, pid, started));
    return client;
  }

  /** This process's credential key, registered through an application connection. */
  async #scopeKey(): Promise<ScopeKey> {
    const current = this.#key;
    if (current && current.expiresAt - Date.now() > SCOPE_KEY_RENEW_MS) return current;
    this.#registering ??= this.#registerScopeKey()
      .then((key) => (this.#key = key))
      .finally(() => (this.#registering = undefined));
    try {
      return await this.#registering;
    } catch (cause) {
      // Until it expires, the current key still works while its replacement cannot be stored.
      if (current && current.expiresAt - Date.now() > 60_000) return current;
      throw workspaceScopeUnavailable("this process's credential key could not be registered", cause);
    }
  }

  async #registerScopeKey(): Promise<ScopeKey> {
    const key = newScopeKey(),
      pads = scopeKeyPads(key.key);
    const client = await super.connect();
    try {
      const { rows } = await client.query<{ expires_at: Date }>(
        `INSERT INTO valo_scope_keys(id,inner_pad,outer_pad,expires_at)
        VALUES($1,$2,$3,now() + interval '${SCOPE_KEY_VALIDITY}') RETURNING expires_at`,
        [key.id, pads.inner, pads.outer],
      );
      // Keys of processes that stopped expire; remove them a day later.
      await client.query("DELETE FROM valo_scope_keys WHERE expires_at < now() - interval '1 day'");
      return { ...key, expiresAt: new Date(rows[0]!.expires_at).getTime() };
    } finally {
      client.release();
    }
  }
}

/** A pool configured like the shared one; tests may override options for either login. */
export function createPool(options: pg.PoolConfig = {}, customerOptions: pg.PoolConfig = {}) {
  // Signed privacy projections include PostgreSQL JSON timestamps. Pin every app
  // session to UTC so restores on hosts with another timezone verify identically.
  const shared: pg.PoolConfig = {
    options: "-c timezone=UTC",
    connectionTimeoutMillis: POOL_ACQUIRE_TIMEOUT_MS,
    ...options,
  };
  return new ValoPool(
    {
      connectionString: process.env.DATABASE_URL,
      max: configuredPoolMax(process.env.VALO_DB_POOL_MAX, DEFAULT_POOL_MAX),
      ...shared,
    },
    // Customer requests connect as the workspace login, which can only become the scoped role.
    {
      max: configuredPoolMax(process.env.VALO_CUSTOMER_DB_POOL_MAX, DEFAULT_POOL_MAX),
      ...shared,
      connectionString: process.env.VALO_CUSTOMER_DATABASE_URL,
      ...customerOptions,
    },
  );
}

export const pool = createPool();
export const db = drizzle(pool, { schema });
/**
 * The database as the publisher sees it: connections that logged in as the publisher login. Only
 * the release of a content version runs here; everything else uses `db`.
 */
export const publisherDb = () => drizzle(publisherPool(), { schema });
/**
 * The database as drafting sees it: connections that logged in as the drafting login. Only adding a
 * content version or a prepared candidate runs here (docs/architecture/service-logins.md).
 */
export const drafterDb = () => drizzle(drafterLogin.pool(), { schema });
/**
 * The database as review sees it: connections that logged in as the review login. Only recording an AI
 * review's attempt runs here (docs/architecture/service-logins.md).
 */
export const reviewerDb = () => drizzle(reviewerLogin.pool(), { schema });
export { schema };
export {
  runInWorkspaceScope,
  currentWorkspaceScope,
  WORKSPACE_LOGIN_ROLE,
  WORKSPACE_SCOPE_ROLE,
  WORKSPACE_SCOPE_UNAVAILABLE_CODE,
} from "./workspace-scope";

export { onConnectionFailure } from "./login-pool";
export {
  PUBLISHER_LOGIN_ROLE,
  PUBLISHER_LOGIN_UNAVAILABLE_CODE,
  publisherConnectionString,
} from "./publisher-login";
export {
  DRAFTER_LOGIN_ROLE,
  DRAFTER_LOGIN_UNAVAILABLE_CODE,
  drafterLogin,
  REVIEWER_LOGIN_ROLE,
  REVIEWER_LOGIN_UNAVAILABLE_CODE,
  reviewerLogin,
} from "./service-login";

export * from "./schema";
