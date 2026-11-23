import type { RichCheckerFacts } from "./rich-checker";

const STORAGE_KEY = "valo-checker-handoff-v1";
export const CHECKER_HANDOFF_TTL_MS = 30 * 60 * 1000;

export type CheckerHandoff = {
  facts: RichCheckerFacts;
  skipped: string[];
  amountText: string;
};

type StoredHandoff = CheckerHandoff & { v: 1; savedAt: number };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Temporarily store anonymous answers in this browser tab only when the visitor opts to sign up or sign in. */
export function stashCheckerHandoff(
  payload: CheckerHandoff,
  storage: StorageLike | null = defaultStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    const record: StoredHandoff = { v: 1, ...payload, savedAt: now };
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage quota or private-mode restrictions; the flow still works without carry-over.
  }
}

/** Read a valid, unexpired anonymous handoff from this browser tab without mutating it unless invalid/expired. */
export function peekCheckerHandoff(
  storage: StorageLike | null = defaultStorage(),
  now = Date.now(),
): CheckerHandoff | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredHandoff> | null;
    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.savedAt !== "number" ||
      now - parsed.savedAt > CHECKER_HANDOFF_TTL_MS ||
      now < parsed.savedAt - 60_000 ||
      !parsed.facts ||
      typeof parsed.facts !== "object" ||
      !Array.isArray(parsed.skipped) ||
      typeof parsed.amountText !== "string"
    ) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      facts: parsed.facts,
      skipped: parsed.skipped.filter((k): k is string => typeof k === "string"),
      amountText: parsed.amountText,
    };
  } catch {
    clearCheckerHandoff(storage);
    return null;
  }
}

/** Clear any stashed anonymous handoff from this browser tab. */
export function clearCheckerHandoff(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage access errors.
  }
}
