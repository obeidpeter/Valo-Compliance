import { Fragment } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
  testId?: string;
};

/**
 * Accessible hierarchical trail for deep workspace screens so users always know where they are and
 * can jump back to any parent section in one click.
 */
export function Breadcrumbs({ items, className }: { items: readonly BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn("text-sm text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />}
              <li className="min-w-0">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="inline-flex items-center rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    data-testid={item.testId}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "block max-w-[18rem] truncate sm:max-w-md",
                      isLast && "font-medium text-foreground",
                    )}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
