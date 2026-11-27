import { useState } from "react";
import {
  useListManualLibrary,
  type ManualLibraryDraft,
  type ManualLibraryRevision,
} from "@workspace/api-client-react";

const kindNames: Partial<Record<ManualLibraryDraft["kind"], string>> = {
  practical_guide: "Practical guide",
  industry_introduction: "Industry introduction",
  industry_pack: "Industry pack",
  regulatory_article: "Regulatory article",
};
/** A related guide's title and kind; whether it is published is known once the draft is saved. */
type Known = Pick<ManualLibraryRevision["relatedGuides"][number], "title" | "kind"> & { live?: boolean };

/**
 * A template's related guides, as an editor chooses them (docs/architecture/library-entries.md): up to
 * six library items, each a guide or an article, found by title. A reader sees each one only while a
 * version of it is released.
 */
export function RelatedGuidesPicker({
  value,
  known,
  onChange,
}: {
  value: readonly string[];
  known: ManualLibraryRevision["relatedGuides"];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<Record<string, Known>>(() =>
    Object.fromEntries(known.map(({ itemId, ...rest }) => [itemId, rest])),
  );
  const q = query.trim();
  const search = useListManualLibrary(
    { page: 1, ...(q ? { q } : {}) },
    { query: { enabled: q.length >= 2, retry: false } },
  );
  const found = (search.data?.items ?? [])
    .filter((item) => kindNames[item.kind] && !value.includes(item.itemId))
    .slice(0, 8);
  const name = (itemId: string) => names[itemId] ?? known.find((entry) => entry.itemId === itemId);
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-3" data-testid="related-guides-picker">
      <legend className="px-1 text-sm font-medium">Related guides (optional)</legend>
      <p className="text-sm text-muted-foreground">
        Up to six guides or articles a reader may find useful with this template. Readers see each one only
        while it is published.
      </p>
      {value.length > 0 && (
        <ul className="grid gap-1 text-sm" data-testid="list-related-chosen">
          {value.map((itemId) => {
            const entry = name(itemId);
            return (
              <li key={itemId} className="flex flex-wrap items-center gap-2">
                <span>{entry?.title ?? "A guide not filed here yet"}</span>
                {entry?.kind && kindNames[entry.kind] && (
                  <span className="text-muted-foreground">· {kindNames[entry.kind]}</span>
                )}
                {entry?.title && entry.live === false && (
                  <span className="text-muted-foreground">· not published</span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(value.filter((id) => id !== itemId))}
                  aria-label={`Remove ${entry?.title ?? "this guide"} from the related guides`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {value.length < 6 && (
        <label className="text-sm font-medium">
          Find a guide by its title
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base"
            type="search"
            value={query}
            maxLength={140}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="input-related-search"
          />
        </label>
      )}
      {value.length < 6 && found.length > 0 && (
        <ul className="grid gap-1 text-sm" data-testid="list-related-found">
          {found.map((item) => (
            <li key={item.itemId}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setNames({ ...names, [item.itemId]: { title: item.title, kind: item.kind } });
                  onChange([...value, item.itemId]);
                  setQuery("");
                }}
              >
                Add “{item.title}” · {kindNames[item.kind]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
