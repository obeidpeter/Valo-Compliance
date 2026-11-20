import NextLink from "next/link";
import type { ReactNode } from "react";
import { basePath } from "@/lib/env";
import { isServerPage } from "@/lib/server-pages";

/**
 * A link on a server-rendered public page. To another server-rendered page it navigates in the page,
 * without prefetching (a prefetch would cost the API a read for a page nobody opened). To a page of
 * the browser app it is a plain link that loads the page in full (decision 0011).
 */
export function PublicLink({
  href,
  className,
  children,
  "data-testid": testId,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return isServerPage(href) ? (
    <NextLink href={href} prefetch={false} className={className} data-testid={testId}>
      {children}
    </NextLink>
  ) : (
    <a href={basePath + href} className={className} data-testid={testId}>
      {children}
    </a>
  );
}
