import { useSyncExternalStore } from "react";

/**
 * What a server-rendered public page knows about its visitor, which is nothing until the identity
 * provider has loaded in the browser (decision 0011, point 6). The server renders every page as
 * `unknown`, which shows the signed-out links, so the content never waits for the provider.
 */
export type Identity =
  | { status: "unknown" }
  | { status: "signed-out" }
  | { status: "signed-in"; email: string; initials: string; signOut: () => Promise<unknown> };

const UNKNOWN: Identity = { status: "unknown" };
let current: Identity = UNKNOWN;
const listeners = new Set<() => void>();

/** Called by the identity bridge each time the provider's view of the visitor changes. */
export function publishIdentity(next: Identity) {
  current = next;
  for (const listener of listeners) listener();
}

export function useIdentity(): Identity {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => UNKNOWN,
  );
}
