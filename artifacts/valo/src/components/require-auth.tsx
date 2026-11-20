import { useEffect, type ReactNode } from "react";
import { Redirect } from "wouter";
import { Show } from "@clerk/react";

/** Names the open screen in the document title, which browsers and screen readers announce. The
 * title names the screen, never the account's own records. Leaving the screen puts back the title
 * it found. */
function Titled({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — Valo`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return children;
}

export function RequireAuth({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <Titled title={title}>{children}</Titled>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}
