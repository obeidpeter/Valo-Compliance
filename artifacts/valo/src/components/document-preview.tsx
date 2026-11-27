import { Fragment } from "react";
import type { CanonicalDocument } from "@workspace/api-client-react";
import type { FormText } from "@workspace/valo-core/form-text";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_PREFIX } from "@workspace/valo-core/guided-runtime";
import { compileForm, type FormPiece } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";
import { printedPage, type PrintedBlock } from "@workspace/valo-core/printed-page";
import { finishedFileState } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Where each answer sits in a form document's wording (forms v2), worked out again from its released
 * text and its answers: by block, rows of cells of pieces. Null for any other document. Nothing about
 * it is saved (docs/architecture/editor.md, slice 4).
 */
function answerPlaces(content: CanonicalDocument, formText?: FormText | null) {
  const answers = content.formAnswers as GuidedDataV2 | undefined;
  const spec = answers ? GUIDED_SPECS_V2[answers.templateId as GuidedTemplateId] : undefined;
  return spec && formText && answers ? compileForm(spec, formText, answers).pieces : null;
}
const textOf = (pieces: readonly FormPiece[]) => pieces.map((piece) => piece.text).join("");
/** A text with the customer's answers marked in it, while its pieces are this very text. */
function Marked({ pieces, text }: { pieces: readonly FormPiece[] | undefined; text: string }) {
  if (!pieces || textOf(pieces) !== text) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, i) =>
        piece.answer ? (
          <mark
            key={i}
            className="rounded-sm border-b border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-0.5 text-inherit"
            data-testid="preview-answer"
          >
            {piece.text}
          </mark>
        ) : (
          <Fragment key={i}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}
/** A block made by a form's questions (v1): its text comes from the customer's answers. */
const fromAnswers = (block: PrintedBlock | undefined) => Boolean(block?.id.startsWith(GUIDED_PREFIX));

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
  const places = answerPlaces(content, formText);
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
      <p
        className="mt-1.5 font-sans text-[0.7rem] text-muted-foreground"
        data-preview-mark
        data-testid="preview-notice-mark"
      >
        Added by Valo to every page of the file. It cannot be removed.
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
        {page.blocks.map((b, index) => {
          const cells = places?.[b.id];
          const drawn =
            b.type === "heading" ? (
              // The document's title is this page's second-level heading, so a form's own headings
              // sit one level below it.
              b.level === 3 ? (
                <h4 className="mt-2 font-semibold">
                  <Marked pieces={cells?.[0]?.[0]} text={b.text} />
                </h4>
              ) : (
                <h3 className="mt-4 text-xl font-semibold leading-snug" style={{ color: accent }}>
                  <Marked pieces={cells?.[0]?.[0]} text={b.text} />
                </h3>
              )
            ) : b.type === "list" ? (
              <ul className="list-disc pl-6">
                {b.text.split("\n").map((l, i) => (
                  <li key={i}>
                    <Marked pieces={cells?.[i]?.[0]} text={l} />
                  </li>
                ))}
              </ul>
            ) : b.type === "table" ? (
              <div
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
                            <Marked pieces={cells?.[0]?.[j]} text={c} />
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
                            <Marked pieces={cells?.[b.headerRows ? i + 1 : i]?.[j]} text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              // An empty paragraph prints nothing, as in the files; it keeps its line.
              <p className="min-h-[1.5em] whitespace-pre-wrap">
                {b.text.split("\n").map((l, i) => (
                  <Fragment key={i}>
                    {i ? "\n" : ""}
                    <Marked pieces={cells?.[i]?.[0]} text={l} />
                  </Fragment>
                ))}
              </p>
            );
          // A block made by a form's questions says so; the customer's own blocks are left unmarked.
          return fromAnswers(b) ? (
            <div
              key={b.id}
              className="border-l-2 border-[hsl(var(--forest-border))] pl-3"
              data-testid="preview-from-answers"
            >
              {!fromAnswers(page.blocks[index - 1]) && (
                <p className="mb-1 font-sans text-xs text-muted-foreground" data-preview-mark>
                  From your answers
                </p>
              )}
              {drawn}
            </div>
          ) : (
            <Fragment key={b.id}>{drawn}</Fragment>
          );
        })}
      </div>
    </article>
  );
}
