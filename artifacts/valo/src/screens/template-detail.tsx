import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Show } from "@clerk/react";
import { ArrowLeft, Download, FilePlus2, FileX } from "lucide-react";
import {
  useGetReleasedTemplate,
  useCreateTemplateDraft,
  downloadReleasedTemplate,
  getGetDocumentQueryKey,
  getListDocumentsQueryKey,
  getGetWorkspaceQueryKey,
  type ReleasedTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/lib/api";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { SaveTemplateButton } from "@/components/saved-templates";

function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

function Unavailable() {
  return (
    <EmptyState
      mark={<FileX className="h-5 w-5 text-muted-foreground" />}
      title="This template is not available"
      action={
        <Link href="/library" className="btn btn-primary" data-testid="link-back-library">
          Back to the library
        </Link>
      }
    >
      It may have been withdrawn, its evidence may need updating, or the link may be wrong. Availability is
      checked again before a new draft or download. Drafts you already created stay in your workspace.
    </EmptyState>
  );
}

function CustomerActions({ t }: { t: ReleasedTemplate }) {
  const [, setLocation] = useLocation();
  const cache = useQueryClient();
  const create = useCreateTemplateDraft({
    mutation: {
      onSuccess: async (doc) => {
        cache.setQueryData(getGetDocumentQueryKey(doc.id), doc);
        await Promise.all([
          cache.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
          cache.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }),
        ]);
        setLocation("/workspace/documents/" + doc.id);
      },
    },
  });
  const [busy, setBusy] = useState<"docx" | "pdf" | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  async function download(format: "docx" | "pdf") {
    setBusy(format);
    setDlError(null);
    try {
      const res: unknown = await downloadReleasedTemplate(t.id, format);
      const blob = res instanceof Blob ? res : new Blob([res as BlobPart]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${t.slug}-v${t.version}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      const d = describeError(e);
      setDlError(
        d.kind === "notFound"
          ? "This template is no longer available to download. It may have been withdrawn."
          : d.message,
      );
    } finally {
      setBusy(null);
    }
  }

  const createErr = create.isError ? describeError(create.error) : null;
  return (
    <div className="grid gap-3">
      <SaveTemplateButton releaseId={t.id} templateId={t.templateId} />
      <button
        className="btn btn-primary w-full"
        disabled={create.isPending}
        onClick={() => create.mutate({ id: t.id })}
        data-testid="button-create-draft"
      >
        <FilePlus2 className="h-4 w-4" aria-hidden />
        {create.isPending ? "Creating private draft…" : "Create a private draft"}
      </button>
      {createErr && (
        <p role="alert" className="text-sm text-red-800" data-testid="text-draft-error">
          {createErr.kind === "notFound"
            ? "This template was withdrawn before your draft was created. Nothing was saved."
            : createErr.message}
        </p>
      )}
      {t.formats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {t.formats.map((f) => (
            <button
              key={f}
              className="btn btn-ghost btn-sm flex-1"
              disabled={busy !== null}
              onClick={() => download(f)}
              data-testid={"button-download-" + f}
            >
              <Download className="h-4 w-4" aria-hidden />
              {busy === f ? "Preparing…" : `Blank ${f.toUpperCase()}`}
            </button>
          ))}
        </div>
      )}
      {dlError && (
        <p role="alert" className="text-sm text-red-800" data-testid="text-download-error">
          {dlError}
        </p>
      )}
    </div>
  );
}

export default function TemplateDetail({ slug }: { slug: string }) {
  const q = useGetReleasedTemplate(slug, { query: { refetchInterval: 15000, refetchOnWindowFocus: true } });
  const t = q.data;
  const notFound = q.isError && describeError(q.error).kind === "notFound";

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-library"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Library
      </Link>
      <div className="mt-6">
        {q.isLoading ? (
          <div className="grid gap-4" aria-busy="true">
            <Skel className="h-10 w-2/3" />
            <Skel className="h-5 w-1/2" />
            <Skel className="h-64" />
          </div>
        ) : notFound ? (
          <Unavailable />
        ) : q.isError ? (
          <ErrorState error={q.error} title="Template could not be loaded" onRetry={() => q.refetch()} />
        ) : t ? (
          <article className="grid gap-10 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <span className="pill pill-forest">Business document</span>
                <span className="pill pill-ink" data-testid="text-version">
                  Version {t.version}
                </span>
                {t.developmentOnly && (
                  <span className="pill pill-ink" data-testid="status-development">
                    Development build only
                  </span>
                )}
              </div>
              <h1 className="font-display mt-4 text-4xl leading-tight sm:text-5xl" data-testid="text-title">
                {t.title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{t.summary}</p>

              <dl className="mt-8 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="eyebrow">Reviewed</dt>
                  <dd className="mt-1" data-testid="text-reviewed">
                    {fmtDay(t.reviewedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Next review due</dt>
                  <dd className="mt-1" data-testid="text-review-by">
                    {fmtDay(t.reviewBy)}
                  </dd>
                </div>
              </dl>

              <section className="mt-8 grid gap-6 text-sm leading-relaxed">
                <div>
                  <h2 className="eyebrow">Disclosure</h2>
                  <p className="mt-2 whitespace-pre-line" data-testid="text-disclosure">
                    {t.disclosure}
                  </p>
                </div>
                <div>
                  <h2 className="eyebrow">Scope</h2>
                  <p className="mt-2 whitespace-pre-line" data-testid="text-scope">
                    {t.scope}
                  </p>
                </div>
                <div>
                  <h2 className="eyebrow">Limitations</h2>
                  <p className="mt-2 whitespace-pre-line" data-testid="text-limitations">
                    {t.limitations}
                  </p>
                </div>
              </section>

              <section className="mt-10" aria-labelledby="preview-heading">
                <h2 id="preview-heading" className="eyebrow">
                  Public preview
                </h2>
                {t.preview.length > 0 ? (
                  <div
                    className="surface relative mt-3 overflow-hidden p-6 sm:p-8"
                    data-testid="section-preview"
                  >
                    <div className="grid gap-3 font-display text-[1.05rem] leading-relaxed">
                      {t.preview.map((p, i) => (
                        <p key={i} className="whitespace-pre-line">
                          {p}
                        </p>
                      ))}
                    </div>
                    <p className="mt-6 border-t border-dashed border-border pt-4 text-xs text-muted-foreground">
                      Preview excerpt only. The full text is available inside a private draft.
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No public preview is provided for this template.
                  </p>
                )}
              </section>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="surface grid gap-4 p-5">
                <p className="font-display text-xl">Use this template</p>
                <Show when="signed-in">
                  <CustomerActions t={t} />
                </Show>
                <Show when="signed-out">
                  <p className="text-sm text-muted-foreground">
                    Sign in to create a private draft or download the blank file. Your drafts are visible only
                    to you.
                  </p>
                  <Link href="/sign-in" className="btn btn-primary w-full" data-testid="link-sign-in">
                    Sign in to continue
                  </Link>
                </Show>
                {!t.commercialLicenceAccepted && (
                  <Notice title="Not for sale">
                    Commercial licence terms have not been accepted for this template, so it is not sold or
                    offered as a paid product. Use is free in this development build.
                  </Notice>
                )}
                {t.developmentOnly && (
                  <p className="text-xs text-muted-foreground">
                    Development release. This is an operational business document, not legal guidance, and it
                    does not tell you what the law requires of your business.
                  </p>
                )}
              </div>
            </aside>
          </article>
        ) : (
          <Unavailable />
        )}
      </div>
    </div>
  );
}
