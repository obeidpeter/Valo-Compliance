import type { ReactNode } from "react";
import type { CheckerFacts } from "@workspace/api-client-react";
import {
  QUESTION_GROUPS,
  type CheckerQuestion,
  type QuestionGroupId,
} from "@workspace/valo-core/checker-questionnaire";
import { AnswerOr, Choice, ListOr, type Change } from "@/components/checker-controls";
import { koboToNaira, type Marker } from "@/lib/checker";
import { cn } from "@/lib/utils";

/** Pairs of questions shown side by side on a wide screen. */
const SIDE_BY_SIDE: readonly (readonly [string, string])[] = [
  ["turnoverPeriodStart", "turnoverPeriodEnd"],
  ["turnoverMetric", "turnoverCurrency"],
];

/** The boxes' test names, which the browser checks use. */
const BOX_TEST_IDS: Readonly<Record<string, string>> = {
  state: "select-state",
  lga: "input-lga",
  employees: "input-employees",
  turnoverYear: "input-turnover-year",
};

export interface QuestionContext {
  facts: CheckerFacts;
  /** The questions the visitor chose "Skip for now" on. */
  skipped: ReadonlySet<string>;
  asked: (answer: string) => boolean;
  onAnswer: (answer: string, value: unknown, chosen?: boolean) => void;
  /** The exact turnover figure as typed, and what is wrong with it. */
  amount: { text: string; error: string | null; onChange: (text: string) => void };
  /** The year an example year is taken from. */
  lastYear: number;
}

/** A step's questions, in order, each asked or replaced by the note it gives when it is skipped. */
export function StepQuestions({
  questions,
  context,
}: {
  questions: readonly CheckerQuestion[];
  context: QuestionContext;
}) {
  const shown: ReactNode[] = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index]!;
    if (question.group) {
      const members = questions.filter((member) => member.group === question.group);
      index += members.length - 1;
      shown.push(<Group key={question.group} id={question.group} questions={members} context={context} />);
    } else index += pushQuestion(shown, questions, index, context);
  }
  return <>{shown}</>;
}

/** Adds the question at `index` to `shown`, beside its partner when the next question is that. Returns
 * how many questions after it were added too. */
function pushQuestion(
  shown: ReactNode[],
  questions: readonly CheckerQuestion[],
  index: number,
  context: QuestionContext,
): number {
  const question = questions[index]!;
  const next = questions[index + 1];
  const paired =
    next && SIDE_BY_SIDE.some(([first, second]) => first === question.answer && second === next.answer);
  if (paired) {
    shown.push(
      <div key={question.answer} className="grid gap-8 sm:grid-cols-2">
        <QuestionOrNote question={question} context={context} />
        <QuestionOrNote question={next} context={context} />
      </div>,
    );
    return 1;
  }
  shown.push(<QuestionOrNote key={question.answer} question={question} context={context} />);
  return 0;
}

function Group({
  id,
  questions,
  context,
}: {
  id: QuestionGroupId;
  questions: readonly CheckerQuestion[];
  context: QuestionContext;
}) {
  const group = QUESTION_GROUPS[id];
  if (!questions.some((question) => context.asked(question.answer)))
    return <p className="hint">{group.skippedNote}</p>;
  const shown: ReactNode[] = [];
  for (let index = 0; index < questions.length; index++)
    index += pushQuestion(shown, questions, index, context);
  return (
    <fieldset className="grid gap-7 rounded-2xl border border-border bg-sidebar/40 p-4 sm:p-5">
      <legend className="eyebrow float-left w-full">{group.legend}</legend>
      <p className="-mt-4 text-sm text-muted-foreground">{group.intro}</p>
      {shown}
    </fieldset>
  );
}

function QuestionOrNote({ question, context }: { question: CheckerQuestion; context: QuestionContext }) {
  if (!context.asked(question.answer))
    return question.skippedNote ? <p className="hint">{question.skippedNote}</p> : null;
  return <Question question={question} context={context} />;
}

/** One question, drawn by the kind of answer it takes. */
function Question({ question, context }: { question: CheckerQuestion; context: QuestionContext }) {
  const name = question.answer;
  const value: unknown = Reflect.get(context.facts, name);
  const text = typeof value === "string" ? value : "unanswered";
  const markers = question.notAnswered as readonly Marker[];
  const common = {
    name,
    skipped: context.skipped.has(name),
    onChange: ((next: unknown, chosen?: boolean) => context.onAnswer(name, next, chosen)) as Change<never>,
  };
  const hint = question.hint ? { hint: question.hint } : {};
  switch (question.kind) {
    case "choice":
      return (
        <Choice
          {...common}
          {...hint}
          label={question.label}
          value={text}
          options={[...(question.choices ?? [])]}
          markers={markers}
        />
      );
    case "list":
      return (
        <ListOr
          {...common}
          label={question.label}
          hint={question.hint ?? ""}
          value={Array.isArray(value) ? (value as string[]) : (text as Marker)}
          markers={markers}
          placeholder={question.placeholder ?? ""}
        />
      );
    case "amount":
      return <Amount question={question} context={context} />;
    default:
      return (
        <AnswerOr
          {...common}
          label={question.label}
          value={text}
          markers={markers}
          render={(shownValue, change, labelledBy) => (
            <Box
              question={question}
              value={shownValue}
              change={change}
              labelledBy={labelledBy}
              lastYear={context.lastYear}
            />
          )}
        />
      );
  }
}

/** The box a question is answered in, beside its ways of not answering. */
function Box({
  question,
  value,
  change,
  labelledBy,
  lastYear,
}: {
  question: CheckerQuestion;
  value: string;
  change: (value: string) => void;
  labelledBy: string;
  lastYear: number;
}) {
  const id = question.answer;
  const testId = BOX_TEST_IDS[id];
  const test = testId ? { "data-testid": testId } : {};
  switch (question.kind) {
    case "state":
      return (
        <select
          id={id}
          aria-labelledby={labelledBy}
          className="field sm:max-w-xs"
          value={value}
          onChange={(e) => change(e.target.value)}
          {...test}
        >
          <option value="">{question.placeholder}</option>
          {(question.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );
    case "area":
      return (
        <input
          id={id}
          aria-labelledby={labelledBy}
          className="field sm:max-w-xs"
          maxLength={100}
          value={value}
          placeholder={question.placeholder}
          onChange={(e) => change(e.target.value)}
          {...test}
        />
      );
    case "count":
      return (
        <input
          id={id}
          aria-labelledby={labelledBy}
          inputMode="numeric"
          className="field sm:max-w-[10rem]"
          value={value}
          onChange={(e) => change(e.target.value.replace(/\D/g, "").slice(0, 7))}
          {...test}
        />
      );
    case "year":
      return (
        <input
          id={id}
          aria-labelledby={labelledBy}
          inputMode="numeric"
          className="field sm:max-w-[8rem]"
          value={value}
          placeholder={"e.g. " + lastYear}
          onChange={(e) => change(e.target.value.replace(/\D/g, "").slice(0, 4))}
          {...test}
        />
      );
    default:
      return (
        <input
          id={id}
          aria-labelledby={labelledBy}
          type="date"
          className="field"
          value={value}
          onChange={(e) => change(e.target.value)}
          {...test}
        />
      );
  }
}

/** The exact turnover figure, typed in naira. A figure that is not one says so under the box. */
function Amount({ question, context }: { question: CheckerQuestion; context: QuestionContext }) {
  const { text, error, onChange } = context.amount;
  return (
    <div>
      <label className="label text-base" htmlFor="amount">
        {question.label}{" "}
        {question.optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </label>
      <div className="flex max-w-xs items-center gap-2">
        <span className="text-muted-foreground" aria-hidden="true">
          ₦
        </span>
        <input
          id="amount"
          inputMode="decimal"
          className="field"
          value={text || koboToNaira(context.facts.turnoverAmountKobo)}
          aria-invalid={!!error}
          aria-describedby="amount-hint"
          onChange={(e) => onChange(e.target.value)}
          data-testid="input-amount"
        />
      </div>
      <p id="amount-hint" className={cn("hint", error && "!text-destructive")}>
        {error ?? question.hint}
      </p>
    </div>
  );
}
