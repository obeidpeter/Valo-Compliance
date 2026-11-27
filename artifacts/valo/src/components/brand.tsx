import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { basePath } from "@/lib/env";
import { WORDMARK_LINK_CLASS, WordmarkMark } from "./wordmark";

/** The wordmark, linking home. The server renders the home page (decision 0011), so from the browser
 * app this is a plain link that loads it in full. A signed-in visitor's home is the workspace: the
 * home page would only send them on to it after loading in full, so the wordmark opens it in the app
 * instead, without the two full loads. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  const { isSignedIn } = useUser();
  return isSignedIn ? (
    <Link href="/workspace" className={WORDMARK_LINK_CLASS} data-testid="link-home">
      <WordmarkMark compact={compact} />
    </Link>
  ) : (
    <a href={basePath || "/"} className={WORDMARK_LINK_CLASS} data-testid="link-home">
      <WordmarkMark compact={compact} />
    </a>
  );
}
