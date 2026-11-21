import { useLayoutEffect } from "react";
import { EmptyState } from "@/components/page-parts";
import { UNAVAILABLE_TITLE, useDocumentTitle } from "@/lib/document-title";

/** Whether this document was loaded by reloading this very address. */
function reloadedAt(href: string) {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === "reload" && entry.name === href;
}

/**
 * A page the server renders now (decision 0011), reached inside the browser app without a full
 * load, such as by a link in one of its screens: the app hands the address to the server with a
 * reload. If the server sent that same address back to the browser app, reloading again would loop,
 * so the app says it cannot open the page instead.
 */
export function ServerPage() {
  const looped = reloadedAt(window.location.href);
  useDocumentTitle(looped ? UNAVAILABLE_TITLE : null);
  useLayoutEffect(() => {
    if (!looped) window.location.reload();
  }, [looped]);
  return looped ? (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <EmptyState title="This page could not be opened">
        Reload the page, or go back to the page you came from.
      </EmptyState>
    </div>
  ) : (
    <div className="min-h-screen" aria-busy="true" aria-label="Loading" />
  );
}
