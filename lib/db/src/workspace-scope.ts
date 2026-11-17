import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

/** The role customer requests act as. Row-level security limits it to one workspace. */
export const WORKSPACE_SCOPE_ROLE = "valo_workspace_scope";

/**
 * The database login customer requests connect as (VALO_CUSTOMER_DATABASE_URL). It may become
 * WORKSPACE_SCOPE_ROLE and holds nothing itself, so SQL on its connections can never act as
 * the application role.
 */
export const WORKSPACE_LOGIN_ROLE = "valo_workspace_login";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const scope = new AsyncLocalStorage<string>();

/**
 * Runs `run` so that every query it makes through the shared pool, including in work it
 * starts, connects as WORKSPACE_LOGIN_ROLE and acts as WORKSPACE_SCOPE_ROLE with a credential
 * for `workspaceId`. The workspace tables' row-level security policies then hide and refuse
 * every other workspace's rows, even for a query that forgets its workspace filter. Only
 * server code that has resolved the workspace from a membership, or background work acting
 * for the workspace of the stored record it processes, may call this. Work already scoped to
 * one workspace cannot enter another's.
 */
export function runInWorkspaceScope<T>(workspaceId: string, run: () => T): T {
  const id = workspaceId.toLowerCase();
  if (!UUID.test(id)) throw new TypeError("A workspace scope needs the workspace's UUID");
  const current = scope.getStore();
  if (current !== undefined && current !== id)
    throw new TypeError("Work in one workspace's scope cannot enter another workspace's scope");
  return scope.run(id, run);
}

/** The workspace the current work is scoped to, if any. */
export function currentWorkspaceScope(): string | undefined {
  return scope.getStore();
}

/** Set on the error when customer requests cannot enter a workspace scope. */
export const WORKSPACE_SCOPE_UNAVAILABLE_CODE = "DB_WORKSPACE_SCOPE_UNAVAILABLE";

export const workspaceScopeUnavailable = (reason: string, cause?: unknown) =>
  Object.assign(new Error(`The workspace scope is unavailable: ${reason}`), {
    code: WORKSPACE_SCOPE_UNAVAILABLE_CODE,
    cause,
  });

/**
 * A key this process signs workspace credentials with. The database holds the same key
 * (valo_scope_keys, readable only by the application role), so valo_scope_workspace() can
 * check a credential; the scoped role can read neither the key nor another credential.
 */
export type ScopeKey = { id: string; key: Buffer; expiresAt: number };

/** HMAC-SHA256's inner and outer key blocks, which the database stores instead of the key. */
export function scopeKeyPads(key: Buffer) {
  const block = Buffer.alloc(64);
  key.copy(block);
  return {
    inner: Buffer.from(block.map((byte) => byte ^ 0x36)).toString("hex"),
    outer: Buffer.from(block.map((byte) => byte ^ 0x5c)).toString("hex"),
  };
}

export function newScopeKey(): Omit<ScopeKey, "expiresAt"> {
  return { id: randomUUID(), key: randomBytes(32) };
}

/**
 * The credential a connection presents for a workspace in one transaction: the transaction
 * that started at `transactionStart` (microseconds since the epoch, as TRANSACTION_IDENTITY
 * reports it) on database backend `backendPid`. Nothing else accepts it, so a credential read
 * by SQL in one transaction is useless in every other, and it lapses with its key.
 */
export function workspaceCredential(
  key: Omit<ScopeKey, "expiresAt">,
  workspaceId: string,
  backendPid: number,
  transactionStart: string,
) {
  const mac = createHmac("sha256", key.key)
    .update(`${workspaceId}:${backendPid}:${transactionStart}`)
    .digest("hex");
  return `${workspaceId}:${key.id}:${mac}`;
}

/** Signs the credential for a transaction a scoped client has just begun. */
export type ScopeSigner = (transaction: { pid: number; started: string }) => string;

/**
 * The transaction a credential is bound to, computed exactly as valo_scope_workspace()
 * computes it.
 */
const TRANSACTION_IDENTITY =
  "SELECT pg_backend_pid() AS pid, (extract(epoch FROM transaction_timestamp()) * 1000000)::bigint::text AS started";

// Transaction control the application sends. "rollback to savepoint" and "release
// savepoint" stay inside the transaction.
const TRANSACTION_START = /^\s*(?:begin|start\s+transaction)\b/i;
const TRANSACTION_END = /^\s*(?:commit|end|rollback|abort)(?:\s+(?:work|transaction))?\s*;?\s*$/i;
// A BEGIN of words alone, with no comment, literal or second statement, can travel with
// TRANSACTION_START_STATE in one round trip.
const PLAIN_BEGIN = /^[a-z ,]+;?\s*$/i;

// Each scoped transaction starts from the session's defaults, whatever settings earlier SQL
// on the connection left, and learns what its credential is bound to.
const TRANSACTION_START_STATE = `RESET ALL;${TRANSACTION_IDENTITY}`;

// The credential is a parameter, never statement text, so other sessions cannot read it in
// pg_stat_activity. Temporary tables are searched after public, so one created on the
// connection cannot stand in for a real table. SET LOCAL semantics: all three settings end
// with the transaction.
const ENTER_SCOPE = `SELECT set_config('valo.workspace_credential',$1,true),set_config('role','${WORKSPACE_SCOPE_ROLE}',true),set_config('search_path','public, pg_temp',true)`;

type Transaction = { pid: number; started: string };
type Send = (config: unknown, values?: unknown) => Promise<unknown>;

/** The transaction a multi-statement result ends with. */
const transactionOf = (results: unknown) => (results as pg.QueryResult<Transaction>[]).at(-1)!.rows[0]!;

/** Sends BEGIN, or a plain BEGIN of the caller's, and prepares the transaction it started. */
async function begin(send: Send, text = "BEGIN") {
  const results = (await send(`${text.replace(/;\s*$/, "")};${TRANSACTION_START_STATE}`)) as pg.QueryResult[];
  return { begun: results[0]!, transaction: transactionOf(results) };
}

/**
 * Proves on a client's first checkout, before any caller holds it, that it can enter a scope:
 * it is logged in as WORKSPACE_LOGIN_ROLE, and the database recognizes this process's key. On
 * failure the client is destroyed.
 */
export async function verifyWorkspaceScope(client: pg.PoolClient, key: ScopeKey): Promise<void> {
  const probe = "00000000-0000-4000-8000-000000000000";
  try {
    const send: Send = (config, values) => client.query(config as string, values as unknown[]);
    const { transaction } = await begin(send);
    await client.query(ENTER_SCOPE, [workspaceCredential(key, probe, transaction.pid, transaction.started)]);
    const { rows } = await client.query<{ login: string; workspace: string | null }>(
      "SELECT session_user AS login, valo_scope_workspace() AS workspace",
    );
    await client.query("ROLLBACK");
    if (rows[0]?.login !== WORKSPACE_LOGIN_ROLE) throw new Error("NOT_THE_WORKSPACE_LOGIN");
    if (rows[0]?.workspace !== probe) throw new Error("SCOPE_CREDENTIAL_NOT_RECOGNIZED");
  } catch (cause) {
    client.release(true);
    throw workspaceScopeUnavailable("the workspace login cannot enter a scope", cause);
  }
}

type Query = (config: unknown, values?: unknown, callback?: unknown) => unknown;

/**
 * Scopes a client checked out inside runInWorkspaceScope until it is released. Each
 * transaction the caller begins enters the scope straight after BEGIN, from the session's
 * default settings and with a credential for that transaction alone, and a statement sent
 * outside a transaction runs in a scoped transaction of its own, as PostgreSQL runs a single
 * statement anyway. The scope is transaction-local, so it cannot outlive the checkout. A
 * client released inside a transaction, or whose rollback failed, is destroyed instead of
 * returned to the pool, and any other is reset with DISCARD ALL first, so no temporary table,
 * setting, lock or prepared statement a request left behind reaches the next one.
 */
export function scopeClient(client: pg.PoolClient, sign: ScopeSigner): void {
  const own = Object.getOwnPropertyDescriptor(client, "query"),
    original = client.query as unknown as Query,
    release = client.release;
  const send = (config: unknown, values?: unknown) =>
    original.call(client, config, values) as Promise<pg.QueryResult>;
  let open = false,
    discard = false;

  const enter = (transaction: Transaction) => send(ENTER_SCOPE, [sign(transaction)]);

  async function scoped(text: string, config: unknown, values: unknown) {
    if (open) {
      if (!TRANSACTION_END.test(text)) return send(config, values);
      try {
        return await send(config, values);
      } finally {
        open = false;
      }
    }
    if (TRANSACTION_START.test(text)) {
      // Until the scope is entered the transaction may be open and unscoped: the caller's
      // rollback ends it, and the client is destroyed on release in case it does not.
      open = true;
      discard = true;
      let result: pg.QueryResult;
      if (PLAIN_BEGIN.test(text) && !parameterized(config, values)) {
        const { begun, transaction } = await begin(send, text);
        await enter(transaction);
        result = begun;
      } else {
        result = await send(config, values);
        await enter(transactionOf(await send(TRANSACTION_START_STATE)));
      }
      discard = false;
      return result;
    }
    try {
      await enter((await begin(send)).transaction);
      const result = await send(config, values);
      await send("COMMIT");
      return result;
    } catch (error) {
      try {
        await send("ROLLBACK");
      } catch {
        // The statement's own error is what the caller needs; a client whose rollback failed
        // may still be in the scoped transaction, so it is destroyed on release instead.
        discard = true;
      }
      throw error;
    }
  }

  client.query = function (config: unknown, values?: unknown, callback?: unknown) {
    if (typeof values === "function") [values, callback] = [undefined, values];
    const text = typeof config === "string" ? config : (config as { text?: unknown } | null)?.text;
    if (typeof text !== "string") {
      // Submittable queries pass through only inside a transaction, which is already scoped.
      if (open) return original.call(client, config, values, callback);
      throw new TypeError("A query in a workspace scope must be SQL text or run in a transaction");
    }
    const result = scoped(text, config, values);
    if (typeof callback !== "function") return result;
    result.then(
      (value) => (callback as (error: unknown, value?: unknown) => void)(null, value),
      (error) => (callback as (error: unknown) => void)(error),
    );
    return undefined;
  } as typeof client.query;

  client.release = ((destroy?: Error | boolean) => {
    if (own) Object.defineProperty(client, "query", own);
    else delete (client as { query?: unknown }).query;
    client.release = release;
    if (destroy || open || discard)
      return release.call(client, destroy || new Error("WORKSPACE_SCOPE_CLIENT_DISCARDED"));
    send("DISCARD ALL").then(
      () => {
        // DISCARD ALL also deallocates prepared statements, which the driver must forget.
        const connection = (client as unknown as { connection?: Record<string, unknown> }).connection;
        if (connection) {
          connection.parsedStatements = {};
          connection.submittedNamedStatements = {};
        }
        release.call(client);
      },
      (error: unknown) =>
        release.call(client, error instanceof Error ? error : new Error("WORKSPACE_SCOPE_RESET_FAILED")),
    );
    return undefined;
  }) as typeof client.release;
}

/** Whether a query carries parameters or a prepared statement's name. */
function parameterized(config: unknown, values: unknown) {
  const own =
    typeof config === "object" && config !== null ? (config as { values?: unknown; name?: unknown }) : {};
  const list = values ?? own.values;
  return Boolean(own.name) || (Array.isArray(list) && list.length > 0);
}
