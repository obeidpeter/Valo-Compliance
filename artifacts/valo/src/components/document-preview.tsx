import type { CanonicalDocument } from "@workspace/api-client-react";
import type { FormText } from "@workspace/valo-core/form-text";
import { printedPage } from "@workspace/valo-core/printed-page";
import { finishedFileState } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The editor's preview: the document's printed page, drawn from the same description as its Word
 * file and its PDF (docs/architecture/editor.md, EDT-002). It shows what the file would print now:
 * the finished notice when the document is complete, the draft notice otherwise.
 */
export function DocPreview({
  title,
  content,
  revision,
  formText,
}: {
  title: string;
  content: CanonicalDocument;
  revision: number;
  /** A form document's released wording, which says whether every slot is filled. */
  formText?: FormText | null;
}) {
  const accent = content.formatting.accent === "forest" ? "hsl(var(--primary))" : "hsl(var(--foreground))";
  const finished = finishedFileState(content, formText) === "complete";
  const page = printedPage({ title, content }, revision, finished ? "business_finished" : "business_draft");
  return (
    <article
      className={cn(
        "surface mx-auto min-w-0 w-full max-w-[46rem] px-7 py-10 shadow-[var(--shadow-lg)] sm:px-14 sm:py-14",
        content.formatting.font === "serif" ? "font-display" : "font-sans",
      )}
      style={{ overflowWrap: "anywhere" }}
      data-testid="preview-doc"
    >
      <p
        className="rounded-xl border border-border px-4 py-3 font-sans text-xs leading-relaxed text-muted-foreground"
        data-testid="preview-notice"
      >
        {page.notice}
      </p>
      <div className="mt-6 h-1 w-16 rounded-full" style={{ background: accent }} />
      <h2 className="mt-6 text-3xl leading-tight" style={{ color: accent }}>
        {page.title}
      </h2>
      <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        {page.savedLine}
      </p>
      {page.fields.length > 0 && (
        <dl className="mt-6 grid gap-x-8 gap-y-2 font-sans text-sm sm:grid-cols-2">
          {page.fields.map((field) => (
            <div
              key={field.name}
              className="flex min-w-0 flex-wrap justify-between gap-3 border-b border-border py-1.5"
            >
              <dt className="text-muted-foreground">{field.name}</dt>
              <dd
                className={cn(
                  "min-w-0 whitespace-pre-wrap",
                  field.supplied ? "" : "italic text-[hsl(var(--ochre-foreground))]",
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-8 grid gap-4 text-[1.05rem] leading-relaxed">
        {page.blocks.map((b, index) =>
          b.type === "heading" ? (
            // The document's title is this page's second-level heading, so a form's own headings
            // sit one level below it.
            b.level === 3 ? (
              <h4 key={b.id} className="mt-2 font-semibold">
                {b.text}
              </h4>
            ) : (
              <h3 key={b.id} className="mt-4 text-xl font-semibold leading-snug" style={{ color: accent }}>
                {b.text}
              </h3>
            )
          ) : b.type === "list" ? (
            <ul key={b.id} className="list-disc pl-6">
              {b.text.split("\n").map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : b.type === "table" ? (
            <div
              key={b.id}
              className="preview-table min-w-0 overflow-x-auto"
              role="region"
              aria-label={"Document table " + (index + 1)}
              tabIndex={0}
            >
              <table className="w-full min-w-[30rem] table-fixed border-collapse font-sans text-sm">
                {b.headerRows && b.rows.length > 0 && (
                  <thead>
                    <tr>
                      {b.rows[0]!.map((c, j) => (
                        <th
                          key={j}
                          scope="col"
                          className="border border-border bg-sidebar px-2.5 py-1.5 text-left font-semibold"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {(b.headerRows ? b.rows.slice(1) : b.rows).map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className="border border-border px-2.5 py-1.5">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            // An empty paragraph prints nothing, as in the files; it keeps its line.
            <p key={b.id} className="min-h-[1.5em] whitespace-pre-wrap">
              {b.text}
            </p>
          ),
        )}
      </div>
    </article>
  );
}
