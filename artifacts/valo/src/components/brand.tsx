import { Link } from 'wouter';

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" data-testid="link-home">
      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-primary-foreground transition-transform group-hover:-rotate-3">
        <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
          <path d="M13 14h6l5 15 5-15h6l-8.5 21h-5z" fill="currentColor" />
        </svg>
      </span>
      {!compact && <span className="font-display text-[1.45rem] leading-none">Valo</span>}
    </Link>
  );
}
