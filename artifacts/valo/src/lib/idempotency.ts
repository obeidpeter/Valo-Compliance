export type IdempotencySlot = {
  fingerprint: string;
  key: string;
} | null;

export function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Reuses the existing idempotency key when retrying an identical payload, and mints a fresh key
 * whenever the submitted payload changes so edited retries never get stuck on a 409 mismatch. */
export function resolveIdempotencyKey(
  slot: IdempotencySlot,
  payload: unknown,
  makeUuid: () => string = randomUuid,
): { fingerprint: string; key: string } {
  const fingerprint = JSON.stringify(payload);
  if (slot && slot.fingerprint === fingerprint) return slot;
  return { fingerprint, key: makeUuid() };
}
