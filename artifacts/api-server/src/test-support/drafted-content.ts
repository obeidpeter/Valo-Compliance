/** Synthetic CI content only; never a publisher bypass or a released product. */
import { sql } from "drizzle-orm";
import { drafterDb } from "@workspace/db";

/**
 * Tests add synthetic content as drafting adds it (docs/architecture/service-logins.md, part 1): the
 * database adds a content version or a prepared candidate only in a session that logged in as the
 * drafting login, and only as the drafter role.
 */

/** The transaction `draftSynthetic` hands its work: drafting's own connection, as the drafter role. */
export type DraftingTx = Parameters<Parameters<ReturnType<typeof drafterDb>["transaction"]>[0]>[0];

/**
 * Adds synthetic content for good, on drafting's own connection (VALO_DRAFTER_DATABASE_URL, which the
 * CI database job sets), in a transaction of its own.
 */
export async function draftSynthetic<T>(work: (tx: DraftingTx) => PromiseLike<T>): Promise<T> {
  return drafterDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    return work(tx);
  });
}

/**
 * For a fixture that is undone with the rest of its test's own transaction on the application's
 * connection, which a second connection cannot join. For `work`, that transaction becomes the drafting
 * login and the drafter role, then returns to the application's login. Only a superuser's session may
 * become another login, as the test cluster's owner can; the application's login cannot elsewhere.
 */
export async function asDraftingLogin<T>(
  tx: { execute(query: ReturnType<typeof sql>): PromiseLike<unknown> },
  work: () => PromiseLike<T>,
): Promise<T> {
  await tx.execute(sql`SET LOCAL SESSION AUTHORIZATION valo_drafter_login`);
  await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
  const result = await work();
  await tx.execute(sql`SET LOCAL SESSION AUTHORIZATION DEFAULT`);
  return result;
}
