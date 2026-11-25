import type { ReactNode } from "react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import {
  NAMING_QUESTIONS,
  NOT_ANSWERED,
  PARTNER_QUESTIONS,
  RULE_QUESTIONS,
  checkerQuestion,
  feedFor,
  holds,
  type AnswerValue,
  type Feed,
  type RuleFamily,
  type RuleQuestion,
} from "@workspace/valo-core/checker-questionnaire";
import { AnswerOr, ChecksOr, Choice, ListOr, type Change, type Opt } from "@/components/checker-controls";
import type { Marker } from "@/lib/checker";
import { isRichMarker, updateRichAnswer, type RichCheckerFacts, type RichValue } from "@/lib/rich-checker";
import { CHECKER_START, signUpFor } from "@/lib/start";

type Answers = Record<string, RichValue>;

const MARKERS: readonly Marker[] = NOT_ANSWERED;
const YES_NO: Opt[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

const isAnswers = (value: unknown): value is Answers =>
  !!value && typeof value === "object" && !Array.isArray(value) && !isRichMarker(value);
const isText = (value: unknown): value is string => typeof value === "string";

/** A rule's answer as a choice holds it: a way of not answering by its name, "true" or "false" for a
 * yes-or-no question, a choice's value, or "" for no answer. */
function chosenValue(value: RichValue | undefined): string {
  if (isRichMarker(value)) return value.status;
  if (typeof value === "boolean") return String(value);
  return isText(value) ? value : "";
}

/** What a control passes back, as a rule's answer. Emptying a box, or a list's last entry, leaves the
 * question untouched again, so no answer is kept. */
function ruleValue(question: RuleQuestion, next: unknown, chosen?: boolean): RichValue | undefined {
  if (isText(next) && (NOT_ANSWERED as readonly string[]).includes(next))
    return next === "unanswered" && chosen === false ? undefined : { status: next as Marker, value: null };
  if (Array.isArray(next)) return next.some((entry) => String(entry).trim() !== "") ? next : undefined;
  if (question.kind === "flag") return next === "true";
  return isText(next) && next !== "" ? next : undefined;
}

/** What a filled answer says: "Yes", "No", or the choice's own words. */
function filledLabel(question: RuleQuestion, value: AnswerValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return question.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/**
 * One of a rule's questions, drawn by the kind of answer it takes. Its first control's id is
 * `${id}-state`, which a link to the question moves the focus to (`richQuestionTarget`).
 */
function RuleQuestionControl({
  question,
  id,
  value,
  onChange,
}: {
  question: RuleQuestion;
  /** The question's place on the page: `rich-tax-legalForm`, `rich-naming-…`, `rich-partner-0-…`. */
  id: string;
  value: RichValue | undefined;
  onChange: (value: RichValue | undefined) => void;
}) {
  const shared = {
    name: id,
    label: question.label,
    ...(question.hint ? { hint: question.hint } : {}),
    skipped: isRichMarker(value) && value.status === "unanswered",
    markers: MARKERS,
    onChange: ((next: unknown, chosen?: boolean) =>
      onChange(ruleValue(question, next, chosen))) as Change<never>,
  };
  const choices: Opt[] = (question.choices ?? []).map((choice) => ({
    value: choice.value,
    label: choice.label,
  }));
  switch (question.kind) {
    case "flag":
    case "choice":
      return (
        <Choice
          {...shared}
          inputId={`${id}-state`}
          value={chosenValue(value)}
          options={question.kind === "flag" ? YES_NO : choices}
        />
      );
    case "list":
      return question.choices ? (
        <ChecksOr
          {...shared}
          inputId={`${id}-state`}
          value={Array.isArray(value) ? value.filter(isText) : chosenValue(value)}
          options={choices}
        />
      ) : (
        <ListOr
          {...shared}
          inputId={`${id}-state`}
          value={
            Array.isArray(value) ? value.filter(isText) : ((chosenValue(value) || "unanswered") as Marker)
          }
          placeholder=""
        />
      );
    default: {
      // The box holds the visitor's own words, so that words that happen to name a way of not
      // answering are kept as words.
      const text = isText(value) ? value : "";
      return (
        <AnswerOr
          {...shared}
          value={isRichMarker(value) ? value.status : text ? "answered" : ""}
          render={(_shown, _change, labelledBy) => (
            <input
              id={`${id}-state`}
              aria-labelledby={labelledBy}
              type={question.kind === "date" ? "date" : "text"}
              className={question.kind === "date" ? "field sm:max-w-xs" : "field sm:max-w-md"}
              maxLength={300}
              value={text}
              onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
              data-testid={`input-${id}`}
            />
          )}
        />
      );
    }
  }
}

/** A rule's answer that an earlier answer fills: shown as answered, with where it came from, and not
 * asked again. A link to the question moves the focus here. */
function FilledAnswer({
  question,
  id,
  feed,
  onGoTo,
}: {
  question: RuleQuestion;
  id: string;
  feed: Feed;
  onGoTo: (answer: string) => void;
}) {
  const sources = feed.from.map((answer) => `‘${checkerQuestion(answer)?.label ?? answer}’`);
  const many = sources.length > 1;
  return (
    <div id={`${id}-state`} tabIndex={-1} className="outline-none" data-testid={`filled-${id}`}>
      <p className="label text-base">{question.label}</p>
      <p className="text-sm leading-relaxed">
        <strong className="font-medium">{filledLabel(question, feed.value)}.</strong>{" "}
        <span className="text-muted-foreground">
          From your {many ? "answers" : "answer"} to {sources.join(" and ")}.
        </span>{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => onGoTo(feed.from[0]!)}
          data-testid={`button-change-${id}`}
        >
          Change {many ? "those answers" : "that answer"}
        </button>
      </p>
    </div>
  );
}

/** The line naming the requirements a rule's questions are asked for. */
function RuleHeading({ id, titles }: { id?: string; titles: readonly string[] }) {
  return (
    <div>
      <p className="eyebrow">{titles.length > 1 ? "For these requirements" : "For one requirement"}</p>
      <h3 {...(id ? { id, tabIndex: -1 } : {})} className="mt-1 font-medium outline-none">
        {titles.join("; ")}
      </h3>
    </div>
  );
}

/**
 * A rule's questions, in the step they belong to (RUL-001; docs/architecture/requirements-questions.md,
 * section 2). Each is asked only while its condition holds on what the check sends (`sent`), so a
 * question is shown exactly when its answer would be sent. A question an earlier answer fills is shown
 * as answered instead (section 3). An answer a changed choice hides is kept on the page, and comes back
 * with the choice.
 */
export function RuleQuestions({
  family,
  titles,
  facts,
  sent,
  onChange,
  onGoTo,
}: {
  family: RuleFamily;
  /** The titles of the rules in use that ask these questions. */
  titles: readonly string[];
  /** The page's answers: the visitor's own, from which the earlier answers fill. */
  facts: RichCheckerFacts;
  /** What the check sends now, on which the questions' conditions are read. */
  sent: RichCheckerFacts;
  onChange: (facts: RichCheckerFacts) => void;
  /** Moves to one of the check's own questions. */
  onGoTo: (answer: string) => void;
}) {
  const own = facts.rich?.[family];
  const answers: Answers = isAnswers(own) ? own : {};
  const asked = (question: RuleQuestion) => !question.askedWhen || holds(question.askedWhen, sent);
  const set = (key: string, value: RichValue | undefined) =>
    onChange(updateRichAnswer(facts, family, key, value));
  const shown: ReactNode[] = RULE_QUESTIONS[family].filter(asked).map((question) => {
    const id = `rich-${family}-${question.key}`;
    // An earlier answer fills it as it is sent: a question the check skips fills nothing.
    const feed = feedFor(sent, `rich.${family}.${question.key}`);
    return feed ? (
      <FilledAnswer key={question.key} question={question} id={id} feed={feed} onGoTo={onGoTo} />
    ) : (
      <RuleQuestionControl
        key={question.key}
        question={question}
        id={id}
        value={answers[question.key]}
        onChange={(value) => set(question.key, value)}
      />
    );
  });
  if (family === "businessName") {
    if (PARTNER_QUESTIONS.every(asked))
      shown.push(
        <Partners key="partners" value={answers.partners} onChange={(value) => set("partners", value)} />,
      );
    const naming = isAnswers(answers.namingAssessment) ? answers.namingAssessment : {};
    const namingAsked = NAMING_QUESTIONS.filter(asked);
    if (namingAsked.length)
      shown.push(
        <fieldset key="naming" className="grid gap-8">
          <legend className="label float-left w-full text-base">How the name is composed</legend>
          {namingAsked.map((question) => (
            <RuleQuestionControl
              key={question.key}
              question={question}
              id={`rich-naming-${question.key}`}
              value={naming[question.key]}
              onChange={(value) => {
                const next = { ...naming };
                if (value === undefined) delete next[question.key];
                else next[question.key] = value;
                set("namingAssessment", Object.keys(next).length ? next : undefined);
              }}
            />
          ))}
        </fieldset>,
      );
  }
  if (!shown.length) return null;
  return (
    <section
      className="grid gap-8 border-t border-border pt-7"
      aria-labelledby={`rich-${family}-summary`}
      data-testid={`rule-questions-${family}`}
    >
      <RuleHeading id={`rich-${family}-summary`} titles={titles} />
      {shown}
    </section>
  );
}

/** The business-name rule's partners, each with the same questions. */
function Partners({
  value,
  onChange,
}: {
  value: RichValue | undefined;
  onChange: (value: RichValue | undefined) => void;
}) {
  const partners = Array.isArray(value) ? value.filter(isAnswers) : [];
  return (
    <fieldset className="grid gap-5">
      <legend className="label float-left w-full text-base">Partners, if relevant</legend>
      <p className="hint !mt-0">List every relevant partner. No names are inferred from the business name.</p>
      {partners.map((partner, index) => (
        <div className="grid gap-7 rounded-xl border border-border p-4" key={index}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">Partner {index + 1}</h4>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onChange(partners.filter((_, other) => other !== index))}
            >
              Remove partner {index + 1}
            </button>
          </div>
          {PARTNER_QUESTIONS.map((question) => (
            <RuleQuestionControl
              key={question.key}
              question={question}
              id={`rich-partner-${index}-${question.key}`}
              value={partner[question.key]}
              onChange={(answer) => {
                const next = { ...partner };
                if (answer === undefined) delete next[question.key];
                else next[question.key] = answer;
                onChange(partners.map((old, other) => (other === index ? next : old)));
              }}
            />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          id="rich-partners-add"
          type="button"
          className="btn btn-ghost btn-sm w-fit"
          disabled={partners.length >= 30}
          onClick={() => onChange([...partners, {}])}
        >
          <Plus className="h-4 w-4" />
          Add partner
        </button>
        {value !== undefined && (
          <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => onChange(undefined)}>
            Clear partner answers
          </button>
        )}
      </div>
    </fieldset>
  );
}

/**
 * In place of the business-name rule's questions for a visitor who is not signed in: those questions
 * ask for the business's exact name and its people's names, so they are asked only of a signed-in
 * visitor. The links keep the answers given so far, as the result's own links do.
 */
export function NameQuestionsNeedSignIn({
  titles,
  onKeep,
}: {
  titles: readonly string[];
  onKeep: () => void;
}) {
  return (
    <section
      className="grid gap-3 border-t border-border pt-7"
      aria-labelledby="rule-businessName-sign-in"
      data-testid="rule-questions-businessName-sign-in"
    >
      <p className="eyebrow">{titles.length > 1 ? "For these requirements" : "For one requirement"}</p>
      <h3 id="rule-businessName-sign-in" className="-mt-2 font-medium">
        {titles.join("; ")}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Its questions ask for the exact name the business trades under and the names of the people behind it,
        so they are asked only once you are signed in. We never ask for your business name here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={signUpFor(CHECKER_START)}
          className="btn btn-primary btn-sm"
          onClick={onKeep}
          data-testid="link-signup-business-name"
        >
          Create account and keep these answers
        </Link>
        <Link
          href={`/sign-in?start=${CHECKER_START}`}
          className="btn btn-ghost btn-sm"
          onClick={onKeep}
          data-testid="link-signin-business-name"
        >
          Sign in and keep these answers
        </Link>
      </div>
    </section>
  );
}
