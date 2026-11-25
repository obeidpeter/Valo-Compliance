import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  useCreateAssessment,
  getGetWorkspaceQueryKey,
  getListAssessmentsQueryKey,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { checkerQuestion, type AskedQuestion } from "@workspace/valo-core/checker-questionnaire";
import { displayFact, factLabel, isMarker } from "@/lib/checker";
import { lagosToday } from "@/lib/format";
import { factAtPath, isRichMarker, type RichCheckerFacts } from "@/lib/rich-checker";
import { cn } from "@/lib/utils";

/** A rule's answer in the review's words: a chosen answer as its question names it. */
function ruleAnswerText(question: AskedQuestion, value: unknown): string {
  if (value === undefined) return "Not answered";
  const named = (entry: unknown) =>
    question.choices?.find((choice) => choice.value === entry)?.label ?? displayFact(question.path, entry);
  if (typeof value === "string") return named(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
    return value.length ? value.map(named).join("; ") : "None listed";
  return displayFact(question.path, value);
}

/**
 * Every question the check asks now, in the order the page shows them, each with its answer as it is
 * sent and a link that moves to its place (RUL-001: "the user can return to previous answers"). A
 * question the check skips is not listed. A filled answer says where it came from.
 */
export function Review({
  sent,
  asked,
  onEdit,
}: {
  sent: RichCheckerFacts;
  asked: readonly AskedQuestion[];
  onEdit: (n: number, field: string) => void;
}) {
  return (
    <dl className="grid gap-0 text-sm" data-testid="list-review">
      {asked.map((question) => {
        const value: unknown = question.family
          ? factAtPath(sent, question.path)
          : Reflect.get(sent, question.path);
        const label = question.family ? question.label : factLabel(question.path);
        const sources = question.filledBy?.from.map(
          (answer) => `‘${checkerQuestion(answer)?.label ?? answer}’`,
        );
        return (
          <div
            key={question.path}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border py-2.5 sm:grid-cols-[14rem_1fr_auto]"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "col-start-1 row-start-2 break-words sm:col-start-2 sm:row-start-1",
                value === undefined || value === null || isMarker(value) || isRichMarker(value)
                  ? "italic text-muted-foreground"
                  : "",
              )}
            >
              {question.family ? ruleAnswerText(question, value) : displayFact(question.path, value)}
              {sources && (
                <span className="block text-xs text-muted-foreground">
                  From your {sources.length > 1 ? "answers" : "answer"} to {sources.join(" and ")}.
                </span>
              )}
            </dd>
            {/* A list of terms holds only terms and their descriptions, so the button sits in one. */}
            <dd className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1">
              <button
                type="button"
                aria-label={"Change " + label}
                className="-my-1 px-1 py-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => onEdit(question.step, question.path)}
              >
                Change
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function SavePanel({
  facts,
  profileRevision,
  hasProfile,
  stale,
}: {
  facts: RichCheckerFacts;
  profileRevision: number;
  hasProfile: boolean;
  stale: boolean;
}) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"answers" | "profile">("answers");
  const create = useCreateAssessment();
  const e = create.error ? describeError(create.error) : null;

  function save() {
    const data =
      mode === "answers"
        ? { facts, asOfDate: lagosToday(), saveConsent: true as const }
        : {
            asOfDate: lagosToday(),
            saveConsent: true as const,
            ...(profileRevision >= 1 ? { expectedProfileRevision: profileRevision } : {}),
          };
    create.mutate(
      { data },
      {
        onSuccess: (a) => {
          void qc.invalidateQueries({ queryKey: getListAssessmentsQueryKey() });
          setLocation("/workspace/assessments/" + a.id);
        },
        onError: (er) => {
          if (describeError(er).kind === "conflict")
            void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        },
      },
    );
  }

  return (
    <div className="surface mt-8 p-5 sm:p-7" data-testid="panel-save">
      <p className="eyebrow">Save this result</p>
      <fieldset className="mt-4 grid gap-2">
        <legend className="sr-only">What to save</legend>
        <label
          className={cn(
            "flex cursor-pointer gap-3 rounded-xl border p-4 text-sm",
            mode === "answers" ? "border-primary bg-accent/50" : "border-border",
          )}
        >
          <input
            type="radio"
            name="save-mode"
            className="mt-0.5 accent-[hsl(155_42%_21%)]"
            checked={mode === "answers"}
            onChange={() => setMode("answers")}
            data-testid="radio-save-answers"
          />
          <span>
            <span className="font-medium">With the answers I gave here</span>
            <span className="block text-muted-foreground">
              The answers are kept with the result. Your business profile is not changed.
            </span>
          </span>
        </label>
        <label
          className={cn(
            "flex gap-3 rounded-xl border p-4 text-sm",
            !hasProfile ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            mode === "profile" ? "border-primary bg-accent/50" : "border-border",
          )}
        >
          <input
            type="radio"
            name="save-mode"
            className="mt-0.5 accent-[hsl(155_42%_21%)]"
            disabled={!hasProfile}
            checked={mode === "profile"}
            onChange={() => setMode("profile")}
            data-testid="radio-save-profile"
          />
          <span>
            <span className="font-medium">
              {hasProfile
                ? `With my business profile, version ${profileRevision}`
                : "With my business profile"}
            </span>
            <span className="block text-muted-foreground">
              {hasProfile
                ? "The result is worked out again from that version of your profile. The extra details you gave above are left out. If your profile has changed since this page opened, nothing is saved and you are told."
                : "You have not saved a business profile yet. Save this result first, then copy these answers into your business profile in one click."}
            </span>
          </span>
        </label>
      </fieldset>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
          checked={consent}
          onChange={(ev) => setConsent(ev.target.checked)}
          data-testid="checkbox-save-consent"
        />
        <span>I agree to Valo storing this result privately in my workspace.</span>
      </label>
      {stale && mode === "answers" && (
        <p className="hint">
          You changed answers after this result was worked out. What is saved is worked out again from your
          answers as they are now.
        </p>
      )}
      {e && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {e.kind === "conflict"
            ? "Your profile changed after this page opened. The version above is now the newest. Look at it, then save again."
            : e.message}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary mt-5"
        disabled={!consent || create.isPending}
        onClick={save}
        data-testid="button-save-assessment"
      >
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save this result
      </button>
    </div>
  );
}
