/** The wordmark link's classes, for a shell that links home with its own link component. */
export const WORDMARK_LINK_CLASS = "group inline-flex items-center gap-2.5";

/** The wordmark itself, with no link and no router: the browser app and the server-rendered pages
 * both draw it. */
export function WordmarkMark({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-primary-foreground transition-transform group-hover:-rotate-3">
        <svg viewBox="0 0 48 48" className="h-6 w-6" aria-hidden="true">
          <path d="M13 14h6l5 15 5-15h6l-8.5 21h-5z" fill="currentColor" />
        </svg>
      </span>
      {!compact && <span className="font-display text-[1.45rem] leading-none">Valo</span>}
    </>
  );
}
