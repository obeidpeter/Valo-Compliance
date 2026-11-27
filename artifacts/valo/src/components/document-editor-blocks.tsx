import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudOff,
  List,
  Loader2,
  Pilcrow,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import type { DocumentBlock, DocumentBlockType } from "@workspace/api-client-react";
import { FINANCIAL_BLOCK_IDS } from "@/components/financial-fields";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict" | "blocked";

/** What each part of a document's own text is called. */
const BLOCK_NAMES: Record<DocumentBlockType, string> = {
  paragraph: "Paragraph",
  list: "List",
  table: "Table",
  heading: "Heading",
};

export function SaveIndicator({
  state,
  rev,
  onRetry,
}: {
  state: SaveState;
  rev: number;
  onRetry: () => void;
}) {
  const map: Record<SaveState, [string, string]> = {
    idle: ["", ""],
    dirty: ["Unsaved changes", "pill-ochre"],
    saving: ["Saving", "pill-ink"],
    saved: ["Saved · version " + rev, "pill-forest"],
    error: ["Not saved", "pill-ochre"],
    conflict: ["Not saved — changed somewhere else", "pill-ochre"],
    blocked: ["Needs a title to save", "pill-ochre"],
  };
  const [text, cls] = map[state];
  if (!text) return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className={"pill " + cls} data-testid="status-save">
        {state === "saving" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === "saved" ? (
          <Check className="h-3 w-3" />
        ) : state === "error" ? (
          <CloudOff className="h-3 w-3" />
        ) : (
          <span className="dot" />
        )}
        {text}
      </span>
      {state === "error" && (
        <button className="text-sm underline" onClick={onRetry} data-testid="button-retry-save">
          Retry
        </button>
      )}
    </div>
  );
}

/** A table with its first row marked as its heading row, which the files repeat at the top of each
 * page, or with the mark taken off (docs/architecture/editor.md). */
export function withHeadingRow(block: DocumentBlock, heading: boolean): DocumentBlock {
  const { headerRows: _headerRows, ...rest } = block;
  return heading ? { ...rest, headerRows: 1 } : rest;
}

export function BlockEditor({
  block,
  index,
  count,
  onChange,
  onMove,
  onDelete,
}: {
  block: DocumentBlock;
  index: number;
  count: number;
  onChange: (b: DocumentBlock) => void;
  onMove: (d: -1 | 1) => void;
  onDelete: () => void;
}) {
  const Icon = block.type === "list" ? List : block.type === "table" ? Table2 : Pilcrow;
  const locked = FINANCIAL_BLOCK_IDS.includes(block.id);
  if (locked) {
    return (
      <li className="rounded-xl border border-dashed border-border p-3" data-testid={"block-" + index}>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Table2 className="h-3.5 w-3.5" />
          {block.text || "Financial table"} · change it in Financial details above
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "font-medium" : ""}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-border px-2.5 py-1.5 tabular-nums">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </li>
    );
  }
  return (
    <li
      className="group relative rounded-xl border border-transparent p-1 transition-colors focus-within:border-border hover:border-border"
      data-testid={"block-" + index}
    >
      <div className="mb-1 flex items-center justify-between px-2 pt-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {BLOCK_NAMES[block.type]}
        </span>
        <span className="flex gap-1 opacity-80 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-65">
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </IconBtn>
          <IconBtn label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </IconBtn>
          <IconBtn
            label={"Delete this " + BLOCK_NAMES[block.type].toLowerCase()}
            disabled={count === 1}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconBtn>
        </span>
      </div>
      {block.type === "table" ? (
        <div className="overflow-x-auto px-1 pb-1">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={ri === 0 && block.headerRows === 1 ? "font-medium" : undefined}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border p-0">
                      <input
                        aria-label={"Row " + (ri + 1) + " column " + (ci + 1)}
                        className="w-full bg-transparent px-2.5 py-2 outline-none focus:bg-accent/50"
                        maxLength={1000}
                        value={cell}
                        onChange={(e) =>
                          onChange({
                            ...block,
                            rows: block.rows.map((r, x) =>
                              x === ri ? r.map((c, y) => (y === ci ? e.target.value : c)) : r,
                            ),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button
              className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
              disabled={block.rows.length >= 100}
              onClick={() =>
                onChange({ ...block, rows: [...block.rows, block.rows[0]?.map(() => "") ?? [""]] })
              }
            >
              <Plus className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
              Add a row
            </button>
            <button
              className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
              disabled={(block.rows[0]?.length ?? 0) >= 10}
              onClick={() => onChange({ ...block, rows: block.rows.map((r) => [...r, ""]) })}
            >
              <Plus className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
              Add a column
            </button>
          </div>
          <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(155_42%_21%)]"
              checked={block.headerRows === 1}
              onChange={(e) => onChange(withHeadingRow(block, e.target.checked))}
              data-testid={"checkbox-heading-row-" + index}
            />
            First row is a heading
          </label>
        </div>
      ) : (
        <textarea
          aria-label={block.type === "list" ? "List items, one per line" : "Paragraph"}
          className="min-h-24 w-full resize-y rounded-lg bg-transparent px-2.5 py-2 leading-relaxed outline-none focus:bg-background"
          maxLength={8000}
          value={block.text}
          placeholder={block.type === "list" ? "One item per line" : "Write in your own words"}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          data-testid={"input-block-" + index}
        />
      )}
    </li>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-30"
    >
      {children}
    </button>
  );
}
