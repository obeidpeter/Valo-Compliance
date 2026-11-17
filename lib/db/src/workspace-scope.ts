import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/** The role customer requests act as. Row-level security limits it to one workspace. */
export const WORKSPACE_SCOPE_ROLE = "valo_workspace_scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const scope = new AsyncLocalStorage<string>();

/**
 * Runs `run` so that every query it makes through the shared pool, including in work it
 * starts, acts as WORKSPACE_SCOPE_ROLE with `valo.workspace_id` set to `workspaceId`. The
 * workspace tables' row-level security policies then hide and refuse every other
 * workspace's rows, even for a query that forgets its workspace filter. Only server code
 * that has resolved the workspace from a membership may call this.
 */
export function runInWorkspaceScope<T>(workspaceId: string, run: () => T): T {
  const id = workspaceId.toLowerCase();
  if (!UUID.test(id)) throw new TypeError("A workspace scope needs the workspace's UUID");
  return scope.run(id, run);
}

/** The workspace the current work is scoped to, if any. */
export function currentWorkspaceScope(): string | undefined {
  return scope.getStore();
}

// Transaction control the application sends. "rollback to savepoint" and "release
// savepoint" stay inside the transaction.
const TRANSACTION_START = /^\s*(?:begin|start\s+transaction)\b/i;
const TRANSACTION_END = /^\s*(?:commit|end|rollback|abort)(?:\s+(?:work|transaction))?\s*;?\s*$/i;

// Both values are fixed or a validated UUID, so the statement can be sent as plain text in the
// same round trip as BEGIN. SET LOCAL semantics: both end with the transaction.
const enterScope = (workspaceId: string) =>
  `SELECT set_config('valo.workspace_id','${workspaceId}',true),set_config('role','${WORKSPACE_SCOPE_ROLE}',true)`;

/** Set on the error when the scoped role is missing, for example before its migration. */
export const WORKSPACE_SCOPE_UNAVAILABLE_CODE = "DB_WORKSPACE_SCOPE_UNAVAILABLE";

/**
 * Proves on a fresh checkout that this database can enter a workspace scope, before any
 * caller holds the client. Without the role, entering the scope after a caller's BEGIN would
 * fail where the caller cannot release the client. On failure the client is destroyed.
 */
export async function verifyWorkspaceScope(client: pg.PoolClient): Promise<void> {
  try {
    await client.query(`BEGIN;${enterScope("00000000-0000-4000-8000-000000000000")}`);
    await client.query("ROLLBACK");
  } catch (cause) {
    client.release(true);
    throw Object.assign(new Error("The workspace row-security role is unavailable"), {
      code: WORKSPACE_SCOPE_UNAVAILABLE_CODE,
      cause,
    });
  }
}

type Query = (config: unknown, values?: unknown, callback?: unknown) => unknown;

/**
 * Scopes a client checked out inside runInWorkspaceScope until it is released. Each
 * transaction the caller begins enters the scope straight after BEGIN, and a statement sent
 * outside a transaction runs in a scoped transaction of its own, as PostgreSQL runs a single
 * statement anyway. The scope is transaction-local, so it cannot outlive the checkout; a
 * client released inside a transaction, or whose rollback failed, is destroyed instead of
 * returned to the pool.
 */
export function scopeClient(client: pg.PoolClient, workspaceId: string): void {
  const own = Object.getOwnPropertyDescriptor(client, "query"),
    original = client.query as unknown as Query,
    release = client.release;
  const send = (config: unknown, values?: unknown) =>
    original.call(client, config, values) as Promise<pg.QueryResult>;
  let open = false,
    discard = false;

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
      const result = await send(config, values);
      open = true;
      try {
        await send(enterScope(workspaceId));
      } catch (error) {
        // The transaction is open but unscoped; the caller's rollback ends it, and the client
        // is destroyed on release in case it does not.
        discard = true;
        throw error;
      }
      return result;
    }
    await send(`BEGIN;${enterScope(workspaceId)}`);
    try {
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
    const unsafe = open || discard;
    return release.call(
      client,
      destroy || (unsafe ? new Error("WORKSPACE_SCOPE_CLIENT_DISCARDED") : undefined),
    );
  }) as typeof client.release;
}
