"use client";

import { RefreshCw } from "lucide-react";

/** What a server-rendered public page shows if one of its islands fails while it renders: the site's
 * header and footer stay, and the visitor can try again. */
export default function PublicPageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <div role="alert" className="surface p-6" data-testid="status-page-error">
        <p className="font-medium">This page could not be shown</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Something went wrong while it loaded. Nothing you saved has changed.
        </p>
        <button type="button" className="btn btn-ghost btn-sm mt-4" onClick={reset}>
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    </div>
  );
}
