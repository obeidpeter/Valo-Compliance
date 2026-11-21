"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SiteLink } from "./site-chrome";
import { ACCOUNT_PAGES } from "./workspace-sections";

/**
 * The header's account menu: a button with the signed-in person's initial that shows the pages
 * about the account itself. It is a list of links that a button shows and hides, not an
 * application menu: Tab moves through the links, Escape closes the list and returns focus to the
 * button, and the list closes when focus or a click goes anywhere else.
 */
export function AccountMenu({
  initials,
  email,
  LinkTo,
}: {
  initials: string;
  email?: string | undefined;
  LinkTo: SiteLink;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const list = useId();
  useEffect(() => {
    if (!open) return;
    const elsewhere = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", elsewhere);
    document.addEventListener("focusin", elsewhere);
    return () => {
      document.removeEventListener("pointerdown", elsewhere);
      document.removeEventListener("focusin", elsewhere);
    };
  }, [open]);
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from the button or any link closes the list; the wrapper takes no focus
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm gap-1 px-2"
        aria-expanded={open}
        aria-controls={list}
        aria-label="Account menu"
        title={email}
        onClick={() => setOpen((shown) => !shown)}
        data-testid="button-account-menu"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-xs font-medium">
          {initials}
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      <ul
        id={list}
        hidden={!open}
        className="surface absolute right-0 top-full z-50 mt-2 w-56 p-2 shadow-[var(--shadow-lg)]"
        data-testid="menu-account"
      >
        {ACCOUNT_PAGES.map((page) => (
          <li key={page.href}>
            <LinkTo href={page.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-secondary">
              {page.label}
            </LinkTo>
          </li>
        ))}
      </ul>
    </div>
  );
}
