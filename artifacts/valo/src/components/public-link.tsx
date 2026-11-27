import NextLink from "next/link";
import type { ReactNode } from "react";
import { LinkPending } from "@/islands/link-pending";
import { basePath } from "@/lib/env";
import { isServerPage } from "@/lib/server-pages";

/**
 * A link on a server-rendered public page. To another server-rendered page it navigates in the page,
 * without prefetching (a prefetch would cost the API a read for a page nobody opened), and says at
 * once that the page is on its way (islands/link-pending.tsx). To a page of the browser app it is a
 * plain link that loads the page in full (decision 0011).
 */
export function PublicLink({
  href,
  className,
  children,
  current,
  "data-testid": testId,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
  /** The link leads to the page being read, or to the section it belongs to. */
  current?: boolean;
  "data-testid"?: string;
}) {
  const mark = current ? ({ "aria-current": "page" } as const) : {};
  return isServerPage(href) ? (
    <NextLink href={href} prefetch={false} className={className} data-testid={testId} {...mark}>
      {children}
      <LinkPending />
    </NextLink>
  ) : (
    <a href={basePath + href} className={className} data-testid={testId} {...mark}>
      {children}
    </a>
  );
}
