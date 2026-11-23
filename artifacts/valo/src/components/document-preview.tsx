import type { CanonicalDocument } from "@workspace/api-client-react";
import { GUIDED_PREFIX, guidedRenderableBlocks } from "@workspace/valo-core/guided-runtime";
import { FIELD_LABELS } from "@/lib/api";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocPreview({
  title,
  content,
  revision,
}: {
  title: string;
  content: CanonicalDocument;
  revision: number;
}) {
  const accent = content.formatting.accent === "forest" ? "hsl(155 42% 21%)" : "hsl(30 8% 14%)";
  const f = content.fields;
  const guidedLayout = content.blocks.some((b) => b.id.startsWith(GUIDED_PREFIX));
  return (
    <article
      className={cn(
        "surface mx-auto min-w-0 w-full max-w-[46rem] px-7 py-10 shadow-[var(--shadow-lg)] sm:px-14 sm:py-14",
        content.formatting.font === "serif" ? "font-display" : "font-sans",
      )}
      style={{ overflowWrap: "anywhere" }}
      data-testid="preview-doc"
    >
      <div className="h-1 w-16 rounded-full" style={{ background: accent }} />
      <h2 className="mt-6 text-3xl leading-tight" style={{ color: accent }}>
        {title}
      </h2>
      {!guidedLayout && (
        <dl className="mt-6 grid gap-x-8 gap-y-2 font-sans text-sm sm:grid-cols-2">
          {(["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate"] as const).map((k) => (
            <div
              key={k}
              className="flex min-w-0 flex-wrap justify-between gap-3 border-b border-border py-1.5"
            >
              <dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt>
              <dd className={cn("min-w-0", f[k] ? "" : "italic text-[hsl(38_60%_35%)]")}>
                {(k === "issueDate" || k === "dueDate" ? formatDay(f[k]) : f[k]) || "Missing"}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-8 grid gap-4 text-[1.05rem] leading-relaxed">
        {guidedRenderableBlocks(content).map((b, index) =>
          b.type === "list" ? (
            <ul key={b.id} className="list-disc pl-6">
              {b.text
                .split("\n")
                .filter((l) => l.trim())
                .map((l, i) => (
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
                <tbody>
                  {b.rows.map((r, i) => (
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
          ) : b.text.trim() ? (
            <p key={b.id} className="whitespace-pre-wrap">
              {b.text}
            </p>
          ) : (
            <p key={b.id} className="font-sans text-sm italic text-muted-foreground">
              Empty paragraph
            </p>
          ),
        )}
      </div>
      {f.notes && (
        <p className="mt-8 whitespace-pre-wrap border-t border-border pt-4 font-sans text-sm text-muted-foreground">
          {f.notes}
        </p>
      )}
      <p className="mt-10 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        Draft · version {revision} · your own document, not reviewed
      </p>
    </article>
  );
}
