import pg from "pg";
import { LoginPool } from "./login-pool";

/**
 * A service's own database login (docs/architecture/service-logins.md): it may become one content role
 * and holds nothing itself, and the database lets that service's work happen only in a session that
 * logged in as it. The publisher's login (publisher-login.ts) came first; drafting's and review's follow
 * the same shape, here.
 */
type ServiceLogin = {
  /** The login's role name, which its connection string must log in as. */
  role: string;
  /** The setting that holds its connection string. */
  setting: string;
  /** Set on the error raised when the connection is not configured, or names another database. */
  unavailableCode: string;
  /** The service, in plain words, for the error's message. */
  service: string;
};

/** Where a connection string leads: its host (or socket folder), port and database. */
function destination(connection: string) {
  const url = new URL(connection);
  return [
    url.searchParams.get("host") ?? url.hostname,
    url.port || "5432",
    decodeURIComponent(url.pathname),
  ].join(" ");
}

export function serviceLogin(login: ServiceLogin) {
  const unavailable = (reason: string, cause?: unknown) =>
    Object.assign(new Error(`The ${login.service} login is unavailable: ${reason}`, { cause }), {
      code: login.unavailableCode,
    });
  /**
   * The service's connection string, checked before anything connects with it: it must log in as the
   * service's login, and it must lead to the application's own database.
   */
  function connectionString(serviceUrl: string | undefined, databaseUrl: string | undefined) {
    if (!serviceUrl) throw unavailable(`${login.setting} is not set`);
    if (!databaseUrl) throw unavailable("DATABASE_URL is not set");
    let user: string, same: boolean;
    try {
      user = decodeURIComponent(new URL(serviceUrl).username);
      same = destination(serviceUrl) === destination(databaseUrl);
    } catch {
      throw unavailable("a connection string could not be read");
    }
    if (user !== login.role) throw unavailable(`it must log in as ${login.role}`);
    if (!same) throw unavailable("it does not lead to the application's database");
    return serviceUrl;
  }
  let pool: pg.Pool | undefined;
  return {
    connectionString,
    /**
     * The service's own small pool, opened when the service first needs it. A login the database
     * refuses, as after an emergency revocation, fails with the service's own code.
     */
    pool(options: pg.PoolConfig = {}) {
      pool ??= new LoginPool(
        login.role,
        {
          connectionString: connectionString(process.env[login.setting], process.env.DATABASE_URL),
          // Each piece of the service's work is one short transaction at a time.
          max: 2,
          options: "-c timezone=UTC",
          connectionTimeoutMillis: 10_000,
          ...options,
        },
        (cause) => unavailable("the database refused its login", cause),
      );
      return pool;
    },
    /** Closes the service's pool, if one was opened. */
    async end() {
      const open = pool;
      pool = undefined;
      await open?.end();
    },
  };
}

/**
 * The database login drafting connects as (VALO_DRAFTER_DATABASE_URL). It may become the drafter role
 * and holds nothing itself. The database adds a content version or a prepared candidate only in a
 * session that logged in as this role (migration drafter_login), so the application's own connection,
 * which the API holds, cannot add a candidate whatever role it switches to.
 */
export const DRAFTER_LOGIN_ROLE = "valo_drafter_login";
export const DRAFTER_LOGIN_UNAVAILABLE_CODE = "VALO_DRAFTER_LOGIN_UNAVAILABLE";
export const drafterLogin = serviceLogin({
  role: DRAFTER_LOGIN_ROLE,
  setting: "VALO_DRAFTER_DATABASE_URL",
  unavailableCode: DRAFTER_LOGIN_UNAVAILABLE_CODE,
  service: "drafting",
});

/**
 * The database login review connects as (VALO_REVIEWER_DATABASE_URL). It may become the reviewer role
 * and holds nothing itself. The database records a review's attempt only in a session that logged in as
 * this role (migration reviewer_login), so neither the application's own connection nor drafting's can
 * record or change one.
 */
export const REVIEWER_LOGIN_ROLE = "valo_reviewer_login";
export const REVIEWER_LOGIN_UNAVAILABLE_CODE = "VALO_REVIEWER_LOGIN_UNAVAILABLE";
export const reviewerLogin = serviceLogin({
  role: REVIEWER_LOGIN_ROLE,
  setting: "VALO_REVIEWER_DATABASE_URL",
  unavailableCode: REVIEWER_LOGIN_UNAVAILABLE_CODE,
  service: "review",
});
