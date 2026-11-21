import { basePath } from "@/lib/env";
import { WORDMARK_LINK_CLASS, WordmarkMark } from "./wordmark";

/** The wordmark, linking home. The server renders the home page (decision 0011), so from the browser
 * app this is a plain link that loads it in full. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <a href={basePath || "/"} className={WORDMARK_LINK_CLASS} data-testid="link-home">
      <WordmarkMark compact={compact} />
    </a>
  );
}
