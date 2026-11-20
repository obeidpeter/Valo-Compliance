"use client";

import { useEffect, useState, type ComponentType } from "react";

type Bridge = ComponentType<{ nonce?: string | undefined }>;

/**
 * Loads the identity provider once the page is interactive and the browser is idle, never before the
 * page's content (decision 0011, point 6). Until it has loaded, or if it cannot load, the page keeps
 * the signed-out links it was rendered with.
 */
export function IdentityLoader({ nonce }: { nonce?: string | undefined }) {
  const [bridge, setBridge] = useState<{ Bridge: Bridge } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      import("./identity-bridge").then(
        ({ IdentityBridge }) => {
          if (!cancelled) setBridge({ Bridge: IdentityBridge });
        },
        (error: unknown) => {
          // Offline, or the chunk is gone after a release: the page stays signed out, as rendered.
          console.warn("Valo could not load the sign-in state", error);
        },
      );
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(load, { timeout: 2000 })
        : undefined;
    const timer = idle === undefined ? window.setTimeout(load, 0) : undefined;
    return () => {
      cancelled = true;
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  return bridge ? <bridge.Bridge nonce={nonce} /> : null;
}
