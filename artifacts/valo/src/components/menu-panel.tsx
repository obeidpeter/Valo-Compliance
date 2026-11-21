"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Marks the bar fixed to the bottom of a phone's screen, so the opened menu can stop above it. */
export const BOTTOM_BAR = { "data-bottom-bar": "" } as const;

/**
 * The phone's opened menu, under the header's row. The header stays at the top of the screen, so a
 * menu longer than the screen would leave its last links where nothing can scroll to them. The
 * panel is therefore never taller than the room between the header's row and the bar at the bottom
 * of the screen, and a longer menu scrolls inside it, with a shadow along the edge it continues past.
 */
export function MenuPanel({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const element = panel.current;
      if (!element) return;
      // Measured from the header's row, which does not move while the panel's entrance plays.
      const top = (element.previousElementSibling ?? element).getBoundingClientRect().bottom;
      const bar = document.querySelector("[data-bottom-bar]");
      const bottom = bar?.getClientRects().length ? bar.getBoundingClientRect().top : window.innerHeight;
      // Set on the element, since the room is known only in the browser, and never below a few lines.
      element.style.maxHeight = `${Math.max(96, Math.floor(bottom - top))}px`;
    };
    fit();
    // The room changes as the banner above the header scrolls away, and when the screen turns.
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);
  return (
    <div
      ref={panel}
      className="menu-panel reveal overflow-y-auto overscroll-contain border-t border-border px-5 pb-6 pt-3 lg:hidden"
      data-testid="menu-panel"
    >
      {children}
    </div>
  );
}
