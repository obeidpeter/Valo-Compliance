import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowRightLeft,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react";
import {
  useCreateDocument,
  useListDocuments,
  useListWorkspaceExports,
  getGetWorkspaceQueryKey,
  getListDocumentsQueryKey,
  getListWorkspaceExportsQueryKey,
  type BusinessDocument,
} from "@workspace/api-client-react";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { missingFields } from "@/lib/api";
import { anotherLike } from "@/lib/document-copy";
import {
  availableConversions,
  convertGuidedDocument,
  type ConversionTargetId,
} from "@/lib/document-conversions";
import {
  documentContextSubtitle,
  documentKindLabel,
  documentKindOptions,
  filterDocuments,
  readHiddenDocumentIds,
  writeHiddenDocumentIds,
  type DocumentStatusFilter,
} from "@/lib/document-list-helpers";
import { FILE_FORMAT_NAMES } from "@/lib/file-formats";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The workspace's documents, most recently saved first: each opens its editor. `limit` shows only
 * the first few, as the home screen does; the documents screen shows them all. With none, it leads
 * to the page where a document starts.
 */
export function DocumentList({
  enabled,
  limit,
  searchable = false,
}: {
  /** Whether the workspace is known, so the list may be read. */
  enabled: boolean;
  limit?: number;
  /** Show a title search box when the workspace has more than one saved document. */
  searchable?: boolean;
}) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const docs = useListDocuments({ query: { enabled, queryKey: getListDocumentsQueryKey() } });
  const exportsList = useListWorkspaceExports({
    query: { enabled: enabled && searchable, queryKey: getListWorkspaceExportsQueryKey() },
  });
  const createCopy = useCreateDocument();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DocumentStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchable) setHiddenIds(readHiddenDocumentIds());
  }, [searchable]);
  const all = useMemo(() => docs.data ?? [], [docs.data]);
  const kindOptions = useMemo(() => (searchable ? documentKindOptions(all) : []), [all, searchable]);
  const hiddenCount = useMemo(
    () => (searchable ? all.filter((d) => hiddenIds.has(d.id)).length : 0),
    [all, hiddenIds, searchable],
  );
  const readyExportByDoc = useMemo(() => {
    const map = new Map<string, NonNullable<typeof exportsList.data>[number]>();
    for (const file of exportsList.data ?? []) {
      if (!map.has(file.documentId)) map.set(file.documentId, file);
    }
    return map;
  }, [exportsList.data]);
  const trimmed = query.trim();
  const shown = useMemo(() => {
    const filtered = searchable ? filterDocuments(all, query, status, hiddenIds, kindFilter) : all;
    return filtered.slice(0, limit);
  }, [all, hiddenIds, kindFilter, limit, query, searchable, status]);
  const showSearch = searchable && (all.length > 1 || hiddenCount > 0);
  useEffect(() => {
    if (!showSearch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch]);
  const hasFilter = Boolean(trimmed || status !== "all" || kindFilter !== "all");
  const STATUS_FILTERS: { id: DocumentStatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "incomplete", label: "Needs details" },
    { id: "complete", label: "Complete" },
    ...(hiddenCount > 0 || status === "hidden"
      ? [{ id: "hidden" as const, label: `Hidden (${hiddenCount})` }]
      : []),
  ];

  function toggleHidden(docId: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      writeHiddenDocumentIds(next);
      return next;
    });
  }

  function makeAnotherFromList(d: BusinessDocument) {
    const start = anotherLike(d.content);
    if (!start || createCopy.isPending) return;
    setBusyAction("copy:" + d.id);
    createCopy.mutate(
      { data: { title: d.title, content: start } },
      {
        onSuccess: (made) => {
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          setLocation("/workspace/documents/" + made.id);
        },
        onSettled: () => setBusyAction(null),
      },
    );
  }

  function convertFromList(d: BusinessDocument, targetId: ConversionTargetId) {
    const converted = convertGuidedDocument(d.content, targetId);
    if (!converted || createCopy.isPending) return;
    setBusyAction(`convert:${d.id}:${targetId}`);
    createCopy.mutate(
      { data: converted },
      {
        onSuccess: (made) => {
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          setLocation("/workspace/documents/" + made.id);
        },
        onSettled: () => setBusyAction(null),
      },
    );
  }
  return (
    <>
      {docs.isLoading ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <Skel key={i} className="h-24" />
          ))}
        </div>
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
      ) : all.length > 0 ? (
        <>
          {showSearch && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  className="field !pl-10"
                  aria-label="Search your documents by title, recipient, or reference"
                  aria-keyshortcuts="/"
                  placeholder="Search title, recipient, or ref (press /)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="input-document-search"
                />
              </div>
              <div
                role="group"
                aria-label="Filter documents by completeness"
                className="inline-flex rounded-full border border-border bg-card p-1"
              >
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={status === f.id}
                    onClick={() => setStatus(f.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      status === f.id
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={"filter-documents-" + f.id}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {hasFilter && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                    setKindFilter("all");
                  }}
                  data-testid="button-clear-document-search"
                >
                  <X className="h-4 w-4" aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          )}
          {showSearch && kindOptions.length > 1 && (
            <div
              className="mb-4 flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filter documents by type"
              data-testid="bar-document-kinds"
            >
              {["all", ...kindOptions].map((k) => {
                const active = kindFilter === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setKindFilter(k)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                    data-testid={
                      "filter-doc-kind-" + (k === "all" ? "all" : k.toLowerCase().replace(/\s+/g, "-"))
                    }
                  >
                    {k === "all" ? "All types" : k}
                  </button>
                );
              })}
            </div>
          )}
          {status === "hidden" && (
            <p className="mb-4 text-xs text-muted-foreground" role="status">
              Hidden documents stay saved in your workspace; hiding only declutters this browser view.
            </p>
          )}
          {shown.length > 0 ? (
            <ul className="grid gap-3">
              {shown.map((d) => {
                const miss = missingFields(d.content).length;
                const kind = documentKindLabel(d);
                const subtitle = documentContextSubtitle(d);
                const readyExport = readyExportByDoc.get(d.id);
                const canCopy = searchable && Boolean(anotherLike(d.content));
                const conversions = searchable ? availableConversions(d.content) : [];
                const isHidden = hiddenIds.has(d.id);
                return (
                  <li
                    key={d.id}
                    className="surface overflow-hidden transition-shadow hover:shadow-[var(--shadow-md)]"
                  >
                    <Link
                      href={"/workspace/documents/" + d.id}
                      className="group flex items-center gap-4 p-5 sm:gap-5"
                      data-testid={"link-doc-" + d.id}
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                        <FileText className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.title}</span>
                        {subtitle && (
                          <span
                            className="mt-0.5 block truncate text-xs text-foreground/75"
                            data-testid={"text-doc-subtitle-" + d.id}
                          >
                            {subtitle}
                          </span>
                        )}
                        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{kind}</span>
                          <span>Draft</span>
                          <span>Version {d.revision}</span>
                          <span>Saved {formatDateTime(d.updatedAt)}</span>
                        </span>
                        {miss > 0 && (
                          <span className="pill pill-ochre mt-2 inline-flex sm:hidden">
                            {miss === 1 ? "1 detail missing" : `${miss} details missing`}
                          </span>
                        )}
                      </span>
                      {miss > 0 && (
                        <span className="pill pill-ochre hidden shrink-0 sm:inline-flex">
                          {miss === 1 ? "1 detail missing" : `${miss} details missing`}
                        </span>
                      )}
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                    {searchable && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-sidebar/30 px-5 py-2.5 text-xs">
                        {readyExport && (
                          <a
                            href={readyExport.downloadUrl}
                            className="btn btn-ghost btn-sm !min-h-8 !px-3 text-xs"
                            data-testid={"link-quick-download-" + d.id}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            Download {FILE_FORMAT_NAMES[readyExport.format]}
                          </a>
                        )}
                        {canCopy && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm !min-h-8 !px-3 text-xs"
                            disabled={createCopy.isPending}
                            onClick={() => makeAnotherFromList(d)}
                            data-testid={"button-quick-copy-" + d.id}
                          >
                            {busyAction === "copy:" + d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Make another
                          </button>
                        )}
                        {conversions.map((opt) => (
                          <button
                            key={opt.targetId}
                            type="button"
                            className="btn btn-ghost btn-sm !min-h-8 !px-3 text-xs"
                            disabled={createCopy.isPending}
                            onClick={() => convertFromList(d, opt.targetId)}
                            data-testid={`button-quick-convert-${d.id}-${opt.targetId}`}
                          >
                            {busyAction === `convert:${d.id}:${opt.targetId}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {opt.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm ml-auto !min-h-8 !px-3 text-xs text-muted-foreground"
                          onClick={() => toggleHidden(d.id)}
                          data-testid={"button-toggle-hide-" + d.id}
                        >
                          {isHidden ? (
                            <>
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Show in list
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Hide
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="surface p-6 text-sm text-muted-foreground" role="status">
              <p>
                {trimmed
                  ? `No saved documents match "${trimmed}" in this view.`
                  : "No saved documents match this filter."}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-3"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setKindFilter("all");
                }}
              >
                Show all documents
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          mark={<FilePlus2 className="h-5 w-5 text-muted-foreground" />}
          title="No documents yet"
          action={
            <Link
              href="/workspace/documents/new"
              className="btn btn-primary"
              data-testid="link-first-document"
            >
              New document
            </Link>
          }
        >
          Start with an invoice, a quotation or another everyday document, or with a blank page.
        </EmptyState>
      )}
    </>
  );
}
