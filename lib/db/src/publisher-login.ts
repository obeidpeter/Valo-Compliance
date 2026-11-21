import pg from "pg";

/**
 * The database login the publisher connects as (VALO_PUBLISHER_DATABASE_URL). It may become the
 * publisher role and holds nothing itself. The database lets a content version become published
 * only in a session that logged in as this role (migration publisher_login), so the application's
 * own connection, which drafts and reviews, cannot publish whatever role it switches to.
 */
export const PUBLISHER_LOGIN_ROLE = "valo_publisher_login";
/** Set on the error raised when the publisher's connection is not configured, or names another
 * database. Logs keep codes, never messages. */
export const PUBLISHER_LOGIN_UNAVAILABLE_CODE = "VALO_PUBLISHER_LOGIN_UNAVAILABLE";

function unavailable(reason: string) {
  return Object.assign(new Error(`The publisher login is unavailable: ${reason}`), {
    code: PUBLISHER_LOGIN_UNAVAILABLE_CODE,
  });
}

/** Where a connection string leads: its host (or socket folder), port and database. */
function destination(connection: string) {
  const url = new URL(connection);
  return [
    url.searchParams.get("host") ?? url.hostname,
    url.port || "5432",
    decodeURIComponent(url.pathname),
  ].join(" ");
}

/**
 * The publisher's connection string, checked before anything connects with it: it must log in as
 * the publisher login, and it must lead to the application's own database. A publisher pointed at
 * another database would publish there, or find nothing to publish here.
 */
export function publisherConnectionString(publisherUrl: string | undefined, databaseUrl: string | undefined) {
  if (!publisherUrl) throw unavailable("VALO_PUBLISHER_DATABASE_URL is not set");
  if (!databaseUrl) throw unavailable("DATABASE_URL is not set");
  let user: string, same: boolean;
  try {
    user = decodeURIComponent(new URL(publisherUrl).username);
    same = destination(publisherUrl) === destination(databaseUrl);
  } catch {
    throw unavailable("a connection string could not be read");
  }
  if (user !== PUBLISHER_LOGIN_ROLE) throw unavailable(`it must log in as ${PUBLISHER_LOGIN_ROLE}`);
  if (!same) throw unavailable("it does not lead to the application's database");
  return publisherUrl;
}

let pool: pg.Pool | undefined;

/** The publisher's own small pool, opened when the publisher first needs it. */
export function publisherPool(options: pg.PoolConfig = {}) {
  pool ??= new pg.Pool({
    connectionString: publisherConnectionString(
      process.env.VALO_PUBLISHER_DATABASE_URL,
      process.env.DATABASE_URL,
    ),
    // A release is one short transaction at a time.
    max: 2,
    options: "-c timezone=UTC",
    connectionTimeoutMillis: 10_000,
    ...options,
  });
  return pool;
}

/** Closes the publisher's pool, if one was opened, with the shared pool. */
export async function endPublisherPool() {
  const open = pool;
  pool = undefined;
  await open?.end();
}
