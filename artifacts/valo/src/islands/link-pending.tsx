"use client";

import { useLinkStatus } from "next/link";
import { useEffect } from "react";

/** How many links have a page on its way: a later click replaces an earlier one's navigation, and
 * the two links' states can change in either order. */
let opening = 0;

/**
 * Inside a link to a server-rendered page (components/public-link.tsx). From the moment the link is
 * followed until its page has arrived, the page says so: a bar runs along the top of the screen, the
 * page being left fades a little if the wait is longer than a moment (index.css, `data-opening`), and
 * its main content is marked busy for assistive technology. Without it, a click showed nothing until
 * the new page had been rendered.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    opening += 1;
    document.documentElement.dataset.opening = "";
    document.getElementById("main-content")?.setAttribute("aria-busy", "true");
    return () => {
      opening -= 1;
      if (opening > 0) return;
      delete document.documentElement.dataset.opening;
      document.getElementById("main-content")?.removeAttribute("aria-busy");
    };
  }, [pending]);
  return null;
}
