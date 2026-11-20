import { Link } from "wouter";
import { WORDMARK_LINK_CLASS, WordmarkMark } from "./wordmark";

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={WORDMARK_LINK_CLASS} data-testid="link-home">
      <WordmarkMark compact={compact} />
    </Link>
  );
}
