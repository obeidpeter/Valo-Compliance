import { useLayoutEffect, useState, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { installRequestScopeProvider, expiredAccountRequest } from "@workspace/api-client-react";
import { AccountEpoch } from "./account-epoch-context";
import { resetAccountToasts } from "@/hooks/use-toast";
export { useAccountEpoch } from "./account-epoch-context";

function AccountState({ children, onInvalidated }: { children: ReactNode; onInvalidated: () => void }) {
  const [epoch] = useState(() => ({ active: true, controller: new AbortController() }));
  const invalidated = useRef(onInvalidated);
  invalidated.current = onInvalidated;
  const assertActive = () => {
    if (!epoch.active || epoch.controller.signal.aborted) throw expiredAccountRequest();
  };
  const [client] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onMutate: (_variables, mutation) => {
            assertActive();
            const previous = mutation.options;
            mutation.setOptions({
              ...previous,
              mutationFn: async (variables, context) => {
                assertActive();
                if (!previous.mutationFn) throw Error("Missing mutation");
                const result = await previous.mutationFn(variables, context);
                assertActive();
                return result;
              },
              onMutate: async (...args) => {
                assertActive();
                const result = await previous.onMutate?.(...args);
                assertActive();
                return result;
              },
              onSuccess: (...args) => (epoch.active ? previous.onSuccess?.(...args) : undefined),
              onError: (...args) => (epoch.active ? previous.onError?.(...args) : undefined),
              onSettled: (...args) => (epoch.active ? previous.onSettled?.(...args) : undefined),
            });
          },
        }),
        defaultOptions: {
          mutations: { retry: false, networkMode: "always" },
          queries: {
            refetchOnWindowFocus: false,
            retry: (count, error) => {
              const status = (error as { status?: number })?.status;
              return !(status && status >= 400 && status < 500) && count < 2;
            },
          },
        },
      }),
  );
  useLayoutEffect(() => {
    if (epoch.controller.signal.aborted) epoch.controller = new AbortController();
    epoch.active = true;
    const uninstall = installRequestScopeProvider(() => ({
      isCurrent: () => epoch.active,
      signal: epoch.controller.signal,
      onUnauthorized: () => invalidated.current(),
    }));
    return () => {
      epoch.active = false;
      epoch.controller.abort();
      uninstall();
      void client.cancelQueries();
      client.clear();
      resetAccountToasts();
    };
  }, [client, epoch]);
  return (
    <AccountEpoch.Provider value={epoch}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AccountEpoch.Provider>
  );
}
/** Remounts component state AND query/mutation caches before the next paint.
 * A cache-only effect is insufficient for copied profile/checker form state. */
export function AccountStateBoundary({
  identityKey,
  sessionKey,
  children,
}: {
  identityKey: string | null;
  sessionKey?: string | null;
  children: ReactNode;
}) {
  const session =
    sessionKey === undefined
      ? identityKey && !/^(anonymous|unresolved)/.test(identityKey)
        ? identityKey
        : null
      : sessionKey;
  const [blocked, setBlocked] = useState<string | null>(null);
  const previous = useRef<string | null>(session ?? null);
  useLayoutEffect(() => {
    if (identityKey === null) return;
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("valo-account-boundary-v1");
    const prior = previous.current;
    if (prior !== session) {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel, which takes no target origin
      if (prior) channel?.postMessage({ type: "session-ended", session: prior });
      previous.current = session ?? null;
      setBlocked(null);
    }
    if (channel)
      channel.onmessage = (event) => {
        if (session && event.data?.type === "session-ended" && event.data.session === session)
          flushSync(() => setBlocked(session));
      };
    return () => channel?.close();
  }, [identityKey, session]);
  const [suspended, setSuspended] = useState(false),
    [restoration, setRestoration] = useState(0);
  useLayoutEffect(() => {
    const hide = () => flushSync(() => setSuspended(true));
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
        return;
      }
      flushSync(() => {
        setRestoration((n) => n + 1);
        setSuspended(false);
      });
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);
  if (blocked && blocked === session)
    return (
      <section role="alert" className="p-6">
        <p>Your session ended or changed in another tab. Previous account details have been cleared.</p>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          Reload to continue
        </button>
      </section>
    );
  if (suspended || identityKey === null)
    return (
      <p role="status" className="p-6 text-sm">
        Refreshing your account…
      </p>
    );
  return (
    <AccountState
      key={`${identityKey}/${restoration}`}
      onInvalidated={() => {
        if (session) flushSync(() => setBlocked(session));
      }}
    >
      {children}
    </AccountState>
  );
}
