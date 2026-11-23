import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileCheck2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  useGetCustomerAIDraft,
  useAcceptCustomerAIDraft,
  getGetCustomerAIDraftQueryKey,
  getListDocumentsQueryKey,
  getGetWorkspaceQueryKey,
  type CanonicalDocument,
  type FinancialInput,
} from "@workspace/api-client-react";
import { synchronizeFinancialBlocks } from "@workspace/valo-core/money";
import { Meta, Shell, STATUS, TASK_LABEL } from "@/components/ai-draft-shared";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FinancialFields, FINANCIAL_BLOCK_IDS } from "@/components/financial-fields";
import { ErrorState, Notice, Skel } from "@/components/states";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { describeError } from "@/lib/api";
import { live } from "@/lib/checker";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { cn } from "@/lib/utils";

export function AIDraftPreview({ id }: { id: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const q = useGetCustomerAIDraft(id, {
    query: {
      enabled: !!id,
      queryKey: getGetCustomerAIDraftQueryKey(id),
      ...live,
      refetchInterval: (query) => (query.state.data?.status === "running" ? 2500 : false),
    },
  });
  const accept = useAcceptCustomerAIDraft();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<CanonicalDocument | null>(null);
  const [finValid, setFinValid] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);
  const leavingRef = useRef(false);

  const p = q.data;
  // Initialise editable copy once per preview hash; refetch/polling never replaces edits.
  useEffect(() => {
    if (p && p.status !== "running" && initFor !== p.previewHash) {
      setInitFor(p.previewHash);
      setTitle(p.title);
      setContent(p.content);
    }
  }, [p, initFor]);

  const initialContentJson = useMemo(() => (p ? JSON.stringify(p.content) : ""), [p]);
  const hasUnsavedEdits =
    !leavingRef.current &&
    Boolean(
      p &&
      p.status !== "running" &&
      p.status !== "unsupported" &&
      !p.acceptedDocumentId &&
      (accept.isPending ||
        (initFor === p.previewHash &&
          (title !== p.title || (content !== null && JSON.stringify(content) !== initialContentJson)))),
    );
  const navigation = useUnsavedNavigation(() => hasUnsavedEdits);

  const narrative = useMemo(
    () => content?.blocks.filter((b) => !FINANCIAL_BLOCK_IDS.includes(b.id)) ?? [],
    [content],
  );

  if (q.isLoading)
    return (
      <Shell>
        <Skel className="h-10 w-72" />
        <Skel className="mt-6 h-96" />
      </Shell>
    );
  if (q.isError || !p)
    return (
      <Shell>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Shell>
    );

  const s = STATUS[p.status];
  const canAccept = p.status !== "running" && p.status !== "unsupported" && !p.acceptedDocumentId;
  const accErr = accept.error ? describeError(accept.error) : null;

  function setFin(fi: FinancialInput | null) {
    setFinValid(!!fi);
    if (fi)
      setContent((c) =>
        c ? (synchronizeFinancialBlocks({ ...c, financialInput: fi }) as CanonicalDocument) : c,
      );
  }

  function save() {
    if (!content || !confirm || !title.trim() || !finValid) return;
    accept.mutate(
      { id, data: { title: title.trim().slice(0, 160), content, confirmBusinessDraft: true } },
      {
        onSuccess: (doc) => {
          void qc.invalidateQueries({ queryKey: getGetCustomerAIDraftQueryKey(id) });
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          leavingRef.current = true;
          setLocation("/workspace/documents/" + doc.id);
        },
      },
    );
  }

  return (
    <Shell>
      <Breadcrumbs
        className="mb-5"
        items={[
          { label: "Home", href: "/workspace" },
          { label: "Drafting assistant", href: "/workspace/ai" },
          { label: title.trim() || TASK_LABEL[p.task] },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className={"pill " + s.tone} data-testid="status-ai-preview">
          {p.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="dot" />
          {s.label}
        </span>
        <span className="pill pill-ink">{TASK_LABEL[p.task]}</span>
        <span className="pill pill-ink">Private preview</span>
      </div>
      <p className="mt-3 max-w-2xl text-muted-foreground" data-testid="text-ai-status">
        {s.text}
      </p>

      {p.status === "manual_fallback" && (
        <Notice className="mt-4" title="AI did not complete">
          No AI result is being shown. You can still review and save this manual draft.
        </Notice>
      )}

      {p.acceptedDocumentId && (
        <Notice className="mt-4" tone="forest" title="Already saved to your documents">
          <Link
            href={"/workspace/documents/" + p.acceptedDocumentId}
            className="btn btn-primary btn-sm mt-2"
            data-testid="link-accepted-document"
          >
            <FileCheck2 className="h-4 w-4" />
            Open the document
          </Link>
        </Notice>
      )}

      {p.status === "running" ? (
        <div className="mt-8 grid gap-3" aria-live="polite">
          <Skel className="h-12 w-2/3" />
          <Skel className="h-32" />
          <Skel className="h-32" />
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_19rem]">
          <div className="grid min-w-0 gap-6">
            {p.missingFields.length > 0 && (
              <div
                className="rounded-2xl border border-[hsl(38_50%_80%)] bg-[hsl(var(--ochre-soft))] p-5"
                data-testid="list-missing"
              >
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Still needed from you
                </p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {p.missingFields.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {content && (
              <>
                <div>
                  <label className="label" htmlFor="ai-title">
                    Title
                  </label>
                  <input
                    id="ai-title"
                    className="field font-display !text-xl"
                    maxLength={160}
                    value={title}
                    aria-invalid={!title.trim()}
                    disabled={!canAccept}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="input-ai-title"
                  />
                </div>
                <div className="surface grid gap-4 p-5 sm:p-7">
                  <p className="eyebrow">Key details (inserted as you typed them)</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate"] as const).map(
                      (k) => (
                        <div key={k}>
                          <label className="label !text-xs" htmlFor={"ai-f-" + k}>
                            {
                              {
                                issuerName: "From",
                                recipientName: "To",
                                documentNumber: "Reference",
                                issueDate: "Issue date",
                                dueDate: "Due date",
                              }[k]
                            }
                          </label>
                          <input
                            id={"ai-f-" + k}
                            type={k.endsWith("Date") ? "date" : "text"}
                            className="field"
                            disabled={!canAccept}
                            value={content.fields[k]}
                            onChange={(e) =>
                              setContent({ ...content, fields: { ...content.fields, [k]: e.target.value } })
                            }
                            data-testid={"input-ai-field-" + k}
                          />
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="surface grid gap-3 p-5 sm:p-7">
                  <p className="eyebrow">Narrative</p>
                  {narrative.map((b, i) => (
                    <textarea
                      key={b.id}
                      aria-label={"Section " + (i + 1)}
                      rows={Math.min(10, Math.max(3, b.text.split("\n").length + 1))}
                      className="field"
                      maxLength={8000}
                      disabled={!canAccept}
                      value={b.text}
                      onChange={(e) =>
                        setContent({
                          ...content,
                          blocks: content.blocks.map((x) =>
                            x.id === b.id ? { ...x, text: e.target.value } : x,
                          ),
                        })
                      }
                      data-testid={"input-ai-block-" + i}
                    />
                  ))}
                </div>
                {content.financialInput && (
                  <div className="surface p-5 sm:p-7">
                    <p className="eyebrow mb-4">Financial details</p>
                    {canAccept ? (
                      <FinancialFields
                        key={p.previewHash}
                        idPrefix="preview"
                        value={content.financialInput}
                        onChange={setFin}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Edit financial details in the saved draft.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="grid h-fit gap-4 lg:sticky lg:top-24">
            {canAccept && (
              <div className="surface p-5" data-testid="panel-accept">
                <p className="eyebrow">Save to your documents</p>
                <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                    data-testid="checkbox-confirm-draft"
                  />
                  <span>
                    I reviewed this. It is my own document, not legal, tax or accounting advice, and not
                    approved by anyone.
                  </span>
                </label>
                {!finValid && <p className="hint !text-destructive">Fix the financial details first.</p>}
                {accErr && (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    data-testid="status-accept-error"
                  >
                    {accErr.message} Your edits are still here.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary mt-4 w-full"
                  disabled={!confirm || !title.trim() || !finValid || accept.isPending}
                  onClick={save}
                  data-testid="button-accept-draft"
                >
                  {accept.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck2 className="h-4 w-4" />
                  )}
                  Save to my documents
                </button>
              </div>
            )}
            {p.status === "unsupported" && (
              <Link href="/workspace/ai" className="btn btn-ghost w-full" data-testid="link-new-request">
                Start a new request
              </Link>
            )}
            {p.limitations.length > 0 && (
              <div className="surface p-5">
                <p className="eyebrow">Limitations</p>
                <ul className="mt-2 grid gap-2 text-sm leading-relaxed">
                  {p.limitations.map((l) => (
                    <li key={l} className="border-l-2 border-border pl-3">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="surface p-5 text-xs" data-testid="card-ai-meta">
              <p className="eyebrow">Run record</p>
              <dl className="mt-2 grid gap-1.5">
                <Meta k="Recorded model" v={p.modelUsed ?? "No model completion recorded"} />
                <Meta
                  k="Outbound attempts"
                  v={p.providerCalls === null ? "Unconfirmed after interruption" : String(p.providerCalls)}
                />
                <Meta k="Input hash" v={p.inputHash.slice(0, 16)} />
                <Meta k="Preview hash" v={p.previewHash.slice(0, 16)} />
              </dl>
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => q.refetch()}
                data-testid="button-refresh-preview"
              >
                <RefreshCw className={cn("h-3 w-3", q.isFetching && "animate-spin")} />
                Refresh status
              </button>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Valo does not publish templates or legal guidance, prove payments, or decide tax rates or
              obligations.
            </p>
          </aside>
        </div>
      )}
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={accept.isPending}
        onDiscard={navigation.proceed}
        onStay={navigation.stay}
        description="You edited this preview without saving it to your documents. Stay here to review and save it, or leave and discard your edits."
      />
    </Shell>
  );
}
