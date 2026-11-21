import { useEffect, useRef, useState } from "react";

/** What an open screen does when the browser goes back or forward. */
type Guard = {
  /** Whether the move would leave the screen with something unsaved on it. */
  holds: () => boolean;
  /** Take the move back, and ask. */
  hold: () => void;
  /** The move went through: this is where the screen now is. */
  moved: () => void;
};
const guards = new Set<Guard>();
let watching = false;

/**
 * Watches the browser's Back and Forward. Call it once as the app starts, before the router
 * renders.
 *
 * On the window, listeners are called in the order they were added, and the router re-renders from
 * its own before the next one is called. Added later, a screen's own listener was never asked: the
 * screen was already gone, with what was typed on it. Added first, this one asks the open screens'
 * guards, and the router hears of a move only when none of them holds it.
 */
export function watchBackAndForward() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("popstate", (event) => {
    const guard = [...guards].find((each) => each.holds());
    if (!guard) {
      for (const each of guards) each.moved();
      return;
    }
    event.stopImmediatePropagation();
    guard.hold();
  });
}

/** Guard routed links, programmatic Wouter history transitions and the browser's Back and Forward. */
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
    const guard: Guard = {
      holds: () => !bypass.current && changesRoute(location.href) && dirtyRef.current(),
      hold: () => {
        // The browser has already moved. Put this screen's address back, and go to the other one
        // only if the customer chooses to leave.
        const destination = location.href;
        originalPush.call(history, null, "", current);
        hold(() => location.assign(destination));
      },
      moved: () => {
        current = location.href;
      },
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!bypass.current && dirtyRef.current()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("click", click, true);
    guards.add(guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      document.removeEventListener("click", click, true);
      guards.delete(guard);
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
