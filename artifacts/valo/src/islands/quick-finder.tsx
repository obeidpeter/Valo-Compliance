"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { basePath } from "@/lib/env";
import {
  PUBLIC_QUICK_ITEMS,
  WORKSPACE_QUICK_ITEMS,
  filterQuickFinderItems,
  type QuickFinderItem,
} from "@/lib/quick-finder";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "valo-open-quick-finder";

export function openQuickFinder() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  }
}

export function QuickFinderTrigger({
  className,
  compact = false,
  testId = "button-quick-finder",
}: {
  className?: string;
  compact?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={cn("btn btn-ghost btn-sm", className)}
      aria-label="Quick jump (Ctrl+K)"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={openQuickFinder}
      data-testid={testId}
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span>Quick jump</span>
      {!compact && (
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground xl:inline">
          Ctrl+K
        </kbd>
      )}
    </button>
  );
}

/**
 * Shared Ctrl+K / Cmd+K quick-jump modal dialog for both server-rendered public pages and the
 * workspace browser app. Imports no identity SDK or API client so it stays safe as a public island.
 */
export function QuickFinderDialog({
  mode,
  extraItems = [],
  onOpenChange,
  onNavigate,
}: {
  mode: "public" | "workspace";
  extraItems?: readonly QuickFinderItem[];
  onOpenChange?: (open: boolean) => void;
  onNavigate?: (href: string, serverPage?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const base =
      mode === "workspace"
        ? [...WORKSPACE_QUICK_ITEMS, ...extraItems, ...PUBLIC_QUICK_ITEMS]
        : [...PUBLIC_QUICK_ITEMS, ...extraItems];
    // Deduplicate by href while keeping workspace entries ahead of public duplicates.
    const seen = new Set<string>();
    return base.filter((item) => {
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });
  }, [mode, extraItems]);

  const results = useMemo(() => filterQuickFinderItems(items, query).slice(0, 12), [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setQuery("");
      if (!dialog.open) dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  function choose(item: QuickFinderItem) {
    setOpen(false);
    if (onNavigate) {
      onNavigate(item.href, item.serverPage);
    } else {
      window.location.assign(basePath + item.href);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Quick jump"
      className="surface w-full max-w-xl overflow-hidden p-0 text-foreground backdrop:bg-foreground/35 backdrop:backdrop-blur-[2px]"
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      data-testid="dialog-quick-finder"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Jump to a page, action, document, or task"
          placeholder={
            mode === "workspace"
              ? "Jump to a page, document, task, or action…"
              : "Jump to a page, guide, or action…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
            } else if (e.key === "Enter" && results[activeIndex]) {
              e.preventDefault();
              choose(results[activeIndex]!);
            }
          }}
          data-testid="input-quick-finder"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm !min-h-8 !px-2"
          aria-label="Close quick jump"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-[60dvh] overflow-y-auto p-2">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
            No destinations match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <ul className="grid gap-1" aria-label="Quick jump results">
            {results.map((item, index) => {
              const active = index === activeIndex;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active ? "bg-secondary text-foreground" : "hover:bg-secondary/60",
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                    data-testid={"quick-item-" + item.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{item.label}</span>
                        <span className="rounded-full bg-background/80 px-2 py-0.5 text-[0.68rem] text-muted-foreground">
                          {item.group}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-sidebar/50 px-4 py-2 text-[0.72rem] text-muted-foreground">
        <span>Use ↑ ↓ to move, Enter to open, Esc to close.</span>
        <span>Shortcut: Ctrl+K</span>
      </div>
    </dialog>
  );
}
