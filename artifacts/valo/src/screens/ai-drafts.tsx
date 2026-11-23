import { useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, FilePenLine, Loader2, Plus, Sparkles, X } from "lucide-react";
import {
  useCreateCustomerAIDraft,
  useGetCustomerAIUsage,
  useCreateDocument,
  getGetCustomerAIDraftQueryKey,
  getGetCustomerAIUsageQueryKey,
  getListDocumentsQueryKey,
  getGetWorkspaceQueryKey,
  CustomerAITask,
  CustomerAIInputTone,
  type CustomerAIInput,
  type CanonicalDocument,
  type FinancialInput,
} from "@workspace/api-client-react";
import { buildBusinessDraft, customerComposerNotes } from "@workspace/valo-core/customer-document";
import { Section, TASKS, TASK_LABEL, Text, UsageCard } from "@/components/ai-draft-shared";
import { WorkspaceNav } from "@/components/workspace-nav";
import { FinancialFields, emptyFinancial } from "@/components/financial-fields";
import { describeError } from "@/lib/api";
import { live } from "@/lib/checker";
import { resolveIdempotencyKey, type IdempotencySlot } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
export { AIDraftPreview } from "./ai-draft-preview";

/* ------------------------------ Compose ------------------------------ */

export function AIDraftCompose() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const usage = useGetCustomerAIUsage({ query: { queryKey: getGetCustomerAIUsageQueryKey(), ...live } });
  const create = useCreateCustomerAIDraft();
  const manual = useCreateDocument();

  const [task, setTask] = useState<CustomerAITask>("invoice");
  const [tone, setTone] = useState<CustomerAIInputTone>("neutral");
  const [fields, setFields] = useState({
    issuerName: "",
    recipientName: "",
    documentNumber: "",
    issueDate: "",
    dueDate: "",
  });
  const [lines, setLines] = useState<{ text: string; send: boolean }[]>([{ text: "", send: true }]);
  const [fin, setFin] = useState<FinancialInput | null>(emptyFinancial("invoice"));
  const [finKey, setFinKey] = useState(0);
  const [consent, setConsent] = useState(false);
  const [draftingInstruction, setDraftingInstruction] = useState("");
  const keyRef = useRef<IdempotencySlot>(null);
  const [touched, setTouched] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);

  function pickTask(t: CustomerAITask) {
    if (t === task) return;
    setTask(t);
    setFin(emptyFinancial(t));
    setFinKey((k) => k + 1);
    keyRef.current = null;
  }

  const selected = customerComposerNotes(lines, "ai");
  const lineTooLong = lines.some((l) => l.text.length > 1000);
  const problems: string[] = [];
  if (!fin) problems.push("Fix the amounts in Financial details.");
  if (lineTooLong) problems.push("Each note must be under 1,000 characters.");

  function buildFacts(): Omit<CustomerAIInput, "idempotencyKey"> | null {
    if (!fin) return null;
    return {
      task,
      tone,
      ...fields,
      issuerName: fields.issuerName.trim(),
      recipientName: fields.recipientName.trim(),
      documentNumber: fields.documentNumber.trim(),
      contextLines: selected.slice(0, 20),
      draftingInstruction,
      financialInput: { ...fin, kind: task },
      processingConsent: consent,
    };
  }

  function submitAI(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    const facts = buildFacts();
    if (!facts || problems.length || !consent) return;
    const slot = resolveIdempotencyKey(keyRef.current, facts);
    keyRef.current = slot;
    create.mutate(
      { data: { ...facts, idempotencyKey: slot.key } },
      {
        onSuccess: (p) => {
          qc.setQueryData(getGetCustomerAIDraftQueryKey(p.id), p);
          void qc.invalidateQueries({ queryKey: getGetCustomerAIUsageQueryKey() });
          keyRef.current = null;
          setLocation("/workspace/ai/" + p.id);
        },
        onSettled: () => void qc.invalidateQueries({ queryKey: getGetCustomerAIUsageQueryKey() }),
      },
    );
  }

  function submitManual() {
    setTouched(true);
    setManualErr(null);
    const facts = buildFacts();
    if (!facts || problems.length) return;
    let draft: ReturnType<typeof buildBusinessDraft>;
    try {
      draft = buildBusinessDraft({ ...facts, contextLines: customerComposerNotes(lines, "manual") }, null);
    } catch (er) {
      setManualErr("These details could not be assembled: " + (er as Error).message);
      return;
    }
    manual.mutate(
      { data: { title: draft.title || TASK_LABEL[task], content: draft.content as CanonicalDocument } },
      {
        onSuccess: (doc) => {
          void qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
          setLocation("/workspace/documents/" + doc.id);
        },
      },
    );
  }

  const u = usage.data;
  const aiBlocked = !!u && (!u.enabled || !u.globalAvailable || u.workspaceUsed >= u.workspaceDailyLimit);
  const aiErr = create.error ? describeError(create.error) : null;
  const manErr = manual.error ? describeError(manual.error) : null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal max-w-3xl">
        <p className="eyebrow">Drafting assistant</p>
        <h1 className="font-display mt-2 text-4xl leading-[1.08] sm:text-5xl">
          Your facts, arranged. Nothing invented.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          The assistant only sorts the notes you give it and picks short connecting phrases. Names and amounts
          are placed exactly as you typed them, and totals are worked out to the exact kobo.
        </p>
      </header>

      <form onSubmit={submitAI} noValidate className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 gap-6">
          <Section n="1" title="What are you preparing?">
            <div role="radiogroup" aria-label="Document type" className="grid gap-2 sm:grid-cols-2">
              {TASKS.map((t) => (
                <label
                  key={t.id}
                  className={cn(
                    "cursor-pointer rounded-xl border p-4 transition-all has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                    task === t.id
                      ? "border-primary bg-accent/60 shadow-[var(--shadow-sm)]"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  <input
                    type="radio"
                    name="task"
                    className="sr-only"
                    checked={task === t.id}
                    onChange={() => pickTask(t.id)}
                    data-testid={"radio-task-" + t.id}
                  />
                  <span className="flex items-center justify-between font-medium">
                    {t.label}
                    {task === t.id && <Check className="h-4 w-4 text-primary" />}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t.blurb}</span>
                </label>
              ))}
            </div>
            <fieldset className="mt-5">
              <legend className="label">Tone</legend>
              <div className="inline-flex rounded-full border border-border bg-card p-1">
                {Object.values(CustomerAIInputTone).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      "cursor-pointer rounded-full px-4 py-1.5 text-sm capitalize has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      tone === t
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="tone"
                      className="sr-only"
                      checked={tone === t}
                      onChange={() => setTone(t)}
                      data-testid={"radio-tone-" + t}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section
            n="2"
            title="Key details"
            hint="Inserted verbatim by the server. Not sent to the AI provider."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Text
                id="issuerName"
                label="From (your business)"
                max={160}
                v={fields.issuerName}
                on={(v) => setFields({ ...fields, issuerName: v })}
              />
              <Text
                id="recipientName"
                label="To (customer)"
                max={160}
                v={fields.recipientName}
                on={(v) => setFields({ ...fields, recipientName: v })}
              />
              <Text
                id="documentNumber"
                label="Reference number"
                max={80}
                v={fields.documentNumber}
                on={(v) => setFields({ ...fields, documentNumber: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Text
                  id="issueDate"
                  type="date"
                  label="Issue date"
                  v={fields.issueDate}
                  on={(v) => setFields({ ...fields, issueDate: v })}
                />
                <Text
                  id="dueDate"
                  type="date"
                  label="Due date"
                  v={fields.dueDate}
                  on={(v) => setFields({ ...fields, dueDate: v })}
                />
              </div>
            </div>
          </Section>

          <Section
            n="3"
            title="Notes to organise"
            hint="One fact per note. Unticked notes are not sent or included in the AI preview. A manual draft keeps all your notes."
          >
            <ul className="grid gap-2">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <label
                    className="mt-3 flex shrink-0 items-center"
                    title="Send this note to the AI provider"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(155_42%_21%)]"
                      checked={l.send}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, send: e.target.checked } : x)))
                      }
                      aria-label={"Send note " + (i + 1) + " to AI"}
                      data-testid={"checkbox-note-" + i}
                    />
                  </label>
                  <textarea
                    rows={2}
                    className="field"
                    aria-label={"Note " + (i + 1)}
                    aria-invalid={l.text.length > 1000}
                    value={l.text}
                    placeholder={i === 0 ? "e.g. Delivered 40 cartons on 3 March" : ""}
                    onChange={(e) =>
                      setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                    }
                    data-testid={"input-note-" + i}
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost !px-2.5"
                      aria-label={"Remove note " + (i + 1)}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {lines.length < 20 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-3"
                onClick={() => setLines([...lines, { text: "", send: true }])}
                data-testid="button-add-note"
              >
                <Plus className="h-4 w-4" />
                Add note
              </button>
            )}
            <p className="hint">{selected.length} of 20 notes selected for the AI request.</p>
            <label className="mt-4 block">
              <span className="text-sm font-medium">Optional drafting instruction</span>
              <textarea
                className="field mt-2"
                rows={2}
                maxLength={1000}
                value={draftingInstruction}
                aria-describedby="drafting-instruction-help"
                onChange={(e) => setDraftingInstruction(e.target.value)}
                placeholder="For example, group the delivery notes under Scope."
              />
            </label>
            <p id="drafting-instruction-help" className="hint">
              This guides organisation only and is not copied into your document. Enter names, amounts and
              dates in their fields; put business content in the notes above.
            </p>
          </Section>

          <Section
            n="4"
            title="Financial details"
            hint="Worked out by Valo to the exact kobo, never by the AI provider."
          >
            <FinancialFields
              key={task + finKey}
              idPrefix="ai"
              value={emptyFinancial(task)}
              onChange={setFin}
            />
          </Section>

          {touched && problems.length > 0 && (
            <ul role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <aside className="grid h-fit gap-4 lg:sticky lg:top-24">
          <UsageCard usage={usage} />
          <div className="surface p-5" data-testid="panel-ai-submit">
            <p className="eyebrow">What leaves Valo</p>
            <p className="mt-2 text-sm leading-relaxed">
              Only the document type, tone, optional drafting instruction and the notes you ticked, with
              obvious identifiers such as phone numbers and emails redacted first. Your profile, workspace and
              history are not sent.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Automatic redaction is incomplete. Read your notes and do not enter confidential or real
              customer data in this development build.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-sidebar p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                data-testid="checkbox-ai-consent"
              />
              <span>
                I agree to these selected notes and the optional drafting instruction being processed by the
                AI provider.
              </span>
            </label>
            {touched && !consent && (
              <p className="hint !text-destructive">
                Consent is needed for the AI draft only. A manual draft does not need it.
              </p>
            )}
            {aiErr && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="status-ai-error"
              >
                {aiErr.kind === "unauthenticated" ? "Please sign in again." : aiErr.message} What you entered
                is still here.
                {aiErr.kind === "offline" || aiErr.kind === "server"
                  ? " Trying again asks for the same draft, not a second one."
                  : ""}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary mt-4 w-full"
              disabled={create.isPending || aiBlocked || manual.isPending}
              data-testid="button-ai-draft"
            >
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {create.isPending ? "Organising your notes" : "Draft with AI"}
            </button>
            {aiBlocked && (
              <p className="hint">AI drafting is not available right now. Use the manual draft below.</p>
            )}
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={submitManual}
              disabled={manual.isPending || create.isPending}
              data-testid="button-manual-draft"
            >
              {manual.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FilePenLine className="h-4 w-4" />
              )}
              Build manually, no AI
            </button>
            <p className="hint">
              Places all your notes in order as a document of your own. Nothing is sent to an AI provider.
            </p>
            {(manualErr || manErr) && (
              <p role="alert" className="mt-2 text-sm text-destructive" data-testid="status-manual-error">
                {manualErr ?? manErr?.message}
              </p>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}
