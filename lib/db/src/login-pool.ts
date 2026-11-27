import { EventEmitter } from "node:events";
import pg from "pg";

/**
 * SQLSTATEs the database refuses a login with: 28000, invalid_authorization_specification (the role may
 * not log in, as after an emergency revocation), and 28P01, invalid_password (as after a rotation the
 * caller missed).
 */
const LOGIN_REFUSED = new Set(["28000", "28P01"]);

/** Whether an error is the database refusing a login. */
export function loginRefused(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && LOGIN_REFUSED.has(code);
}

const failures = new EventEmitter();

/**
 * Called with each pooled connection that failed while idle, for instance because its session was ended
 * in an emergency revocation or the database restarted. The pool has already dropped the connection,
 * and the next query opens another. Returns a function that stops the calls.
 */
export function onConnectionFailure(listener: (error: Error, login: string) => void) {
  failures.on("failure", listener);
  return () => void failures.off("failure", listener);
}

/**
 * Listens for the pool's idle connections' failures. pg-pool emits them on the pool, and an emitter's
 * "error" with no listener throws, which would stop the process; each failure is reported instead.
 */
export function reportIdleFailures(pool: pg.Pool, login: string) {
  pool.on("error", (error) => failures.emit("failure", error, login));
}

export type ConnectCallback = (
  err: Error | undefined,
  client: pg.PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

/**
 * Serves pg's callback form of connect() from its promise form: pg's own query() takes its connection
 * through connect(callback), so a pool that changes connect() must change both.
 */
export function connectWith(ready: Promise<pg.PoolClient>, callback: ConnectCallback) {
  // The callback runs once, from whichever handler settles.
  /* oxlint-disable promise/no-callback-in-promise */
  ready.then(
    (client) => callback(undefined, client, (release) => client.release(release as Error | boolean)),
    (error: Error) => callback(error, undefined, () => undefined),
  );
  /* oxlint-enable promise/no-callback-in-promise */
}

/**
 * The pool of one of the services' own logins (docs/architecture/service-logins.md). When the database
 * refuses the login, the error carries that login's own code, so the work that needed it stops with
 * that code; and a connection that fails while idle is reported, not thrown.
 */
export class LoginPool extends pg.Pool {
  readonly #refused: (cause: Error) => Error;

  constructor(login: string, options: pg.PoolConfig, refused: (cause: Error) => Error) {
    super(options);
    this.#refused = refused;
    reportIdleFailures(this, login);
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    const ready = super.connect().catch((error: Error) => {
      throw loginRefused(error) ? this.#refused(error) : error;
    });
    if (!callback) return ready;
    connectWith(ready, callback);
  }
}
