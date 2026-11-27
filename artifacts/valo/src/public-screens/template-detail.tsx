"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, FilePlus2, FileX } from "lucide-react";
import {
  useGetReleasedTemplate,
  useCreateTemplateDraft,
  downloadReleasedTemplate,
  downloadManualTemplate,
  type ReleasedTemplate,
} from "@workspace/api-client-react";
import { PublicLink as Link } from "@/components/public-link";
import { PremiumTemplateDetailAction } from "@/components/premium-template-detail-action";
import { describeError } from "@/lib/describe-error";
import { basePath } from "@/lib/env";
import { StartTemplateDocument, guidedTemplateFor } from "@/components/start-template-document";
import { formatDay, formatNaira } from "@/lib/format";
import { useOwnedTemplateEditions } from "@/lib/use-owned-template-editions";
import { fromServer } from "@/lib/server-data";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { SaveTemplateButton } from "@/components/saved-templates";
import { ReleaseNotices } from "@/components/release-notices";
import { KIND_LABEL } from "@/components/resource-parts";
import { useIdentity } from "@/islands/identity-store";
import { updatedLine } from "@/lib/library-change";

function Unavailable() {
  return (
    <EmptyState
      mark={<FileX className="h-5 w-5 text-muted-foreground" />}
      title="This template is not available"
      action={
        <Link href="/library" className="btn btn-primary" data-testid="link-back-library">
          Back to documents
        </Link>
      }
    >
      It may have been withdrawn, its sources may need checking again, or the link may be wrong. Valo checks
      again before a copy or a download. Drafts you already created stay in your workspace.
    </EmptyState>
  );
}

/**
 * What a staff-library template's release says about it (docs/architecture/library-entries.md): what
 * a customer needs to complete it, its limits, its related guidance that is released now, and how it
 * was written and checked. A version released before these details existed shows only the last.
 */
function LibraryTemplateNotices({ t }: { t: ReleasedTemplate }) {
  return (
    <section className="grid gap-6 border-t border-border pt-6 text-sm leading-relaxed">
      {!!t.needs?.length && (
        <div>
          <h2 className="eyebrow">What you need</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="list-needs">
            {t.needs.map((need) => (
              <li key={need}>{need}</li>
            ))}
          </ul>
        </div>
      )}
      {t.limitations && (
        <div>
          <h2 className="eyebrow">Limits you should know</h2>
          <p className="mt-2 whitespace-pre-line" data-testid="text-limitations">
            {t.limitations}
          </p>
        </div>
      )}
      {!!t.relatedGuides?.length && (
        <div>
          <h2 className="eyebrow">Related guidance</h2>
          <ul className="mt-2 space-y-1" data-testid="list-related-guides">
            {t.relatedGuides.map((guide) => (
              <li key={guide.href}>
                <Link href={guide.href} className="underline underline-offset-4">
                  {guide.title}
                </Link>{" "}
                <span className="text-muted-foreground">· {KIND_LABEL[guide.kind]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h2 className="eyebrow">How it was written and checked</h2>
        <p className="mt-2" data-testid="text-disclosure">
          {t.disclosure} Released {formatDay(t.reviewedAt)}.
        </p>
      </div>
    </section>
  );
}

/** What a signed-in reader can do with a template; exported for its render test. */
export function CustomerActions({ t, canUse }: { t: ReleasedTemplate; canUse: boolean }) {
  // The new draft opens in the workspace, which is the browser app: a full load (decision 0011).
  const create = useCreateTemplateDraft({
    mutation: {
      onSuccess: (doc) => {
        window.location.assign(`${basePath}/workspace/documents/${encodeURIComponent(doc.id)}`);
      },
    },
  });
  const [busy, setBusy] = useState<"docx" | "pdf" | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const download = useCallback(
    async (format: "docx" | "pdf") => {
      setBusy(format);
      setDlError(null);
      try {
        const res: unknown =
          t.publicationMethod === "manual"
            ? await downloadManualTemplate(t.id)
            : await downloadReleasedTemplate(t.id, format);
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
            ? "This template can no longer be downloaded. It may have been withdrawn."
            : d.message,
        );
      } finally {
        setBusy(null);
      }
    },
    [t.publicationMethod, t.id, t.slug, t.version],
  );

  useEffect(() => {
    const intent = window.location.hash;
    if (!intent.startsWith("#download-")) return;
    // Consume this one request before starting the download so reloads and remounts do not repeat it.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (intent !== "#download-" + t.id || t.access !== "free" || !t.formats[0]) {
      setDlError("This download link is no longer current. Check this edition before downloading.");
      return;
    }
    void download(t.formats[0]);
  }, [download, t.id, t.access, t.formats]);

  const createErr = create.isError ? describeError(create.error) : null;
  return (
    <div className="grid gap-3 empty:hidden">
      {canUse && <StartTemplateDocument templateId={t.templateId} title={t.title} />}
      <SaveTemplateButton releaseId={t.id} templateId={t.templateId} />
      {/* A staff-library template is copied from its released text, which only a free one keeps here
          (docs/architecture/library-entries.md, slice 3). */}
      {canUse && (t.publicationMethod !== "manual" || t.access === "free") && (
        <>
          <button
            className="btn btn-primary w-full"
            disabled={create.isPending}
            onClick={() => create.mutate({ id: t.id })}
            data-testid="button-create-draft"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
            {create.isPending ? "Making your copy…" : "Make my own copy"}
          </button>
          {createErr && (
            <p role="alert" className="text-sm text-red-800" data-testid="text-draft-error">
              {createErr.kind === "notFound"
                ? "This template was withdrawn before your copy was made. Nothing was saved."
                : createErr.message}
            </p>
          )}
        </>
      )}
      {canUse && t.publicationMethod === "manual" && t.access === "premium" && (
        <p className="text-sm text-muted-foreground" data-testid="text-copy-unavailable">
          This template&apos;s text comes in its Word file, so it cannot be copied into a document here.
        </p>
      )}
      {t.access === "free" && t.formats.length > 0 && (
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
              {busy === f
                ? "Preparing…"
                : `${t.publicationMethod === "manual" ? "Download" : "Blank"} ${f === "docx" ? "Word file" : f.toUpperCase()}`}
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

/**
 * A released template, starting from what the server read; it is read again every 15 seconds, so a
 * withdrawal reaches the open page. When the server found none, the page says so at once while the
 * browser checks again. Creating a draft, saving and downloading need a signed-in visitor, which the
 * identity island reports once the provider has loaded after the page (decision 0011).
 */
export function TemplateDetail({
  slug,
  initial,
}: {
  slug: string;
  initial?: ReleasedTemplate | "missing" | undefined;
}) {
  const q = useGetReleasedTemplate(slug, {
    query: {
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
      ...fromServer(initial === "missing" ? undefined : initial),
    },
  });
  const t = q.data;
  const notFound =
    (q.isError && describeError(q.error).kind === "notFound") || (initial === "missing" && q.isLoading);
  const identity = useIdentity();
  const signedIn = identity.status === "signed-in";
  // A reviewed edition can omit its access label after its sale offer closes.
  const owned = useOwnedTemplateEditions(identity, !!t && t.access !== "free");
  const ownsEdition = !!t && owned.has(t.id);

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-library"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Documents
      </Link>
      <div className="mt-6">
        {/* A template the server found missing is shown unavailable while the browser checks again,
            in the server's render too, rather than as loading. */}
        {notFound ? (
          <Unavailable />
        ) : q.isLoading ? (
          <div className="grid gap-4" aria-busy="true">
            <Skel className="h-10 w-2/3" />
            <Skel className="h-5 w-1/2" />
            <Skel className="h-64" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} title="Template could not be loaded" onRetry={() => q.refetch()} />
        ) : t ? (
          // On a phone the three parts follow one another: what it is, how to use it, then its
          // notices. On a wide screen the middle one stays beside the other two.
          <article className="grid gap-10 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0 lg:col-start-1">
              <div className="flex flex-wrap gap-2">
                <span className="pill pill-forest">
                  {t.access === "premium" ? "Premium template" : "Template"}
                </span>
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
              {/* A staff-library template says what it is for once its release records it. */}
              {(t.publicationMethod !== "manual" || t.purpose) && (
                <p
                  className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground"
                  data-testid="text-summary"
                >
                  {t.purpose ?? t.summary}
                </p>
              )}
              {/* A version released after an earlier one says what changed (CMP-005). */}
              {t.change && (
                <p className="mt-4 max-w-2xl border-l-2 border-border pl-3 text-sm" data-testid="text-change">
                  {updatedLine(t.change)}
                </p>
              )}

              <section className="mt-10" aria-labelledby="preview-heading">
                <h2 id="preview-heading" className="eyebrow">
                  Preview
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
                    {(t.publicationMethod !== "manual" || t.access === "free") && (
                      <p
                        className="mt-6 border-t border-dashed border-border pt-4 text-xs text-muted-foreground"
                        data-testid="text-preview-part"
                      >
                        {t.publicationMethod === "manual"
                          ? "The opening of the template. All of it is in the file you download."
                          : "Part of the template. All of it opens in your own copy."}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">This template has no preview.</p>
                )}
              </section>
            </div>

            <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
              <div className="surface grid gap-4 p-5">
                <p className="font-display text-xl">Use this template</p>
                {t.offer && (
                  <>
                    <p className="font-display text-3xl" data-testid="template-price">
                      {formatNaira(t.offer.amountKobo)}
                    </p>
                    <p className="text-sm text-muted-foreground">{t.offer.taxTreatment}</p>
                  </>
                )}
                {(t.access === "premium" || ownsEdition) && (
                  <PremiumTemplateDetailAction edition={t} owned={ownsEdition} />
                )}
                {t.access === "premium" && !ownsEdition && (
                  <p className="text-sm text-muted-foreground" data-testid="text-purchase-needed">
                    {guidedTemplateFor(t.templateId, t.title)
                      ? "Downloading this version, or answering its questions, requires an active purchase in your workspace."
                      : "Downloading this version requires an active purchase in your workspace."}
                  </p>
                )}
                {signedIn ? (
                  <CustomerActions t={t} canUse={t.access === "free" || ownsEdition} />
                ) : !t.offer ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t.access === "premium"
                        ? "Sign in to check access to this edition."
                        : t.publicationMethod === "manual"
                          ? "Sign in to download the template."
                          : "Sign in to make your own copy or download the blank file. Your copy is kept in your own workspace."}
                    </p>
                    <Link href="/sign-in" className="btn btn-primary w-full" data-testid="link-sign-in">
                      Sign in to continue
                    </Link>
                  </>
                ) : null}
                {t.publicationMethod !== "manual" &&
                  !t.commercialLicenceAccepted &&
                  !t.offer &&
                  !ownsEdition && (
                    <Notice title="Not for sale">There is no current purchase offer for this edition.</Notice>
                  )}
                {t.developmentOnly && (
                  <p className="text-xs text-muted-foreground">
                    Development release. This is an everyday business document, not legal guidance, and it
                    does not tell you what the law requires of your business.
                  </p>
                )}
              </div>
            </aside>

            <div className="min-w-0 lg:col-start-1">
              {t.offer && (
                <section className="mb-8" aria-labelledby="licence-heading">
                  <h2 id="licence-heading" className="font-display text-2xl">
                    Licence terms · version {t.offer.licenceVersion}
                  </h2>
                  <p className="mt-3 whitespace-pre-line leading-relaxed">{t.offer.licenceText}</p>
                </section>
              )}
              {t.publicationMethod === "manual" ? (
                <LibraryTemplateNotices t={t} />
              ) : (
                t.reviewBy && (
                  <ReleaseNotices
                    reviewedAt={t.reviewedAt}
                    reviewBy={t.reviewBy}
                    disclosure={t.disclosure}
                    scope={t.scope}
                    limitations={t.limitations}
                  />
                )
              )}
            </div>
          </article>
        ) : (
          <Unavailable />
        )}
      </div>
    </div>
  );
}
