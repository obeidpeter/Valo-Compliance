import { useState } from "react";
import {
  actOnManualLibrary,
  getManualLibraryRevision,
  recordManualLibraryReview,
  holdManualLibraryEntry,
  previewManualLibraryFile,
  saveManualLibraryDraft,
  useGetPublicCoverage,
  useListManualLibrary,
  type ListManualLibraryParams,
  type ManualLibraryDraft,
  type ManualLibraryEntryState,
  type ManualLibraryRevision,
} from "@workspace/api-client-react";
import { libraryTemplateStatement } from "@workspace/valo-core/library-statement";
import { describeError } from "@/lib/describe-error";
import { industryName } from "@/lib/library-filters";
import {
  dueFilterLabel,
  isOverdue,
  reviewLine,
  reviewNoteHint,
  reviewNoteLabel,
  reviewRecorded,
  reviewStatus,
} from "@/lib/library-review";
import { changeHint, changeLabel } from "@/lib/library-change";
import { reachLine, toldLine, withdrawalHelp } from "@/lib/library-reach";
import {
  heldLine,
  heldMark,
  heldMessage,
  holdHint,
  holdLabel,
  liftHint,
  liftLabel,
  liftedMessage,
  ownerLiftsWords,
} from "@/lib/library-holds";
import {
  actionEvidenceHelp,
  actionEvidenceLabel,
  appliesToHelp,
  appliesToLabel,
  draftLinesNote,
  editorMissingScope,
  recordHint,
  recordLegend,
  relatedTemplatesHelp,
  relatedTemplatesLabel,
  templateNumbers,
} from "@/lib/guidance-record";
import { FormTextOutline } from "./form-text-outline";
import { RelatedGuidesPicker } from "./related-guides-picker";
import { PlainText } from "./resource-parts";
import { ErrorState } from "./states";

const kinds: Record<ManualLibraryDraft["kind"], string> = {
  practical_guide: "Practical guide",
  industry_introduction: "Industry introduction",
  industry_pack: "Industry pack",
  template: "Free template",
  premium_template: "Premium template",
  regulatory_article: "Regulatory article",
};
/** An introduction and an industry pack each belong to one industry. */
const industryRequired = (kind: ManualLibraryDraft["kind"]) =>
  kind === "industry_introduction" || kind === "industry_pack";
const isTemplate = (kind: ManualLibraryDraft["kind"]) => kind === "template" || kind === "premium_template";
/** How a saved version's form text fits its template's fill-in form, in plain words. */
function fitSummary(fit: NonNullable<ManualLibraryRevision["formFit"]>) {
  switch (fit.state) {
    case "fits":
      return "This form text fits the template's fill-in form: every question has its place, and every placeholder is filled by an answer or left for completing by hand.";
    case "does_not_fit":
      return "This form text does not fit the template's fill-in form yet. The form will not use this version until it does:";
    case "no_form":
      return "The fill-in form for this template does not use form text yet, so this text waits for it.";
    case "no_template":
      return "No registered template has this title, so no fill-in form uses this text.";
  }
}
const inputStyle = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base";
const emptyForm = () => ({
  itemId: crypto.randomUUID() as string,
  title: "",
  kind: "practical_guide" as ManualLibraryDraft["kind"],
  industry: "",
  body: "",
  formText: "",
  fileMode: "text" as ManualLibraryDraft["fileMode"],
  // A template's entry details (docs/architecture/library-entries.md).
  purpose: "",
  needs: "",
  limits: "",
  relatedItems: [] as string[],
  aiDrafted: "" as "" | "yes" | "no",
  // A regulatory article's record (docs/architecture/guidance-record.md). The template numbers are
  // typed as one line.
  appliesTo: "",
  actionEvidence: "",
  relatedTemplates: "",
});
async function encodeFile(file: File) {
  const format = file.name.split(".").pop()?.toLowerCase();
  if (format !== "docx" && format !== "pdf") throw new Error("Choose a Word (.docx) or PDF file.");
  if (!file.size || file.size > 2097152) throw new Error("Choose a nonempty file of up to 2 MB.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be opened."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.readAsDataURL(file);
  });
  return { format, base64 } as NonNullable<ManualLibraryDraft["upload"]>;
}
/**
 * A saved template version's entry details as readers will see them (docs/architecture/library-entries.md),
 * and what it still needs before it can be published.
 */
/** A saved regulatory article's record, which the owner signs with its text
 * (docs/architecture/guidance-record.md), and whether it says whom the article applies to yet. */
function GuidanceRecordPreview({ revision }: { revision: ManualLibraryRevision }) {
  return (
    <section
      className="mt-5 grid gap-2 rounded-xl border border-border p-4 text-sm"
      aria-label={recordLegend}
      data-testid="preview-guidance-record"
    >
      <p className="eyebrow">{recordLegend}</p>
      <p className="font-medium">{appliesToLabel}</p>
      <p>{revision.appliesTo ?? "Not given yet."}</p>
      {revision.actionEvidence && (
        <>
          <p className="font-medium">{actionEvidenceLabel}</p>
          <p>{revision.actionEvidence}</p>
        </>
      )}
      {revision.relatedTemplates.length > 0 && (
        <>
          <p className="font-medium">{relatedTemplatesLabel}</p>
          <p>{revision.relatedTemplates.join(", ")}</p>
        </>
      )}
      {revision.appliesTo === null && (
        <p role="note" data-testid="preview-record-missing">
          {editorMissingScope}
        </p>
      )}
    </section>
  );
}
function EntryDetailsPreview({ revision }: { revision: ManualLibraryRevision }) {
  const missing = [
    revision.purpose === null && "what it is for",
    revision.limits === null && "its limits",
    revision.aiDrafted === null && "how it was written",
  ].filter((entry): entry is string => Boolean(entry));
  return (
    <section
      className="mt-5 grid gap-2 rounded-xl border border-border p-4 text-sm"
      aria-label="What readers see about this template"
      data-testid="preview-entry-details"
    >
      <p className="eyebrow">What readers see about this template</p>
      {revision.purpose && <p>{revision.purpose}</p>}
      {revision.needs && (
        <>
          <p className="font-medium">What you need</p>
          <ul className="list-disc pl-6">
            {revision.needs.split("\n").map((need) => (
              <li key={need}>{need}</li>
            ))}
          </ul>
        </>
      )}
      {revision.limits && (
        <>
          <p className="font-medium">Limits you should know</p>
          <p>{revision.limits}</p>
        </>
      )}
      {revision.relatedGuides.length > 0 && (
        <>
          <p className="font-medium">Related guidance</p>
          <ul className="list-disc pl-6">
            {revision.relatedGuides.map((guide) => (
              <li key={guide.itemId}>
                {guide.title ?? "A guide not filed here yet"}
                {guide.title && !guide.live && " (readers see it once it is published)"}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="font-medium">How it was written and checked</p>
      <p data-testid="preview-statement">{libraryTemplateStatement(revision.aiDrafted)}</p>
      {missing.length > 0 && (
        <p role="note" data-testid="preview-missing">
          Before this version can be published, add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")},
          then save it again.
        </p>
      )}
    </section>
  );
}
export function ManualLibraryEditor({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [page, setPage] = useState(1);
  const [searchFilter, setSearchFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | ManualLibraryDraft["kind"]>("");
  const [stateFilter, setStateFilter] = useState<"" | ManualLibraryEntryState>("");
  const [industryFilter, setIndustryFilter] = useState("");
  // Entries due for their review within 14 days, or overdue (docs/architecture/guidance-currency.md).
  const [reviewFilter, setReviewFilter] = useState(false);
  const trimmedSearch = searchFilter.trim();
  const listParams: ListManualLibraryParams = {
    page,
    ...(trimmedSearch ? { q: trimmedSearch } : {}),
    ...(kindFilter ? { kind: kindFilter } : {}),
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(industryFilter ? { industry: industryFilter } : {}),
    ...(reviewFilter ? { review: "due" as const } : {}),
  };
  const hasFilters = Boolean(trimmedSearch || kindFilter || stateFilter || industryFilter || reviewFilter);
  const list = useListManualLibrary(listParams, { query: { retry: false } });
  const coverage = useGetPublicCoverage({ query: { retry: false, staleTime: 60000 } });
  const [form, setForm] = useState(emptyForm);
  const [snapshot, setSnapshot] = useState<ManualLibraryRevision | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // A withdrawal says why, for the customers who bought or used the version (docs/architecture/editions.md).
  const [withdrawing, setWithdrawing] = useState(false);
  // A review of the published version records that it was re-read and needs no change.
  const [reviewing, setReviewing] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  // A hold on the published version, being placed or lifted (docs/architecture/library-holds.md, slice 2).
  const [holding, setHolding] = useState<"hold" | "lift" | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [reason, setReason] = useState("");
  // A version that follows an earlier release says what changed before it is published
  // (docs/architecture/guidance-currency.md, slice 3).
  const [publishing, setPublishing] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  function mark(value: boolean) {
    setDirty(value);
    onDirtyChange(value);
  }
  function update(patch: Partial<typeof form>) {
    setForm({ ...form, ...patch });
    setRequestId(crypto.randomUUID());
    mark(true);
    setMessage("");
    setError("");
  }
  function load(row: ManualLibraryRevision | null) {
    setSnapshot(row);
    setReviewing(false);
    setHolding(null);
    setForm(
      row
        ? {
            itemId: row.itemId,
            title: row.title,
            kind: row.kind,
            industry: row.industry ?? "",
            body: row.body,
            formText: row.formText ?? "",
            fileMode: row.fileFormat ? "keep" : "text",
            purpose: row.purpose ?? "",
            needs: row.needs ?? "",
            limits: row.limits ?? "",
            relatedItems: row.relatedItems,
            aiDrafted: row.aiDrafted === null ? "" : row.aiDrafted ? "yes" : "no",
            appliesTo: row.appliesTo ?? "",
            actionEvidence: row.actionEvidence ?? "",
            relatedTemplates: row.relatedTemplates.join(", "),
          }
        : emptyForm(),
    );
    setFile(null);
    setFileKey((n) => n + 1);
    setRequestId(crypto.randomUUID());
    setWithdrawing(false);
    setReason("");
    setPublishing(false);
    setChangeNote("");
    mark(false);
  }
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  function canLeave() {
    return !dirty || window.confirm("Discard unsaved edits to this draft?");
  }
  async function save() {
    let upload: ManualLibraryDraft["upload"];
    if (form.fileMode === "upload") {
      if (!file) throw new Error("Choose a file to upload.");
      upload = await encodeFile(file);
    }
    const row = await saveManualLibraryDraft(form.itemId, {
      requestId,
      baseVersion: snapshot?.version ?? 0,
      title: form.title,
      kind: form.kind,
      industry: form.industry || null,
      body: form.body,
      formText: isTemplate(form.kind) && form.formText.trim() ? form.formText : null,
      fileMode: form.fileMode,
      ...(isTemplate(form.kind)
        ? {
            purpose: form.purpose.trim() || null,
            needs: form.needs.trim() || null,
            limits: form.limits.trim() || null,
            relatedItems: form.relatedItems,
            aiDrafted: form.aiDrafted === "" ? null : form.aiDrafted === "yes",
          }
        : {}),
      ...(form.kind === "regulatory_article"
        ? {
            appliesTo: form.appliesTo.trim() || null,
            actionEvidence: form.actionEvidence.trim() || null,
            relatedTemplates: templateNumbers(form.relatedTemplates),
          }
        : {}),
      ...(upload ? { upload } : {}),
    });
    load(row);
    setPage(1);
    await list.refetch();
    setMessage("Draft saved. The preview below shows this version.");
  }
  async function act(action: "publish" | "withdraw") {
    if (!snapshot) return;
    const target = action === "publish" ? snapshot : snapshot.live;
    if (!target) return;
    const row = await actOnManualLibrary(form.itemId, {
      action,
      version: target.version,
      digest: target.digest,
      ...(action === "withdraw" ? { reason: reason.trim() } : {}),
      ...(action === "publish" && snapshot.previousRelease !== null ? { change: changeNote.trim() } : {}),
    });
    load(row);
    await list.refetch();
    setMessage(
      action === "publish"
        ? "Published. Readers can now open this version."
        : "Withdrawn. Readers can no longer open this version.",
    );
  }
  // The published version's review date, from the list row of the open entry.
  const review = list.data?.items.find((item) => item.itemId === form.itemId)?.review;
  async function recordReview() {
    if (!review) return;
    const next = await recordManualLibraryReview(form.itemId, {
      version: review.version,
      digest: review.digest,
      note: reviewNote.trim(),
    });
    setReviewing(false);
    await list.refetch();
    setMessage(reviewRecorded(next.due));
  }
  async function changeHold(action: "hold" | "lift") {
    if (!snapshot?.live) return;
    const row = await holdManualLibraryEntry(form.itemId, {
      action,
      version: snapshot.live.version,
      digest: snapshot.live.digest,
      reason: holdReason.trim(),
    });
    load(row);
    await list.refetch();
    setMessage(action === "hold" ? heldMessage : liftedMessage);
  }
  async function previewFile() {
    if (!snapshot?.fileFormat) return;
    const blob = await previewManualLibraryFile(snapshot.itemId, snapshot.version);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "preview-v" + snapshot.version + "." + snapshot.fileFormat;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="manual-library-title">
      <h2 className="font-display text-2xl" id="manual-library-title">
        Publish guides and templates
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Save a private draft, preview it, then publish when you’re ready.
      </p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(14rem,1fr)_2fr]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (canLeave()) {
                  load(null);
                  setMessage("");
                  setError("");
                }
              }}
            >
              New item
            </button>
            {hasFilters && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setSearchFilter("");
                  setKindFilter("");
                  setStateFilter("");
                  setIndustryFilter("");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="mt-3 grid gap-2" role="search" aria-label="Filter saved items">
            <label className="text-xs font-medium text-muted-foreground">
              Filter by title
              <input
                type="search"
                className={inputStyle}
                value={searchFilter}
                maxLength={140}
                placeholder="Search title"
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                Filter by type
                <select
                  className={inputStyle}
                  value={kindFilter}
                  onChange={(e) => {
                    setKindFilter(e.target.value as "" | ManualLibraryDraft["kind"]);
                    setPage(1);
                  }}
                >
                  <option value="">All types</option>
                  {Object.entries(kinds).map(([k, label]) => (
                    <option value={k} key={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Filter by status
                <select
                  className={inputStyle}
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value as "" | ManualLibraryEntryState);
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="withdrawn">Withdrawn</option>
                  <option value="replaced">Replaced</option>
                </select>
              </label>
            </div>
            <label className="text-xs font-medium text-muted-foreground">
              Filter by industry
              <select
                className={inputStyle}
                value={industryFilter}
                onChange={(e) => {
                  setIndustryFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All industries</option>
                <option value="__general__">General business</option>
                {coverage.data?.industries.map((i) => (
                  <option key={i.slug} value={i.slug}>
                    {industryName(i.title)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={reviewFilter}
                onChange={(e) => {
                  setReviewFilter(e.target.checked);
                  setPage(1);
                }}
              />
              {dueFilterLabel}
            </label>
          </div>
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data && list.data.items.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {hasFilters ? "No saved items match these filters." : "No saved items yet."}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {list.data?.items.map((row) => (
                <li key={row.itemId}>
                  <button
                    type="button"
                    disabled={busy}
                    className="w-full px-1 py-3 text-left text-sm hover:underline"
                    onClick={() => {
                      if (canLeave()) void work(async () => load(await getManualLibraryRevision(row.itemId)));
                    }}
                  >
                    <span className="block font-medium">{row.title}</span>
                    {kinds[row.kind]} · {row.state} · v{row.version}
                    {row.held && (
                      <span
                        className="block text-xs font-medium text-destructive"
                        data-testid="text-list-held"
                      >
                        {heldMark}
                      </span>
                    )}
                    {row.review && (
                      <span
                        className={
                          "block text-xs " +
                          (isOverdue(row.review) ? "font-medium text-destructive" : "text-muted-foreground")
                        }
                      >
                        {reviewLine(row.review)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(page > 1 || list.data?.hasMore) && (
            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy || page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy || !list.data?.hasMore}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
        <div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void work(save);
            }}
          >
            <fieldset disabled={busy} className="grid gap-4">
              <label className="text-sm font-medium">
                Title
                <input
                  className={inputStyle}
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  maxLength={140}
                  required
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Content type
                  <select
                    className={inputStyle}
                    value={form.kind}
                    aria-label="Content type"
                    disabled={Boolean(snapshot)}
                    onChange={(e) => {
                      const kind = e.target.value as typeof form.kind;
                      update({
                        kind,
                        ...(kind === "premium_template" ? { fileMode: "upload", body: "" } : {}),
                      });
                    }}
                  >
                    {Object.entries(kinds).map(([k, label]) => (
                      <option value={k} key={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Industry
                  <select
                    className={inputStyle}
                    value={form.industry}
                    aria-label="Industry"
                    required={industryRequired(form.kind)}
                    onChange={(e) => update({ industry: e.target.value })}
                  >
                    <option value="">
                      {industryRequired(form.kind) ? "Choose an industry" : "General business"}
                    </option>
                    {coverage.data?.industries.map((i) => (
                      <option key={i.slug} value={i.slug}>
                        {industryName(i.title)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {coverage.isError && (
                <ErrorState
                  error={coverage.error}
                  onRetry={() => coverage.refetch()}
                  title="Industries could not be loaded"
                />
              )}
              <label className="text-sm font-medium">
                Content source
                <select
                  className={inputStyle}
                  value={form.fileMode}
                  aria-label="Content source"
                  onChange={(e) => {
                    const mode = e.target.value as typeof form.fileMode;
                    update({
                      fileMode: mode,
                      ...(mode === "upload" && form.kind !== "premium_template" ? { body: "" } : {}),
                    });
                  }}
                >
                  {form.kind !== "premium_template" && (
                    <option value="text">
                      {form.kind === "template" ? "Create a Word template from text" : "Paste or edit text"}
                    </option>
                  )}
                  <option value="upload">Upload Word or PDF</option>
                  {snapshot?.fileFormat && <option value="keep">Keep the saved file</option>}
                </select>
              </label>
              {form.fileMode === "upload" && (
                <label className="text-sm font-medium">
                  Word or PDF file (up to 2 MB)
                  <input
                    key={fileKey}
                    className={inputStyle}
                    type="file"
                    accept=".docx,.pdf"
                    required
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      update({});
                    }}
                  />
                </label>
              )}
              <label className="text-sm font-medium">
                {form.kind === "premium_template"
                  ? "Public description"
                  : form.kind === "template"
                    ? "Template text or description"
                    : "Guide text"}
                <textarea
                  className={inputStyle}
                  rows={7}
                  maxLength={form.kind === "premium_template" ? 600 : 60000}
                  required={form.kind === "premium_template" || form.fileMode !== "upload"}
                  value={form.body}
                  onChange={(e) => update({ body: e.target.value })}
                />
              </label>
              {form.kind === "premium_template" && (
                <p className="text-sm text-muted-foreground">
                  Visitors can read the description. Downloading the file requires an active workspace
                  purchase for this version.
                </p>
              )}
              {isTemplate(form.kind) && (
                <label className="text-sm font-medium">
                  Form text for the fill-in form (optional)
                  <textarea
                    className={inputStyle + " font-mono text-sm"}
                    rows={7}
                    maxLength={60000}
                    value={form.formText}
                    onChange={(e) => update({ formText: e.target.value })}
                    aria-describedby="form-text-help"
                  />
                  <span id="form-text-help" className="mt-1 block font-normal text-muted-foreground">
                    The template's wording with its placeholders named, which the fill-in form completes with
                    a customer's answers. No reader sees it here: customers get only the documents their
                    answers make. Leave it empty for a template without a form.
                  </span>
                </label>
              )}
              {isTemplate(form.kind) && (
                <fieldset
                  className="grid gap-3 rounded-lg border border-border p-3"
                  data-testid="entry-details"
                >
                  <legend className="px-1 text-sm font-medium">What readers see about this template</legend>
                  <p className="text-sm text-muted-foreground">
                    A template is published only with what it is for, its limits and how it was written.
                  </p>
                  <label className="text-sm font-medium">
                    What it is for
                    <textarea
                      className={inputStyle}
                      rows={2}
                      maxLength={400}
                      value={form.purpose}
                      onChange={(e) => update({ purpose: e.target.value })}
                      aria-describedby="purpose-help"
                      data-testid="input-purpose"
                    />
                    <span id="purpose-help" className="mt-1 block font-normal text-muted-foreground">
                      Shown under the title, and as the template&apos;s summary in the list of documents. Up
                      to 400 characters.
                    </span>
                  </label>
                  <label className="text-sm font-medium">
                    What you need (optional)
                    <textarea
                      className={inputStyle}
                      rows={4}
                      maxLength={1600}
                      value={form.needs}
                      onChange={(e) => update({ needs: e.target.value })}
                      aria-describedby="needs-help"
                      data-testid="input-needs"
                    />
                    <span id="needs-help" className="mt-1 block font-normal text-muted-foreground">
                      The facts and records a customer needs to complete it, one to a line. Up to 12 lines.
                    </span>
                  </label>
                  <label className="text-sm font-medium">
                    Limits you should know
                    <textarea
                      className={inputStyle}
                      rows={3}
                      maxLength={800}
                      value={form.limits}
                      onChange={(e) => update({ limits: e.target.value })}
                      aria-describedby="limits-help"
                      data-testid="input-limits"
                    />
                    <span id="limits-help" className="mt-1 block font-normal text-muted-foreground">
                      What it does not do. For an agreement, or an employment, privacy, governance or sector
                      document, say when independent advice may be useful. Never promise that it is
                      enforceable, suitable or approved.
                    </span>
                  </label>
                  <fieldset className="text-sm" data-testid="input-ai-drafted">
                    <legend className="font-medium">How was this text written?</legend>
                    <label className="mr-4 inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="ai-drafted"
                        checked={form.aiDrafted === "yes"}
                        onChange={() => update({ aiDrafted: "yes" })}
                      />
                      Drafted with AI
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="ai-drafted"
                        checked={form.aiDrafted === "no"}
                        onChange={() => update({ aiDrafted: "no" })}
                      />
                      Written without AI
                    </label>
                  </fieldset>
                  <RelatedGuidesPicker
                    key={snapshot?.id ?? form.itemId}
                    value={form.relatedItems}
                    known={snapshot?.relatedGuides ?? []}
                    onChange={(relatedItems) => update({ relatedItems })}
                  />
                </fieldset>
              )}
              {form.fileMode === "upload" && form.kind !== "premium_template" && (
                <p className="text-sm text-muted-foreground">
                  Leave the text blank to use the words in your file. For a scanned PDF, paste the text you
                  want readers to see.
                </p>
              )}
              {form.kind === "regulatory_article" && (
                <fieldset
                  className="grid gap-3 rounded-lg border border-border p-3"
                  data-testid="guidance-record"
                >
                  <legend className="px-1 text-sm font-medium">{recordLegend}</legend>
                  <p className="text-sm text-muted-foreground">{recordHint}</p>
                  <p className="text-sm text-muted-foreground">{draftLinesNote}</p>
                  <label className="text-sm font-medium">
                    {appliesToLabel}
                    <textarea
                      className={inputStyle}
                      rows={3}
                      maxLength={800}
                      value={form.appliesTo}
                      onChange={(e) => update({ appliesTo: e.target.value })}
                      aria-describedby="applies-to-help"
                      data-testid="input-applies-to"
                    />
                    <span id="applies-to-help" className="mt-1 block font-normal text-muted-foreground">
                      {appliesToHelp}
                    </span>
                  </label>
                  <label className="text-sm font-medium">
                    {actionEvidenceLabel} (optional)
                    <textarea
                      className={inputStyle}
                      rows={3}
                      maxLength={800}
                      value={form.actionEvidence}
                      onChange={(e) => update({ actionEvidence: e.target.value })}
                      aria-describedby="action-evidence-help"
                      data-testid="input-action-evidence"
                    />
                    <span id="action-evidence-help" className="mt-1 block font-normal text-muted-foreground">
                      {actionEvidenceHelp}
                    </span>
                  </label>
                  <label className="text-sm font-medium">
                    {relatedTemplatesLabel} (optional)
                    <input
                      className={inputStyle}
                      value={form.relatedTemplates}
                      onChange={(e) => update({ relatedTemplates: e.target.value })}
                      aria-describedby="related-templates-help"
                      data-testid="input-related-templates"
                    />
                    <span
                      id="related-templates-help"
                      className="mt-1 block font-normal text-muted-foreground"
                    >
                      {relatedTemplatesHelp}
                    </span>
                  </label>
                </fieldset>
              )}
              {form.kind === "regulatory_article" && (
                <p className="text-sm">
                  Regulatory articles stay private until the owner checks their sources.
                </p>
              )}
              <button
                className="btn btn-primary justify-self-start"
                type="submit"
                disabled={Boolean(snapshot) && !dirty}
              >
                Save draft and preview
              </button>
            </fieldset>
          </form>
          {error && (
            <p className="mt-3 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="mt-3 text-sm" role="status">
              {message}
            </p>
          )}
          {snapshot && (
            <section className="mt-6 border-t border-border pt-5" aria-label="Saved preview">
              <p className="eyebrow">
                Saved preview · version {snapshot.version} · {snapshot.state}
              </p>
              <h3 className="font-display mt-2 text-xl">{snapshot.title}</h3>
              <PlainText text={snapshot.body} className="mt-3 grid gap-3" />
              {isTemplate(snapshot.kind) && <EntryDetailsPreview revision={snapshot} />}
              {snapshot.kind === "regulatory_article" && <GuidanceRecordPreview revision={snapshot} />}
              {snapshot.formText !== null && snapshot.formFit && (
                <section
                  className="mt-5 grid gap-3 rounded-xl border border-border p-4"
                  aria-label="Form text"
                >
                  <p className="eyebrow">Form text for the fill-in form</p>
                  <p className="text-sm" data-testid="text-form-fit">
                    {fitSummary(snapshot.formFit)}
                  </p>
                  {snapshot.formFit.problems.length > 0 && (
                    <ul className="list-disc pl-6 text-sm">
                      {snapshot.formFit.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  )}
                  <FormTextOutline source={snapshot.formText} templateId={snapshot.formFit.templateId} />
                </section>
              )}
              {dirty && <p className="mt-3 text-sm">Save your edits to preview the new version.</p>}
              {snapshot.live && (
                <p className="mt-3 text-sm">Readers can see version {snapshot.live.version}.</p>
              )}
              {snapshot.live && snapshot.reach && (
                <p className="mt-1 text-sm" data-testid="text-withdrawal-reach">
                  {reachLine(snapshot.reach)}
                </p>
              )}
              {snapshot.told !== null && (
                <p className="mt-3 text-sm" data-testid="text-withdrawal-told">
                  {toldLine(snapshot.told)}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {snapshot.fileFormat && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void work(previewFile)}
                  >
                    Download preview file
                  </button>
                )}
                {snapshot.kind !== "regulatory_article" && snapshot.state === "draft" && !publishing && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || dirty}
                    onClick={() => {
                      if (snapshot.previousRelease === null) {
                        void work(() => act("publish"));
                        return;
                      }
                      setChangeNote("");
                      setPublishing(true);
                    }}
                  >
                    Publish this version
                  </button>
                )}
                {snapshot.live && !withdrawing && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy || dirty}
                    onClick={() => {
                      setReason("");
                      setWithdrawing(true);
                    }}
                  >
                    Withdraw live version
                  </button>
                )}
              </div>
              {snapshot.state === "draft" && snapshot.previousRelease !== null && publishing && (
                <form
                  className="mt-4 grid gap-2"
                  aria-label="Say what changed, then publish this version"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(() => act("publish"));
                  }}
                >
                  <label className="text-sm font-medium" htmlFor="manual-change-note">
                    {changeLabel}
                  </label>
                  <p id="manual-change-note-help" className="text-sm text-muted-foreground">
                    {changeHint(snapshot.previousRelease)}
                  </p>
                  <textarea
                    id="manual-change-note"
                    className="field min-h-24"
                    aria-describedby="manual-change-note-help"
                    minLength={20}
                    maxLength={1000}
                    required
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy || dirty || changeNote.trim().length < 20}
                    >
                      Publish this version
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setPublishing(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {review && snapshot.live && !reviewing && (
                <div className="mt-4 grid gap-2">
                  <p className="text-sm">{reviewStatus(review)}</p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm justify-self-start"
                    disabled={busy || dirty}
                    onClick={() => {
                      setReviewNote("");
                      setReviewing(true);
                    }}
                  >
                    Record a review
                  </button>
                </div>
              )}
              {review && snapshot.live && reviewing && (
                <form
                  className="mt-4 grid gap-2"
                  aria-label="Record a review of the published version"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(recordReview);
                  }}
                >
                  <label className="text-sm font-medium" htmlFor="manual-review-note">
                    {reviewNoteLabel}
                  </label>
                  <p id="manual-review-note-help" className="text-sm text-muted-foreground">
                    {reviewNoteHint}
                  </p>
                  <textarea
                    id="manual-review-note"
                    className="field min-h-24"
                    aria-describedby="manual-review-note-help"
                    minLength={20}
                    maxLength={1000}
                    required
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy || reviewNote.trim().length < 20}
                    >
                      Record review
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setReviewing(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {snapshot.live && snapshot.hold && (
                <p className="mt-4 text-sm font-medium text-destructive" data-testid="text-held">
                  {heldLine(snapshot.live.version, snapshot.hold)}
                </p>
              )}
              {snapshot.live && !holding && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {!snapshot.hold ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || dirty}
                      onClick={() => {
                        setHoldReason("");
                        setHolding("hold");
                      }}
                    >
                      Hold this version
                    </button>
                  ) : snapshot.kind === "regulatory_article" ? (
                    <p className="text-sm text-muted-foreground">{ownerLiftsWords}</p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || dirty}
                      onClick={() => {
                        setHoldReason("");
                        setHolding("lift");
                      }}
                    >
                      Lift the hold
                    </button>
                  )}
                </div>
              )}
              {snapshot.live && holding && (
                <form
                  className="mt-4 grid gap-2"
                  aria-label={holding === "hold" ? "Hold the published version" : "Lift the hold"}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(() => changeHold(holding));
                  }}
                >
                  <label className="text-sm font-medium" htmlFor="manual-hold-reason">
                    {holding === "hold" ? holdLabel : liftLabel}
                  </label>
                  <p id="manual-hold-reason-help" className="text-sm text-muted-foreground">
                    {holding === "hold" ? holdHint : liftHint}
                  </p>
                  <textarea
                    id="manual-hold-reason"
                    className="field min-h-24"
                    aria-describedby="manual-hold-reason-help"
                    minLength={20}
                    maxLength={1000}
                    required
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy || holdReason.trim().length < 20}
                    >
                      {holding === "hold" ? "Hold this version" : "Lift the hold"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setHolding(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {snapshot.live && withdrawing && (
                <form
                  className="mt-4 grid gap-2"
                  aria-label="Withdraw the live version"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void work(() => act("withdraw"));
                  }}
                >
                  <label className="text-sm font-medium" htmlFor="manual-withdraw-reason">
                    Why is it withdrawn?
                  </label>
                  <p id="manual-withdraw-reason-help" className="text-sm text-muted-foreground">
                    {withdrawalHelp(snapshot.live.version, isTemplate(snapshot.kind), snapshot.reach)}
                  </p>
                  <textarea
                    id="manual-withdraw-reason"
                    className="field min-h-24"
                    aria-describedby="manual-withdraw-reason-help"
                    minLength={20}
                    maxLength={1000}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={busy || reason.trim().length < 20}
                    >
                      Withdraw this version
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setWithdrawing(false)}
                    >
                      Keep it
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
