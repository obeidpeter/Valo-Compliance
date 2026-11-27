import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "./states";
import { findLibraryEntries, supportCaseKeys } from "@/lib/support-case-api";
import { chooseLegend, entryLine, findButton, findHint, findLabel, noEntries } from "@/lib/library-referrals";

/**
 * Support staff choose the staff-library entry a referral points at, by words of its title
 * (docs/architecture/library-holds.md, slice 3). Only published entries are listed, and the choice is the
 * version published now. A new search clears the choice, so a referral never points at an entry that is
 * not shown.
 */
export function LibraryEntryChooser({
  value,
  onChoose,
  disabled,
}: {
  value: string;
  onChoose: (editionId: string) => void;
  disabled: boolean;
}) {
  const [words, setWords] = useState("");
  const [searched, setSearched] = useState("");
  const found = useQuery({
    queryKey: supportCaseKeys.libraryEntries(searched),
    queryFn: ({ signal }) => findLibraryEntries(searched, signal),
    enabled: searched.length >= 2,
    retry: false,
  });
  const ready = words.trim().length >= 2;
  function search() {
    if (!ready || disabled) return;
    onChoose("");
    setSearched(words.trim());
  }
  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-2">
        <label htmlFor="support-library-words">{findLabel}</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="support-library-words"
            type="search"
            className="field min-w-0 flex-1"
            value={words}
            maxLength={100}
            autoComplete="off"
            disabled={disabled}
            aria-describedby="support-library-words-hint"
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              // Enter finds entries here; it does not send the referral.
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!ready || disabled}
            onClick={search}
          >
            {findButton}
          </button>
        </div>
        <p id="support-library-words-hint" className="text-xs text-muted-foreground">
          {findHint}
        </p>
      </div>
      {found.isFetching && <p role="status">Finding entries…</p>}
      {found.isError && <ErrorState error={found.error} onRetry={() => void found.refetch()} />}
      {found.data && !found.isFetching && !found.data.entries.length && <p role="status">{noEntries}</p>}
      {!!found.data?.entries.length && (
        <fieldset className="grid gap-2" disabled={disabled}>
          <legend className="font-medium">{chooseLegend}</legend>
          {found.data.entries.map((entry) => (
            <label key={entry.editionId} className="flex items-start gap-2 [overflow-wrap:anywhere]">
              <input
                type="radio"
                name="support-library-entry"
                value={entry.editionId}
                checked={value === entry.editionId}
                onChange={() => onChoose(entry.editionId)}
              />
              {entryLine(entry)}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
