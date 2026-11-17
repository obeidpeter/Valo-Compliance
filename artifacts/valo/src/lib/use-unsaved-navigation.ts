import { useEffect, useRef, useState } from "react";

/** Guard both routed links and programmatic Wouter history transitions. */
export function useUnsavedNavigation(dirty: () => boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pending = useRef<null | (() => void)>(null),
    bypass = useRef(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    // oxlint-disable-next-line typescript/unbound-method -- called with history, and restored on cleanup
    const originalPush = history.pushState,
      // oxlint-disable-next-line typescript/unbound-method -- called with history, and restored on cleanup
      originalReplace = history.replaceState;
    let current = location.href;
    const changesRoute = (url: string | URL | null | undefined) => {
      if (!url) return false;
      const next = new URL(String(url), location.href),
        old = new URL(current);
      return next.origin !== old.origin || next.pathname !== old.pathname || next.search !== old.search;
    };
    const hold = (operation: () => void) => {
      pending.current = operation;
      setBlocked(true);
    };
    const wrap = (original: History["pushState"]): History["pushState"] =>
      function (data, unused, url) {
        if (!bypass.current && changesRoute(url) && dirtyRef.current()) {
          hold(() => {
            original.call(history, data, unused, url);
            current = location.href;
          });
          return;
        }
        original.call(history, data, unused, url);
        current = location.href;
      };
    history.pushState = wrap(originalPush);
    history.replaceState = wrap(originalReplace);
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.hasAttribute("download") ||
        target.target === "_blank"
      )
        return;
      if (changesRoute(target.href) && dirtyRef.current()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hold(() => location.assign(target.href));
      }
    };
    const pop = (event: PopStateEvent) => {
      if (bypass.current || !dirtyRef.current()) {
        current = location.href;
        return;
      }
      const destination = location.href;
      event.stopImmediatePropagation();
      originalPush.call(history, null, "", current);
      hold(() => location.assign(destination));
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!bypass.current && dirtyRef.current()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  return {
    blocked,
    stay: () => {
      pending.current = null;
      setBlocked(false);
    },
    proceed: () => {
      const operation = pending.current;
      pending.current = null;
      bypass.current = true;
      setBlocked(false);
      operation?.();
    },
  };
}
