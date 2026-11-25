import { sql } from "drizzle-orm";

/** A published premium edition from the staff library, and whether it is held for its review. */
export type PremiumEdition = { edition: string; held: boolean };

/**
 * The staff library's published premium editions, or the one wanted under a share lock, each with
 * whether it is held for its review (docs/architecture/guidance-currency.md, slice 2). A held edition is
 * not offered, ordered or priced, while its buyers still download it and find it among their purchases.
 * A database the reviews migration has not reached gives no hold, so it holds none, as before.
 */
export const premiumEditions = (wanted: string | null) =>
  sql`select v.edition, coalesce((to_jsonb(v) ->> 'held')::boolean, false) as held
        from public.valo_live_manual_premium_versions(${wanted}::uuid) v`;
