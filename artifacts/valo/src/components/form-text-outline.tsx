import type { ReactNode } from "react";
import {
  FormTextError,
  parseFormText,
  type FormInline,
  type FormNode,
  type FormSpan,
} from "@workspace/valo-core/form-text";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";

/**
 * A staff preview of a template's form text (forms v2): its wording as the form fills it, with each
 * placeholder the form fills marked, and each passage kept only for an answer shown with the answer
 * it is kept for. Customers never read form text itself: their documents are made from it.
 */
export function FormTextOutline({ source, templateId }: { source: string; templateId: string | null }) {
  let text;
  try {
    text = parseFormText(source);
  } catch (error) {
    if (!(error instanceof FormTextError)) throw error;
    return (
      <p className="text-sm text-destructive" role="alert">
        The form text cannot be read at line {error.line}: {error.reason}.
      </p>
    );
  }
  const spec = templateId ? GUIDED_SPECS_V2[templateId as GuidedTemplateId] : undefined;
  const question = (id: string) => spec?.fields.find((f) => f.id === id);
  const table = (id: string) => spec?.tables.find((t) => t.id === id)?.label ?? id;
  const condition = (span: FormSpan) => {
    const label = `“${question(span.question)?.label ?? span.question}”`;
    if (span.option === null) return `Only once ${label} is answered`;
    if (span.option === "") return `Only while ${label} is unanswered`;
    const option = question(span.question)?.options?.find((o) => o.value === span.option)?.label;
    return `Only when ${label} is “${option ?? span.option}”`;
  };
  const note = (words: string) => <span className="text-xs text-muted-foreground">[{words}] </span>;
  const inline = (parts: FormInline[]): ReactNode =>
    parts.map((part, i) =>
      part.kind === "text" ? (
        <span key={i}>{part.text}</span>
      ) : part.kind === "slot" ? (
        <mark key={i} className="rounded bg-[hsl(var(--ochre-soft))] px-0.5" title={part.name}>
          {part.placeholder}
        </mark>
      ) : (
        <span key={i} className="rounded border border-dashed border-border px-1">
          {note(condition(part.span))}
          {inline(part.parts)}
        </span>
      ),
    );
  const blocks = (nodes: FormNode[]): ReactNode =>
    nodes.map((node, i) => {
      if (node.kind === "span" || node.kind === "repeat")
        return (
          <div key={i} className="grid gap-2 rounded-lg border border-dashed border-border p-2">
            <p className="text-xs text-muted-foreground">
              {node.kind === "span"
                ? condition(node.span)
                : `Printed once for each row of “${table(node.table)}”`}
            </p>
            {blocks(node.nodes)}
          </div>
        );
      if (node.kind === "heading")
        return node.level === 2 ? (
          <h4 key={i} className="font-display text-lg">
            {inline(node.parts)}
          </h4>
        ) : (
          <h5 key={i} className="font-medium">
            {inline(node.parts)}
          </h5>
        );
      if (node.kind === "paragraph")
        return (
          <p key={i}>
            {node.lines.map((line, j) => (
              <span key={j} className="block">
                {inline(line)}
              </span>
            ))}
          </p>
        );
      if (node.kind === "list")
        return (
          <ul key={i} className="list-disc pl-6">
            {node.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        );
      return (
        <div key={i} className="overflow-x-auto" role="region" aria-label="Form text table" tabIndex={0}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {node.header.map((cell, j) => (
                  <th key={j} className="border border-border px-2 py-1 text-left">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, j) => (
                <tr key={j}>
                  {row.cells.map((cell, k) => (
                    <td key={k} className="border border-border px-2 py-1">
                      {k === 0 && row.repeat && note(`Each row of “${table(row.repeat)}”`)}
                      {k === 0 && row.span && note(condition(row.span))}
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    });
  return (
    <div className="grid gap-3 text-sm" data-testid="form-text-outline">
      <h4 className="font-display text-xl">{text.title}</h4>
      {blocks(text.nodes)}
    </div>
  );
}
