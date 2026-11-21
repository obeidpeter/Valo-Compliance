"use client";

import { useEffect, useState } from "react";
import { Skel } from "@/components/page-parts";

/**
 * Whether live payments are on, as the server read it. When the server could not read it, the
 * browser asks the API itself (decision 0011, point 3), with a placeholder until the answer comes.
 * Without an answer it says what the browser app said: switched off, as payments are in this build.
 * A plain request to the one public endpoint keeps the browser's API client off this page.
 */
export function PaymentsStatus({ live }: { live: boolean | null }) {
  const [known, setKnown] = useState<boolean | null>(live);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (live !== null) return;
    const controller = new AbortController();
    fetch("/api/public/status", { headers: { accept: "application/json" }, signal: controller.signal })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ livePaymentsEnabled?: unknown }>) : null,
      )
      .then(
        (status) => {
          if (status) setKnown(status.livePaymentsEnabled === true);
          else setFailed(true);
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      );
    return () => controller.abort();
  }, [live]);
  if (known === null && !failed) return <Skel className="mt-3 h-8 w-40" />;
  return (
    <p className="font-display mt-3 text-3xl" data-testid="text-payments-status">
      {known ? "Enabled" : "Switched off"}
    </p>
  );
}
