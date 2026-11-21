"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { MenuPanel } from "@/components/menu-panel";

/**
 * The header of a server-rendered public page, with its menu button. The server renders the header's
 * row and the menu's contents; this island only opens and closes the menu: with the button, with
 * Escape from any control in the header, when keyboard focus moves on from the header, and on moving
 * to another page.
 */
export function HeaderWithMenu({ row, menu }: { row: ReactNode; menu: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from any control in the header closes the menu, and so does focus moving on from the header; the header takes no focus
    <header
      className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          button.current?.focus();
        }
      }}
      // The opened menu lies over the top of the page. When keyboard focus moves on to the page, the
      // menu closes, so the control that takes the focus is not hidden under it.
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget))
          setOpen(false);
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
        {row}
        <button
          ref={button}
          type="button"
          className="btn btn-ghost btn-sm !px-2.5 lg:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
          data-testid="button-menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && <MenuPanel>{menu}</MenuPanel>}
    </header>
  );
}
