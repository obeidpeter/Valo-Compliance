import { useRef, useState } from "react";
import { Download } from "lucide-react";
import type { OwnedCheckoutDownload } from "@workspace/api-client-react";
import { formatCount } from "@/lib/format";
import { basePath } from "@/lib/env";

export function OwnedChoice({ file }: { file: OwnedCheckoutDownload }) {
  return (
    <li className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold">{file.title}</h3>
      <p className="my-3 text-sm">Your workspace owns this edition.</p>
      <div className="flex flex-wrap gap-2">
        <a href={basePath + file.downloadPath} className="btn btn-primary" data-testid="checkout-download">
          <Download className="h-4 w-4" aria-hidden /> {file.pdfDownloadPath ? "Download Word" : "Download"}
        </a>
        {file.pdfDownloadPath && (
          <a
            href={basePath + file.pdfDownloadPath}
            className="btn btn-secondary"
            data-testid="checkout-download-pdf"
          >
            <Download className="h-4 w-4" aria-hidden /> Download PDF
          </a>
        )}
      </div>
    </li>
  );
}

export function MyTemplates({ editions }: { editions: ReadonlyMap<string, OwnedCheckoutDownload> }) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const files = [...editions.values()]
    .filter((file) => file.title.toLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title, "en-NG") || a.edition.localeCompare(b.edition));
  return (
    <section className="mb-8" aria-labelledby="my-templates">
      <h2 id="my-templates" className="font-display mb-4 text-2xl">
        My Templates
      </h2>
      <div className="mb-4 max-w-xl">
        <label className="label" htmlFor="owned-template-search">
          Search by title
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={searchInput}
            id="owned-template-search"
            type="search"
            autoComplete="off"
            className="field min-w-0 flex-1 [&::-webkit-search-cancel-button]:hidden"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => {
                setSearch("");
                searchInput.current?.focus();
              }}
            >
              Clear search
            </button>
          )}
        </div>
      </div>
      <p
        role="status"
        className={files.length ? "sr-only" : "rounded-2xl border bg-card p-5 text-sm text-muted-foreground"}
      >
        {!editions.size
          ? "Your workspace has no premium templates available to download."
          : !files.length
            ? "No owned editions match your search."
            : `${formatCount(files.length)} ${files.length === 1 ? "edition" : "editions"} available to download.`}
      </p>
      {files.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => (
            <li
              key={file.edition}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4"
            >
              <h3 className="min-w-0 break-words font-semibold">{file.title}</h3>
              <div className="flex flex-wrap gap-2">
                <a
                  href={basePath + file.downloadPath}
                  aria-label={`Download ${file.title}`}
                  className="btn btn-secondary shrink-0"
                >
                  <Download className="h-4 w-4" aria-hidden />{" "}
                  {file.pdfDownloadPath ? "Download Word" : "Download"}
                </a>
                {file.pdfDownloadPath && (
                  <a
                    href={basePath + file.pdfDownloadPath}
                    aria-label={`Download ${file.title} PDF`}
                    className="btn btn-secondary shrink-0"
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download PDF
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
