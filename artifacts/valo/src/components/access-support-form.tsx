import { useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  useRequestAccessSupport,
  type AccessSupportAck,
  type AccessSupportInputTopic,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";

const TOPICS: { v: AccessSupportInputTopic; l: string; d: string }[] = [
  {
    v: "account_access",
    l: "I cannot get into my account",
    d: "Sign-in, verification, suspension or a lost email address.",
  },
  { v: "general", l: "A general question", d: "How Valo works, what is available, or feedback." },
  {
    v: "content_issue",
    l: "Something on a page looks wrong",
    d: "A template, resource or source link you think is incorrect.",
  },
];

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function AccessSupportForm({ defaultTopic = "general" }: { defaultTopic?: AccessSupportInputTopic }) {
  const mutation = useRequestAccessSupport();
  // Stable across retries; regenerated only after a confirmed save.
  const keyRef = useRef<string>(uuid());
  const [topic, setTopic] = useState<AccessSupportInputTopic>(defaultTopic);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [touched, setTouched] = useState(false);
  const [ack, setAck] = useState<AccessSupportAck | null>(null);

  const msg = message.trim();
  const msgErr =
    msg.length < 20
      ? "Please write at least 20 characters so we understand the problem."
      : msg.length > 2000
        ? "Keep it under 2,000 characters."
        : "";
  const emailErr =
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254
      ? "Enter an email address we can reply to."
      : "";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (msgErr || emailErr || mutation.isPending) return;
    mutation.mutate(
      {
        data: {
          idempotencyKey: keyRef.current,
          email: email.trim(),
          topic,
          message: msg,
          ...(website ? { website } : {}),
        },
      },
      {
        onSuccess: (r) => {
          setAck(r);
          keyRef.current = uuid();
        },
      },
    );
  }

  if (ack) {
    return (
      <div className="surface reveal p-6 sm:p-8" role="status" data-testid="access-support-ack">
        <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden />
        <p className="font-display mt-4 text-2xl">Saved. Not emailed.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{ack.message}</p>
        <dl className="mt-6 grid gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="eyebrow">Reference</dt>
            <dd className="font-mono mt-1 text-base" data-testid="text-access-reference">
              {ack.reference}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Delivery</dt>
            <dd className="mt-1">
              <span className="pill pill-ochre">
                <span className="dot" /> Not dispatched
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Your message is stored for a Valo staff member to read. No email has been sent to you or anyone
          else, and no response time is promised. Keep the reference if you write again.
        </p>
        <button
          className="btn btn-ghost btn-sm mt-5"
          onClick={() => {
            setAck(null);
            setMessage("");
            setTouched(false);
            mutation.reset();
          }}
          data-testid="button-access-another"
        >
          Write another
        </button>
      </div>
    );
  }

  const err = mutation.error ? describeError(mutation.error) : null;
  return (
    <form
      onSubmit={submit}
      className="surface grid gap-5 p-6 sm:p-8"
      noValidate
      data-testid="form-access-support"
    >
      <fieldset>
        <legend className="label">What is this about?</legend>
        <div className="grid gap-2">
          {TOPICS.map((t) => (
            <label
              key={t.v}
              className={
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors " +
                (topic === t.v ? "border-primary bg-accent/60" : "border-border hover:bg-secondary/60")
              }
            >
              <input
                type="radio"
                name="topic"
                value={t.v}
                checked={topic === t.v}
                onChange={() => setTopic(t.v)}
                className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
                data-testid={"radio-topic-" + t.v}
              />
              <span>
                <span className="block font-medium">{t.l}</span>
                <span className="text-muted-foreground">{t.d}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="as-email">
          Reply email
        </label>
        <input
          id="as-email"
          type="email"
          autoComplete="email"
          className="field"
          value={email}
          maxLength={254}
          aria-invalid={touched && !!emailErr}
          aria-describedby="as-email-hint"
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-access-email"
        />
        <p id="as-email-hint" className={"hint " + (touched && emailErr ? "text-destructive" : "")}>
          {touched && emailErr ? emailErr : "Works even if you cannot sign in."}
        </p>
      </div>
      <div>
        <label className="label" htmlFor="as-msg">
          Message
        </label>
        <textarea
          id="as-msg"
          className="field min-h-36"
          value={message}
          maxLength={2000}
          aria-invalid={touched && !!msgErr}
          aria-describedby="as-msg-hint"
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe what happened in your own words."
          data-testid="input-access-message"
        />
        <div id="as-msg-hint" className="hint flex justify-between gap-3">
          <span className={touched && msgErr ? "text-destructive" : ""}>
            {touched && msgErr ? msgErr : "At least 20 characters."}
          </span>
          <span className="font-mono">{message.length}/2000</span>
        </div>
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="as-website">Website</label>
        <input
          id="as-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <p className="rounded-xl border border-[hsl(38_50%_80%)] bg-[hsl(var(--ochre-soft))] px-4 py-3 text-sm">
        Never include passwords, verification codes, ID numbers or payment details. Valo staff will never ask
        for them.
      </p>
      {err && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="text-access-error"
        >
          {err.message} You can retry safely; it will not create a duplicate.
        </p>
      )}
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending}
          data-testid="button-access-submit"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save message
        </button>
      </div>
    </form>
  );
}
