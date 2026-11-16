import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, valoPrivacyEvents, valoPrivacyTombstones } from "@workspace/db";
import { privacyAuditHash, privacyAuditEqual } from "./valo-privacy-state";
import { quotaSubjectHash } from "./valo-quota";
import { ValoProblem } from "./valo-problem";
import { setting } from "../platform/settings";
type Tx = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "execute" | "select" | "selectDistinct">;
export type PrivacyKeys = { current: string; keys: Record<string, string> };
const legacy = "session-derived-v1";
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex");
const held = () =>
  new ValoProblem(
    503,
    "Privacy processing is held: a required historical signing key is unavailable or does not match its pinned version.",
  );
/** Runtime only. Secret values never enter records, logs or client responses. */
export function privacyKeys(): PrivacyKeys {
  let ring: PrivacyKeys;
  try {
    const keyring = setting("VALO_PRIVACY_KEYRING");
    if (keyring) ring = JSON.parse(keyring);
    else {
      const key = setting("SESSION_SECRET");
      if (!key || key.length < 32) throw held();
      const current = `session-${fingerprint(key).slice(0, 20)}`;
      ring = { current, keys: { [current]: key, [legacy]: key } };
    }
    if (
      !ring.current ||
      !ring.keys?.[ring.current] ||
      ring.current === legacy ||
      Object.entries(ring.keys).some(
        ([id, key]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || typeof key !== "string" || key.length < 32,
      )
    )
      throw held();
    return ring;
  } catch {
    throw held();
  }
}
export async function privacyKey(
  tx: Tx,
  version: string,
  ring: PrivacyKeys = privacyKeys(),
  newSigner = false,
) {
  const key = ring.keys[version];
  if (!key) throw held();
  let result = await tx.execute<{ fingerprint: string }>(
    sql`SELECT fingerprint FROM valo_privacy_key_versions WHERE id=${version}`,
  );
  if (!result.rows.length) {
    if (version === legacy) {
      // Bind the legacy alias only after a genuine existing signature proves
      // which key signed it. Never adopt the current secret by assumption.
      const [anchor] = await tx
        .select()
        .from(valoPrivacyEvents)
        .where(eq(valoPrivacyEvents.keyVersion, legacy))
        .limit(1);
      if (!anchor || !privacyAuditEqual(anchor.eventHash, privacyAuditHash(anchor, key))) throw held();
    } else if (!newSigner || version !== ring.current) throw held();
    await tx.execute(sql`INSERT INTO valo_privacy_key_versions(id,fingerprint)
      VALUES(${version},${fingerprint(key)}) ON CONFLICT(id) DO NOTHING`);
    result = await tx.execute<{ fingerprint: string }>(
      sql`SELECT fingerprint FROM valo_privacy_key_versions WHERE id=${version}`,
    );
  }
  if (result.rows[0]?.fingerprint !== fingerprint(key)) throw held();
  return key;
}
export async function privacySigner(tx: Tx, ring: PrivacyKeys = privacyKeys()) {
  return { version: ring.current, key: await privacyKey(tx, ring.current, ring, true) };
}
export async function privacyIdentityHashes(tx: Tx, identityId: string, ring: PrivacyKeys = privacyKeys()) {
  const versions = await tx
    .selectDistinct({ version: valoPrivacyTombstones.keyVersion })
    .from(valoPrivacyTombstones);
  const hashes: string[] = [];
  // Missing historical verification material must not permit automatic
  // provisioning just because a hash can no longer be matched.
  for (const { version } of versions)
    hashes.push(quotaSubjectHash(await privacyKey(tx, version, ring), "user", identityId));
  return hashes;
}
