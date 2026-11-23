import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Columns2, Download, List, Pilcrow, Printer, Redo2, Save, Table2, Undo2 } from "lucide-react";
import {
  useGetDocument,
  useListDocumentRevisions,
  useListDocuments,
  useSaveDocument,
  getGetDocumentQueryKey,
  getListDocumentRevisionsQueryKey,
  getListDocumentsQueryKey,
  type BusinessDocument,
  type CanonicalDocument,
  type DocumentBlock,
  type DocumentBlockType,
} from "@workspace/api-client-react";
import { ErrorState, Notice, Skel } from "@/components/states";
import { FIELD_LABELS, describeError, missingFieldItems, newBlockId } from "@/lib/api";
import { suggestedDocumentTitle } from "@/lib/document-list-helpers";
import { applyIssuerDetailsToGuided, extractReusableIssuerDetails } from "@/lib/guided-prefill";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DocumentExports } from "@/components/document-exports";
import { BlockEditor, SaveIndicator, type SaveState } from "@/components/document-editor-blocks";
import { DocPreview } from "@/components/document-preview";
import { DocumentRevisionsCard } from "@/components/document-revisions-card";
import { MakeAnother } from "@/components/make-another";
import { FinancialFields } from "@/components/financial-fields";
import { synchronizeFinancialBlocks } from "@workspace/valo-core/money";
import type { FinancialInput } from "@workspace/api-client-react";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuidedFields } from "@/components/guided-fields";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  GUIDED_PREFIX,
  guidedDataFromBlocks,
  compileGuidedContent,
} from "@workspace/valo-core/guided-runtime";

type Snapshot = { title: string; content: CanonicalDocument };
/** A question put to the customer before something they entered is discarded: what would be lost,
 * the button that keeps it, the button that goes ahead, and what going ahead does. */
type Asking = { title: string; body: string; keep: string; confirm: string; run: () => void };

const AUTOSAVE_MS = 1400;
const ser = (s: Snapshot) => JSON.stringify(s);

export default function DocumentEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const doc = useGetDocument(id, { query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) } });
  const revs = useListDocumentRevisions(id, {
    query: { enabled: !!id && doc.isSuccess, queryKey: getListDocumentRevisionsQueryKey(id) },
  });
  const otherDocs = useListDocuments({
    query: { enabled: !!id && doc.isSuccess, queryKey: getListDocumentsQueryKey() },
  });
  const saveMut = useSaveDocument();
  const mutateRef = useRef(saveMut.mutate);
  mutateRef.current = saveMut.mutate;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<CanonicalDocument | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [splitPreview, setSplitPreview] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [finDraft, setFinDraft] = useState<FinancialInput | null>(null);
  const [finKey, setFinKey] = useState(0);
  const [finDirty, setFinDirty] = useState(false);
  const financialDirty = useRef(false),
    financialValue = useRef<FinancialInput | null>(null);
  const leaveAfterSave = useRef(false);
  const [leaveError, setLeaveError] = useState("");
  const [reuseDocId, setReuseDocId] = useState("");
  const [reuseNotice, setReuseNotice] = useState("");
  const [asking, setAsking] = useState<Asking | null>(null);
  /** Whether a question is open. The autosave and the keyboard's save and undo wait for its answer. */
  const questionOpen = useRef(false);

  const initFor = useRef<string | null>(null);
  const baseRev = useRef(0);
  const lastSaved = useRef("");
  const latest = useRef<Snapshot | null>(null);
  const lastPush = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigation = useUnsavedNavigation(
    () =>
      financialDirty.current ||
      inFlight.current ||
      (!!latest.current && ser(latest.current) !== lastSaved.current),
  );
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const resetFinancial = useCallback((next: CanonicalDocument) => {
    financialDirty.current = false;
    financialValue.current = next.financialInput ?? null;
    setFinDirty(false);
    setFinDraft(next.financialInput ?? null);
    setFinKey((key) => key + 1);
  }, []);

  const adopt = useCallback(
    (d: BusinessDocument) => {
      baseRev.current = d.revision;
      const snap = { title: d.title, content: d.content };
      lastSaved.current = ser(snap);
      latest.current = snap;
      setTitle(d.title);
      setContent(d.content);
      resetFinancial(d.content);
      setHistory([]);
      setRedoStack([]);
      setConflictRev(null);
      setState("saved");
    },
    [resetFinancial],
  );

  useEffect(() => {
    if (doc.data && initFor.current !== id) {
      initFor.current = id;
      adopt(doc.data);
    }
  }, [doc.data, id, adopt]);

  const doSave = useCallback(() => {
    const snap = latest.current;
    if (!snap || inFlight.current) return;
    // Nothing is saved underneath an open question. The answer starts the autosave again.
    if (questionOpen.current) return;
    if (ser(snap) === lastSaved.current) {
      setState("saved");
      return;
    }
    if (!snap.title.trim()) {
      setState("blocked");
      return;
    }
    inFlight.current = true;
    setState("saving");
    const sent = ser(snap);
    mutateRef.current(
      { id, data: { expectedRevision: baseRev.current, title: snap.title.trim(), content: snap.content } },
      {
        onSuccess: (d) => {
          inFlight.current = false;
          baseRev.current = d.revision;
          lastSaved.current = sent;
          qc.setQueryData(getGetDocumentQueryKey(id), d);
          const revKey = getListDocumentRevisionsQueryKey(id);
          if (qc.getQueryData<BusinessDocument[]>(revKey)) {
            qc.setQueryData<BusinessDocument[]>(revKey, (prev) =>
              [d, ...(prev ?? []).filter((r) => r.revision !== d.revision)].slice(0, 100),
            );
          } else {
            void qc.invalidateQueries({ queryKey: revKey });
          }
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          if (latest.current && ser(latest.current) !== sent) {
            setState("dirty");
            timer.current = setTimeout(doSaveRef.current, AUTOSAVE_MS);
          } else {
            setState("saved");
            if (leaveAfterSave.current && !financialDirty.current) {
              leaveAfterSave.current = false;
              navigationRef.current.proceed();
            }
          }
        },
        onError: (e) => {
          inFlight.current = false;
          leaveAfterSave.current = false;
          const de = describeError(e);
          if (de.kind === "conflict") {
            setConflictRev(de.currentRevision ?? null);
            setState("conflict");
          } else {
            setErrMsg(de.message);
            setState("error");
          }
        },
      },
    );
  }, [id, qc]);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  function update(next: Snapshot) {
    const prev = latest.current;
    latest.current = next;
    setTitle(next.title);
    setContent(next.content);
    const now = Date.now();
    if (prev && now - lastPush.current > 800) {
      setHistory((h) => [...h.slice(-49), prev]);
      lastPush.current = now;
    }
    setRedoStack([]);
    if (state === "conflict") return;
    setState(ser(next) === lastSaved.current ? "saved" : "dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /**
   * Asks before something the customer entered is discarded. The browser's own box stopped the page
   * while it was open. This dialog does not, so the autosave and the keyboard's save and undo wait
   * for the answer: a save on its way when the customer chose would make the choice do nothing.
   */
  function ask(question: Asking) {
    questionOpen.current = true;
    setAsking(question);
  }
  /** The answer: `run` is what going ahead does, and keeping runs nothing. */
  function answered(run?: () => void) {
    questionOpen.current = false;
    setAsking(null);
    run?.();
    // Text that was waiting to be saved is saved as it would have been.
    if (state === "dirty" && !inFlight.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
    }
  }
  const answeredRef = useRef(answered);
  answeredRef.current = answered;
  // Leaving asks its own question, about everything that is not saved. A question still open
  // underneath it is answered by keeping, the answer that discards nothing: otherwise "Save and
  // leave" would wait on a question the customer could no longer reach.
  useEffect(() => {
    if (navigation.blocked && questionOpen.current) answeredRef.current();
  }, [navigation.blocked]);

  function undo() {
    // With nothing to undo there is nothing to ask about.
    if (inFlight.current || !history.length) return;
    if (financialDirty.current)
      ask({
        title: "Undo, and discard the amounts you have not applied?",
        body: "You have changed amounts that are not applied yet. Undoing your last change discards them.",
        keep: "Keep them",
        confirm: "Discard them and undo",
        run: undoNow,
      });
    else undoNow();
  }
  function undoNow() {
    if (inFlight.current) return;
    const current = latest.current;
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1]!;
      if (current) setRedoStack((r) => [...r.slice(-49), current]);
      latest.current = prev;
      setTitle(prev.title);
      setContent(prev.content);
      resetFinancial(prev.content);
      lastPush.current = 0;
      if (state !== "conflict") {
        setState(ser(prev) === lastSaved.current ? "saved" : "dirty");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
      }
      return h.slice(0, -1);
    });
  }
  function redo() {
    if (inFlight.current || !redoStack.length) return;
    if (financialDirty.current)
      ask({
        title: "Redo, and discard the amounts you have not applied?",
        body: "You have changed amounts that are not applied yet. Redoing your last change discards them.",
        keep: "Keep them",
        confirm: "Discard them and redo",
        run: redoNow,
      });
    else redoNow();
  }
  function redoNow() {
    if (inFlight.current) return;
    const current = latest.current;
    setRedoStack((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1]!;
      if (current) setHistory((h) => [...h.slice(-49), current]);
      latest.current = next;
      setTitle(next.title);
      setContent(next.content);
      resetFinancial(next.content);
      lastPush.current = 0;
      if (state !== "conflict") {
        setState(ser(next) === lastSaved.current ? "saved" : "dirty");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
      }
      return r.slice(0, -1);
    });
  }
  function applyFinancial() {
    if (!latest.current || !financialValue.current) {
      setLeaveError("Correct the financial fields before saving. What you typed is still here.");
      return false;
    }
    const next = {
      ...latest.current,
      content: synchronizeFinancialBlocks({
        ...latest.current.content,
        financialInput: financialValue.current,
      }) as CanonicalDocument,
    };
    update(next);
    resetFinancial(next.content);
    setLeaveError("");
    return true;
  }
  function saveEverything(leave = false) {
    if (state === "conflict") {
      setLeaveError(
        "This document was changed somewhere else. Choose which version to keep before you leave.",
      );
      return;
    }
    if (financialDirty.current && !applyFinancial()) return;
    leaveAfterSave.current = leave;
    if (timer.current) clearTimeout(timer.current);
    if (leave && !inFlight.current && latest.current && ser(latest.current) === lastSaved.current) {
      leaveAfterSave.current = false;
      navigation.proceed();
      return;
    }
    doSaveRef.current();
  }
  const manualSave = useRef(saveEverything);
  manualSave.current = saveEverything;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!questionOpen.current) manualSave.current();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey &&
        !(target && /INPUT|TEXTAREA/.test(target.tagName))
      ) {
        e.preventDefault();
        if (!questionOpen.current) undoRef.current();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") &&
        !(target && /INPUT|TEXTAREA/.test(target.tagName))
      ) {
        e.preventDefault();
        if (!questionOpen.current) redoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  async function keepMine() {
    const r = await doc.refetch();
    if (r.data) baseRev.current = r.data.revision;
    else if (conflictRev) baseRev.current = conflictRev;
    void revs.refetch();
    setConflictRev(null);
    setState("dirty");
    doSaveRef.current();
  }
  async function takeTheirs() {
    const r = await doc.refetch();
    if (r.data) adopt(r.data);
    void revs.refetch();
  }

  function restore(r: BusinessDocument) {
    if (!latest.current) return;
    if (inFlight.current) return;
    if (financialDirty.current || ser(latest.current) !== lastSaved.current)
      ask({
        title: `Restore version ${r.revision}?`,
        body: `You have changes that are not saved, including any amounts you have not applied. Restoring version ${r.revision} replaces them.`,
        keep: "Keep my changes",
        confirm: `Replace them with version ${r.revision}`,
        run: () => restoreNow(r),
      });
    else restoreNow(r);
  }
  function restoreNow(r: BusinessDocument) {
    if (!latest.current) return;
    if (inFlight.current) return;
    if (timer.current) clearTimeout(timer.current);
    setRestoring(r.revision);
    inFlight.current = true;
    setState("saving");
    mutateRef.current(
      { id, data: { expectedRevision: baseRev.current, title: r.title, content: r.content } },
      {
        onSuccess: (d) => {
          inFlight.current = false;
          setRestoring(null);
          qc.setQueryData(getGetDocumentQueryKey(id), d);
          const revKey = getListDocumentRevisionsQueryKey(id);
          if (qc.getQueryData<BusinessDocument[]>(revKey)) {
            qc.setQueryData<BusinessDocument[]>(revKey, (prev) =>
              [d, ...(prev ?? []).filter((r) => r.revision !== d.revision)].slice(0, 100),
            );
          } else {
            void qc.invalidateQueries({ queryKey: revKey });
          }
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          adopt(d);
        },
        onError: (e) => {
          inFlight.current = false;
          setRestoring(null);
          const de = describeError(e);
          if (de.kind === "conflict") {
            setConflictRev(de.currentRevision ?? null);
            setState("conflict");
          } else {
            setErrMsg(de.message);
            setState("error");
          }
        },
      },
    );
  }

  if (doc.isLoading || (doc.isSuccess && !content)) {
    return (
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 lg:grid-cols-[1fr_20rem] lg:px-8">
        <Skel className="h-[36rem]" />
        <Skel className="h-80" />
      </div>
    );
  }
  if (doc.isError || !content || !doc.data) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <ErrorState error={doc.error} onRetry={() => doc.refetch()} />
        <Link href="/workspace/documents" className="btn btn-ghost btn-sm mt-4">
          Back to your documents
        </Link>
      </div>
    );
  }

  const missing = missingFieldItems(content);
  function focusEditorTarget(selector: string) {
    if (tab !== "edit") setTab("edit");
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus();
    });
  }
  function removeBlock(block: DocumentBlock) {
    const hasContent =
      block.text.trim().length > 0 || block.rows.some((row) => row.some((cell) => cell.trim().length > 0));
    const run = () => setBlocks(content!.blocks.filter((x) => x.id !== block.id));
    if (hasContent) {
      ask({
        title: "Delete this block?",
        body: "This removes the text or table from the document. You can still bring it back with Undo before leaving.",
        keep: "Keep it",
        confirm: "Delete block",
        run,
      });
    } else {
      run();
    }
  }
  let guided: ReturnType<typeof guidedDataFromBlocks> = null;
  let guidedError = "";
  try {
    guided = guidedDataFromBlocks(content.blocks);
  } catch {
    guidedError =
      "This document's saved questions cannot be loaded safely. Restore an earlier version rather than removing its questions.";
  }
  const manualBlocks = content.blocks.filter((b) => !b.id.startsWith(GUIDED_PREFIX));
  const setFields = (k: keyof CanonicalDocument["fields"], v: string) =>
    update({ title, content: { ...content, fields: { ...content.fields, [k]: v } } });
  const setBlocks = (blocks: DocumentBlock[]) => update({ title, content: { ...content, blocks } });
  const addBlock = (type: DocumentBlockType) =>
    setBlocks([
      ...content.blocks,
      {
        id: newBlockId(),
        type,
        text: "",
        rows:
          type === "table"
            ? [
                ["", ""],
                ["", ""],
              ]
            : [],
      },
    ]);
  const saved = doc.data;
  const titleSuggestion = suggestedDocumentTitle(title, content);
  const reusableSources = guided
    ? (otherDocs.data ?? [])
        .filter((candidate) => candidate.id !== id)
        .map((candidate) => {
          const details = extractReusableIssuerDetails(candidate);
          const applicable = applyIssuerDetailsToGuided(guided, details).appliedLabels;
          return { doc: candidate, details, applicable };
        })
        .filter((entry) => entry.applicable.length > 0)
    : [];
  const selectedSource =
    reusableSources.find((entry) => entry.doc.id === reuseDocId) ?? reusableSources[0] ?? null;

  function applySelectedIssuerDetails() {
    if (!guided || !content || !selectedSource) return;
    const { data, appliedLabels } = applyIssuerDetailsToGuided(guided, selectedSource.details);
    if (!appliedLabels.length) return;
    update({ title, content: compileGuidedContent(data, content) as CanonicalDocument });
    setReuseNotice(
      `Filled ${appliedLabels.join(", ")} from "${selectedSource.doc.title}". Review these details before downloading.`,
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={state === "saving"}
        onSave={() => saveEverything(true)}
        onStay={() => {
          leaveAfterSave.current = false;
          setLeaveError("");
          navigation.stay();
        }}
        onDiscard={() => {
          if (timer.current) clearTimeout(timer.current);
          navigation.proceed();
        }}
        error={leaveError || undefined}
      />
      <ConfirmDialog
        open={asking !== null}
        title={asking?.title ?? ""}
        keep={asking?.keep ?? ""}
        confirm={asking?.confirm ?? ""}
        onKeep={() => answered()}
        onConfirm={() => answered(asking?.run)}
      >
        {asking?.body}
      </ConfirmDialog>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/workspace" },
            { label: "Your documents", href: "/workspace/documents", testId: "link-back" },
            { label: title.trim() || "Untitled document" },
          ]}
        />
        <SaveIndicator
          state={finDirty ? "dirty" : state}
          rev={baseRev.current}
          onRetry={() => saveEverything()}
        />
      </div>

      <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="pill pill-ink" data-testid="status-doc">
          Draft
        </span>
        <span data-testid="text-doc-standing">Your own document: not a Valo template, and not reviewed.</span>
      </p>
      <label className="sr-only" htmlFor="doc-title">
        Title
      </label>
      <h1 className="sr-only">Document editor</h1>
      <input
        id="doc-title"
        value={title}
        maxLength={160}
        onChange={(e) => update({ title: e.target.value, content })}
        placeholder="Title of this document"
        aria-invalid={!title.trim()}
        className="document-title no-print font-display mt-3 w-full rounded-md bg-transparent text-4xl leading-tight placeholder:text-muted-foreground/60 sm:text-5xl"
        data-testid="input-title"
      />
      {!title.trim() && (
        <p className="hint no-print !text-destructive">Give the document a title so that it can be saved.</p>
      )}
      {titleSuggestion && (
        <div className="no-print mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Make this easier to spot in your list:</span>
          <button
            type="button"
            className="rounded-full border border-border bg-card px-3 py-1 font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => update({ title: titleSuggestion, content })}
            data-testid="button-suggest-title"
          >
            Rename to &ldquo;{titleSuggestion}&rdquo;
          </button>
        </div>
      )}

      {state === "conflict" && (
        <Notice
          className="mt-5"
          title={"Changed somewhere else" + (conflictRev ? " — now at version " + conflictRev : "")}
        >
          This document was saved in another tab or on another device after you opened it here. What you typed
          here is still on the screen and has not been lost.
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" onClick={keepMine} data-testid="button-keep-mine">
              Save mine as the newest version
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                ask({
                  title: "Discard what you typed here?",
                  body: "The newest saved version is loaded in its place. What you typed here is not kept.",
                  keep: "Keep what I typed",
                  confirm: "Discard mine and load the newest",
                  run: () => void takeTheirs(),
                })
              }
              data-testid="button-load-theirs"
            >
              Discard mine and load the newest
            </button>
          </div>
        </Notice>
      )}
      {state === "error" && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errMsg} What you typed is still here.
        </p>
      )}
      {finDirty && content.financialInput && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-4 py-3 text-sm text-[hsl(var(--ochre-foreground))]"
          data-testid="banner-financial-pending"
        >
          <p>Financial details have unapplied changes that are not saved yet.</p>
          <div className="flex flex-wrap gap-2">
            {finDraft && JSON.stringify(finDraft) !== JSON.stringify(content.financialInput) ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={applyFinancial}
                data-testid="button-apply-financial-top"
              >
                Apply amounts now
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => focusEditorTarget('[data-testid="panel-financial"]')}
              >
                Review financial details
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
            <div
              className="inline-flex rounded-full border border-border p-1"
              role="tablist"
              aria-label="Document view"
            >
              {(["edit", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={"editor-tab-" + t}
                  aria-controls={"editor-" + t + "-panel"}
                  aria-selected={tab === t}
                  tabIndex={tab === t ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                    e.preventDefault();
                    const next =
                      e.key === "Home"
                        ? "edit"
                        : e.key === "End"
                          ? "preview"
                          : t === "edit"
                            ? "preview"
                            : "edit";
                    setTab(next);
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>("#editor-tab-" + next)
                      ?.focus();
                  }}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    tab === t ? "bg-foreground text-background" : "hover:bg-secondary",
                  )}
                  data-testid={"tab-" + t}
                >
                  {t === "preview" ? "Preview" : "Edit"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {state === "dirty" && !finDirty && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => saveEverything()}
                  title="Save now (Ctrl+S)"
                  data-testid="button-save-now"
                >
                  <Save className="h-4 w-4" aria-hidden="true" /> Save now
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={undo}
                disabled={!history.length}
                title="Undo (Ctrl+Z)"
                data-testid="button-undo"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={redo}
                disabled={!redoStack.length}
                title="Redo (Ctrl+Shift+Z)"
                data-testid="button-redo"
              >
                <Redo2 className="h-4 w-4" aria-hidden="true" /> Redo
              </button>
              {tab === "edit" && (
                <button
                  type="button"
                  className={cn("btn btn-ghost btn-sm hidden xl:inline-flex", splitPreview && "bg-secondary")}
                  aria-pressed={splitPreview}
                  onClick={() => setSplitPreview((open) => !open)}
                  data-testid="button-split-preview"
                >
                  <Columns2 className="h-4 w-4" aria-hidden="true" /> Side-by-side preview
                </button>
              )}
              {tab === "preview" && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => window.print()}
                  data-testid="button-toolbar-print"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" /> Print
                </button>
              )}
              <a href="#private-exports" className="btn btn-ghost btn-sm" data-testid="button-export">
                <Download className="h-4 w-4" aria-hidden="true" /> Download
              </a>
            </div>
          </div>

          <div
            hidden
            role="tabpanel"
            id={tab === "edit" ? "editor-preview-panel" : "editor-edit-panel"}
            aria-labelledby={tab === "edit" ? "editor-tab-preview" : "editor-tab-edit"}
          />
          {tab === "preview" ? (
            <div role="tabpanel" id="editor-preview-panel" aria-labelledby="editor-tab-preview" tabIndex={0}>
              {(state !== "saved" || finDirty) && (
                <p className="no-print mb-3 text-sm text-muted-foreground">
                  Live preview of what is currently in the editor.{" "}
                  {finDirty ? (
                    <>
                      Unapplied changes in Financial details are not included until you apply them.{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-4"
                        onClick={() => focusEditorTarget('[data-testid="panel-financial"]')}
                      >
                        Go to Financial details
                      </button>
                    </>
                  ) : (
                    "Your changes are being saved automatically."
                  )}
                </p>
              )}
              <DocPreview title={title || saved.title} content={content} revision={baseRev.current} />
            </div>
          ) : (
            <div className={cn(splitPreview && "xl:grid xl:grid-cols-2 xl:items-start xl:gap-6")}>
              <div
                className="surface p-5 sm:p-8"
                role="tabpanel"
                id="editor-edit-panel"
                aria-labelledby="editor-tab-edit"
                tabIndex={0}
              >
                {guidedError && (
                  <p role="alert" className="mb-5 text-sm text-destructive">
                    {guidedError}
                  </p>
                )}
                {guided ? (
                  <>
                    {reusableSources.length > 0 && !guidedError && (
                      <div
                        className="mb-6 rounded-2xl border border-border bg-sidebar/40 p-4"
                        data-testid="bar-reuse-issuer"
                      >
                        <p className="text-sm font-medium">Reuse your business details</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Copy only your saved sender details (such as business name, address, or payment
                          instructions) from a previous document. Customer details, references, dates, and
                          amounts stay untouched.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="sr-only" htmlFor="select-reuse-issuer">
                            Choose a previous document
                          </label>
                          <select
                            id="select-reuse-issuer"
                            className="field min-w-[12rem] flex-1 !min-h-9 !py-1.5 text-sm"
                            value={selectedSource?.doc.id ?? ""}
                            onChange={(e) => setReuseDocId(e.target.value)}
                            data-testid="select-reuse-issuer"
                          >
                            {reusableSources.map((entry) => (
                              <option key={entry.doc.id} value={entry.doc.id}>
                                {entry.doc.title}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={applySelectedIssuerDetails}
                            data-testid="button-apply-reuse-issuer"
                          >
                            Fill sender details
                          </button>
                        </div>
                        {reuseNotice && (
                          <p
                            role="status"
                            className="mt-2 text-xs text-primary"
                            data-testid="status-reuse-issuer"
                          >
                            {reuseNotice}
                          </p>
                        )}
                      </div>
                    )}
                    <GuidedFields
                      spec={GUIDED_SPECS_V1[guided.templateId]}
                      value={guided}
                      disabled={!!guidedError}
                      onChange={(next) =>
                        update({ title, content: compileGuidedContent(next, content) as CanonicalDocument })
                      }
                    />
                  </>
                ) : (
                  <>
                    <p className="eyebrow mb-4">Key details</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["issuerName", "recipientName", "documentNumber"] as const).map((k) => (
                        <div key={k}>
                          <label className="label" htmlFor={"f-" + k}>
                            {FIELD_LABELS[k]}
                          </label>
                          <input
                            id={"f-" + k}
                            className="field"
                            maxLength={k === "documentNumber" ? 80 : 160}
                            value={content.fields[k]}
                            onChange={(e) => setFields(k, e.target.value)}
                            data-testid={"input-field-" + k}
                          />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-3">
                        {(["issueDate", "dueDate"] as const).map((k) => (
                          <div key={k}>
                            <label className="label" htmlFor={"f-" + k}>
                              {FIELD_LABELS[k]}
                            </label>
                            <input
                              id={"f-" + k}
                              type="date"
                              className="field"
                              value={content.fields[k]}
                              onChange={(e) => setFields(k, e.target.value)}
                              data-testid={"input-field-" + k}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {content.financialInput && (
                  <div
                    className="mt-10 rounded-2xl border border-border bg-sidebar/50 p-4 sm:p-5"
                    data-testid="panel-financial"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="eyebrow">Financial details</p>
                      <span className="text-xs text-muted-foreground">
                        The document&rsquo;s tables update when you apply your changes
                      </span>
                    </div>
                    <FinancialFields
                      key={"fin-" + finKey}
                      idPrefix="doc"
                      value={content.financialInput}
                      onChange={(value) => {
                        financialValue.current = value;
                        setFinDraft(value);
                      }}
                      onDirtyChange={(dirty) => {
                        financialDirty.current = dirty;
                        setFinDirty(dirty);
                        if (dirty) {
                          financialValue.current = null;
                          setFinDraft(null);
                        }
                      }}
                    />
                    {finDirty && (
                      <p
                        role="status"
                        className="hint !text-destructive"
                        data-testid="status-financial-unsaved"
                      >
                        You have changed amounts that are not applied, so they are not saved. Apply them
                        before you download or leave.
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={
                          !finDirty ||
                          !finDraft ||
                          JSON.stringify(finDraft) === JSON.stringify(content.financialInput)
                        }
                        onClick={applyFinancial}
                        data-testid="button-apply-financial"
                      >
                        Apply these amounts
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (financialDirty.current)
                            ask({
                              title: "Discard the amounts you have not applied?",
                              body: "The amounts go back to the ones last applied to the document.",
                              keep: "Keep them",
                              confirm: "Discard them",
                              // The document as it is when the answer comes, not as it was when asked.
                              run: () => resetFinancial(latest.current?.content ?? content),
                            });
                          else resetFinancial(content);
                        }}
                        data-testid="button-reset-financial"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}

                <p className="eyebrow mb-4 mt-10">Text and tables</p>
                <ol className="grid gap-3">
                  {manualBlocks.map((b, i) => (
                    <BlockEditor
                      key={b.id}
                      block={b}
                      index={i}
                      count={manualBlocks.length}
                      onChange={(nb) => setBlocks(content.blocks.map((x) => (x.id === b.id ? nb : x)))}
                      onMove={(dir) => {
                        const a = [...content.blocks];
                        const from = a.findIndex((x) => x.id === b.id),
                          j = a.findIndex((x) => x.id === manualBlocks[i + dir]?.id);
                        if (from >= 0 && j >= 0) {
                          [a[from], a[j]] = [a[j]!, a[from]!];
                          setBlocks(a);
                        }
                      }}
                      onDelete={() => removeBlock(b)}
                    />
                  ))}
                </ol>
                {content.blocks.length < 100 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => addBlock("paragraph")}
                      data-testid="button-add-paragraph"
                    >
                      <Pilcrow className="h-4 w-4" aria-hidden="true" /> Add a paragraph
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => addBlock("list")}
                      data-testid="button-add-list"
                    >
                      <List className="h-4 w-4" aria-hidden="true" /> Add a list
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => addBlock("table")}
                      data-testid="button-add-table"
                    >
                      <Table2 className="h-4 w-4" aria-hidden="true" /> Add a table
                    </button>
                  </div>
                )}

                <div className="mt-10">
                  <label className="label" htmlFor="f-notes">
                    {FIELD_LABELS.notes}
                  </label>
                  <textarea
                    id="f-notes"
                    className="field min-h-24"
                    maxLength={5000}
                    value={content.fields.notes}
                    onChange={(e) => setFields("notes", e.target.value)}
                    data-testid="input-field-notes"
                  />
                </div>

                <div className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="fmt-font">
                      Lettering
                    </label>
                    <select
                      id="fmt-font"
                      className="field"
                      value={content.formatting.font}
                      onChange={(e) =>
                        update({
                          title,
                          content: {
                            ...content,
                            formatting: { ...content.formatting, font: e.target.value as "sans" | "serif" },
                          },
                        })
                      }
                      data-testid="select-font"
                    >
                      <option value="serif">Classic (serif)</option>
                      <option value="sans">Plain (sans-serif)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="fmt-accent">
                      Colour
                    </label>
                    <select
                      id="fmt-accent"
                      className="field"
                      value={content.formatting.accent}
                      onChange={(e) =>
                        update({
                          title,
                          content: {
                            ...content,
                            formatting: {
                              ...content.formatting,
                              accent: e.target.value as "forest" | "charcoal",
                            },
                          },
                        })
                      }
                      data-testid="select-accent"
                    >
                      <option value="forest">Green</option>
                      <option value="charcoal">Dark grey</option>
                    </select>
                  </div>
                </div>
              </div>
              {splitPreview && (
                <div className="hidden xl:sticky xl:top-24 xl:block" aria-label="Live preview">
                  <p className="eyebrow mb-3">Live preview</p>
                  <DocPreview title={title || saved.title} content={content} revision={baseRev.current} />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="no-print grid h-fit gap-4 lg:sticky lg:top-24">
          <div className="surface p-5" id="still-needed-card" data-testid="card-missing">
            <p className="eyebrow">Still needed</p>
            {missing.length ? (
              <ul className="mt-3 grid gap-1.5 text-sm">
                {missing.map((m) => (
                  <li key={m.label}>
                    {m.selector ? (
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-md text-left transition-colors hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => focusEditorTarget(m.selector!)}
                      >
                        <span
                          className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--ochre))]"
                          aria-hidden="true"
                        />
                        {m.label}
                      </button>
                    ) : (
                      <span className="flex items-start gap-2">
                        <span
                          className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--ochre))]"
                          aria-hidden="true"
                        />
                        {m.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> Nothing is missing from
                the details Valo checks. Read the whole document before you use it.
              </p>
            )}
            <p className="hint mt-3">
              {missing.length
                ? "Select any item above to jump straight to it. A document saves with details missing; Valo fills nothing in for you."
                : "A document saves with details missing. Valo fills nothing in for you."}
            </p>
          </div>
          <DocumentRevisionsCard
            revisions={revs.data}
            isLoading={revs.isLoading}
            isError={revs.isError}
            error={revs.error}
            onRetry={() => void revs.refetch()}
            currentRevision={baseRev.current}
            restoring={restoring}
            saving={state === "saving"}
            onRestore={restore}
          />
          <DocumentExports
            documentId={id}
            documentTitle={title.trim() || saved.title}
            revisionId={doc.data.revisionId}
            revisionNumber={doc.data.revision}
            disabled={finDirty || !["idle", "saved"].includes(state)}
            missingCount={missing.length}
            finDirty={finDirty}
            onSaveNow={() => saveEverything()}
            onApplyFinancial={applyFinancial}
            onPrintPreview={() => {
              setTab("preview");
              setTimeout(() => window.print(), 120);
            }}
            onJumpToFinancial={() => focusEditorTarget('[data-testid="panel-financial"]')}
            onJumpToMissing={() => {
              document
                .getElementById("still-needed-card")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
          <MakeAnother saved={doc.data} unsaved={finDirty || !["idle", "saved"].includes(state)} />
        </aside>
      </div>
      <div
        className="held-actions sticky bottom-20 z-20 mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2.5 shadow-[var(--shadow-md)] backdrop-blur lg:hidden"
        aria-label="Quick document actions"
        data-testid="bar-mobile-editor"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setTab(tab === "edit" ? "preview" : "edit")}
            data-testid="button-mobile-toggle-preview"
          >
            {tab === "edit" ? "Preview" : "Back to edit"}
          </button>
          {finDirty ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={applyFinancial}
              data-testid="button-mobile-apply-financial"
            >
              Apply totals
            </button>
          ) : state === "dirty" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => saveEverything()}
              data-testid="button-mobile-save"
            >
              <Save className="h-4 w-4" aria-hidden="true" /> Save
            </button>
          ) : null}
        </div>
        <a href="#private-exports" className="btn btn-ink btn-sm" data-testid="link-mobile-export">
          <Download className="h-4 w-4" aria-hidden="true" /> Download
        </a>
      </div>
    </div>
  );
}
