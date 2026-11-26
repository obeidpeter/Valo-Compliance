import { sql } from "drizzle-orm";

/**
 * Drafting's own database login (docs/architecture/service-logins.md, part 1; SEC-006). The database
 * adds a content version or a prepared candidate only in a session that logged in as it, so the
 * application's own connection, which the API holds, cannot add one. The three drafting paths add
 * content on its connection (`drafterDb`), as the drafter role; only they and this check may name it
 * (repository rule `drafter-connection`).
 */

/**
 * Checks that drafting's own connection works and logged in as the drafting login. A preparation asks
 * this before it does any work, so a login that is missing or cannot log in is found before anything
 * is saved or paid for, not after.
 */
export async function assertDrafterCanLogIn() {
  const { drafterDb, DRAFTER_LOGIN_ROLE } = await import("@workspace/db");
  const { rows } = await drafterDb().execute(sql`select session_user as login`);
  if (rows[0]?.login !== DRAFTER_LOGIN_ROLE) throw Error("DRAFTER_LOGIN_NOT_IN_USE");
}
