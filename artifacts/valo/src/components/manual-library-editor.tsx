import { useState } from "react";
import {
  actOnManualLibrary,
  getManualLibraryRevision,
  previewManualLibraryFile,
  saveManualLibraryDraft,
  useGetPublicCoverage,
  useListManualLibrary,
  type ManualLibraryDraft,
  type ManualLibraryRevision,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/describe-error";
import { industryName } from "@/lib/library-filters";
import { PlainText } from "./resource-parts";
import { ErrorState } from "./states";

const kinds: Record<ManualLibraryDraft["kind"], string> = {
  practical_guide: "Practical guide",
  industry_introduction: "Industry introduction",
  template: "Template",
  regulatory_article: "Regulatory article",
};
const inputStyle = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base";
const emptyForm = () => ({
  itemId: crypto.randomUUID() as string,
  title: "",
  kind: "practical_guide" as ManualLibraryDraft["kind"],
  industry: "",
  body: "",
  fileMode: "text" as ManualLibraryDraft["fileMode"],
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
export function ManualLibraryEditor({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [page, setPage] = useState(1);
  const list = useListManualLibrary({ page }, { query: { retry: false } });
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
    setForm(
      row
        ? {
            itemId: row.itemId,
            title: row.title,
            kind: row.kind,
            industry: row.industry ?? "",
            body: row.body,
            fileMode: row.fileFormat ? "keep" : "text",
          }
        : emptyForm(),
    );
    setFile(null);
    setFileKey((n) => n + 1);
    setRequestId(crypto.randomUUID());
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
      fileMode: form.fileMode,
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
    });
    load(row);
    await list.refetch();
    setMessage(
      action === "publish"
        ? "Published. Readers can now open this version."
        : "Withdrawn. Readers can no longer open this version.",
    );
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
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(12rem,1fr)_2fr]">
        <div>
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
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
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
                    onChange={(e) => update({ kind: e.target.value as typeof form.kind })}
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
                    required={form.kind === "industry_introduction"}
                    onChange={(e) => update({ industry: e.target.value })}
                  >
                    <option value="">
                      {form.kind === "industry_introduction" ? "Choose an industry" : "General business"}
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
                    update({ fileMode: mode, ...(mode === "upload" ? { body: "" } : {}) });
                  }}
                >
                  <option value="text">
                    {form.kind === "template" ? "Create a Word template from text" : "Paste or edit text"}
                  </option>
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
                {form.kind === "template" ? "Template text or description" : "Guide text"}
                <textarea
                  className={inputStyle}
                  rows={7}
                  maxLength={60000}
                  required={form.fileMode !== "upload"}
                  value={form.body}
                  onChange={(e) => update({ body: e.target.value })}
                />
              </label>
              {form.fileMode === "upload" && (
                <p className="text-sm text-muted-foreground">
                  Leave the text blank to use the words in your file. For a scanned PDF, paste the text you
                  want readers to see.
                </p>
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
              {dirty && <p className="mt-3 text-sm">Save your edits to preview the new version.</p>}
              {snapshot.live && (
                <p className="mt-3 text-sm">Readers can see version {snapshot.live.version}.</p>
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
                {snapshot.kind !== "regulatory_article" && snapshot.state === "draft" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || dirty}
                    onClick={() => void work(() => act("publish"))}
                  >
                    Publish this version
                  </button>
                )}
                {snapshot.live && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy || dirty}
                    onClick={() => {
                      if (window.confirm("Withdraw the version readers currently see?"))
                        void work(() => act("withdraw"));
                    }}
                  >
                    Withdraw live version
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
