import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  NAMING_QUESTIONS,
  PARTNER_QUESTIONS,
  RULE_QUESTIONS,
  type RuleQuestion,
} from "@workspace/valo-core/checker-questionnaire";
import {
  ANSWER_STATES,
  ANSWER_STATE_LABELS,
  isRichMarker,
  updateRichAnswer,
  type RichCheckerFacts,
  type RichSection,
  type RichValue,
  type RichSectionAnswers,
} from "@/lib/rich-checker";

type Choice = readonly [value: string, label: string];
type Field = {
  key: string;
  label: string;
  kind?: "text" | "flag" | "date" | "list";
  choices?: readonly Choice[];
  hint?: string | undefined;
};
/** A rule's question, from the questionnaire, as this panel draws it. */
const asField = (question: RuleQuestion): Field => ({
  key: question.key,
  label: question.label,
  ...(question.kind === "flag" || question.kind === "list" || question.kind === "date"
    ? { kind: question.kind }
    : {}),
  ...(question.choices
    ? { choices: question.choices.map((choice): Choice => [choice.value, choice.label]) }
    : {}),
  ...(question.hint ? { hint: question.hint } : {}),
});

const BUSINESS_FIELDS: Field[] = RULE_QUESTIONS.businessName.map(asField);
const NAMING_FIELDS: Field[] = NAMING_QUESTIONS.map(asField);
const PARTNER_FIELDS: Field[] = PARTNER_QUESTIONS.map(asField);
const TAX_FIELDS: Field[] = RULE_QUESTIONS.tax.map(asField);
const PRIVACY_FIELDS: Field[] = RULE_QUESTIONS.privacy.map(asField);
const PRODUCT_FIELDS: Field[] = RULE_QUESTIONS.product.map(asField);

function AnswerField({
  field,
  value,
  onChange,
  prefix,
}: {
  field: Field;
  value: RichValue | undefined;
  onChange: (value: RichValue | undefined) => void;
  prefix: string;
}) {
  const [entering, setEntering] = useState(false);
  const id = `${prefix}-${field.key}`;
  const choices =
    field.kind === "flag"
      ? ([
          ["true", "Yes"],
          ["false", "No"],
        ] as const)
      : field.kind === "list"
        ? undefined
        : field.choices;
  const mode = isRichMarker(value) ? value.status : value !== undefined || entering ? "known" : "absent";
  const selected = mode === "known" && choices ? String(value) : mode;
  function selectValue(next: string) {
    setEntering(next === "known");
    if (next === "absent" || next === "known") onChange(undefined);
    else if ((ANSWER_STATES as readonly string[]).includes(next))
      onChange({ status: next as (typeof ANSWER_STATES)[number], value: null });
    else onChange(field.kind === "flag" ? next === "true" : next);
  }
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return (
    <fieldset className="min-w-0 grid gap-2">
      <legend className="label">{field.label}</legend>
      {field.hint && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {field.hint}
        </p>
      )}
      <select
        id={`${id}-state`}
        aria-label={`${field.label}: answer`}
        aria-describedby={field.hint ? `${id}-hint` : undefined}
        className="field"
        value={selected}
        onChange={(event) => selectValue(event.target.value)}
        data-testid={`select-${id}`}
      >
        <option value="absent">Not supplied</option>
        {choices ? (
          choices.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))
        ) : (
          <option value="known">Enter an answer</option>
        )}
        {ANSWER_STATES.map((state) => (
          <option key={state} value={state}>
            {ANSWER_STATE_LABELS[state]}
          </option>
        ))}
      </select>
      {mode === "known" &&
        !choices &&
        (field.kind === "list" ? (
          <div className="grid gap-2">
            {values.map((entry, index) => (
              <div className="flex gap-2" key={index}>
                {field.choices ? (
                  <select
                    className="field min-w-0"
                    aria-label={`${field.label} ${index + 1}`}
                    value={entry}
                    onChange={(event) =>
                      onChange(values.map((old, position) => (index === position ? event.target.value : old)))
                    }
                  >
                    <option value="">Choose a category</option>
                    {field.choices.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field min-w-0"
                    aria-label={`${field.label} ${index + 1}`}
                    value={entry}
                    maxLength={150}
                    onChange={(event) =>
                      onChange(values.map((old, position) => (index === position ? event.target.value : old)))
                    }
                  />
                )}
                <button
                  type="button"
                  className="btn btn-ghost !px-3"
                  aria-label={`Remove ${field.label.toLowerCase()} ${index + 1}`}
                  onClick={() => onChange(values.filter((_, position) => position !== index))}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm w-fit"
              disabled={values.length >= 20}
              onClick={() => onChange([...values, ""])}
            >
              <Plus className="h-4 w-4" />
              Add an entry
            </button>
          </div>
        ) : (
          <input
            id={id}
            className="field"
            type={field.kind === "date" ? "date" : "text"}
            aria-label={field.label}
            aria-describedby={field.hint ? `${id}-hint` : undefined}
            value={typeof value === "string" ? value : ""}
            maxLength={300}
            onChange={(event) => onChange(event.target.value || undefined)}
            data-testid={`input-${id}`}
          />
        ))}
    </fieldset>
  );
}

function Fields({
  fields,
  answers,
  onChange,
  prefix,
}: {
  fields: Field[];
  answers: RichSectionAnswers;
  onChange: (key: string, value: RichValue | undefined) => void;
  prefix: string;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {fields.map((field) => (
        <AnswerField
          key={field.key}
          prefix={prefix}
          field={field}
          value={answers[field.key]}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </div>
  );
}

export function RichCheckerFields({
  section,
  facts,
  onChange,
}: {
  section: RichSection;
  facts: RichCheckerFacts;
  onChange: (facts: RichCheckerFacts) => void;
}) {
  const answers = (facts.rich?.[section] ?? {}) as RichSectionAnswers;
  const set = (key: string, value: RichValue | undefined) =>
    onChange(updateRichAnswer(facts, section, key, value));
  const title = {
    businessName: "Optional name and operator details",
    tax: "Optional company and accounting details",
    privacy: "Optional personal-data details",
    product: "Optional product and activity details",
  }[section];
  const fields = {
    businessName: BUSINESS_FIELDS,
    tax: TAX_FIELDS,
    privacy: PRIVACY_FIELDS,
    product: PRODUCT_FIELDS,
  }[section];
  const naming =
    answers.namingAssessment &&
    typeof answers.namingAssessment === "object" &&
    !Array.isArray(answers.namingAssessment) &&
    !isRichMarker(answers.namingAssessment)
      ? answers.namingAssessment
      : {};
  const partners = Array.isArray(answers.partners)
    ? answers.partners.filter(
        (partner): partner is RichSectionAnswers =>
          !!partner && typeof partner === "object" && !Array.isArray(partner) && !isRichMarker(partner),
      )
    : [];
  return (
    <details className="rounded-2xl border border-border p-4 sm:p-5" data-testid={`rich-section-${section}`}>
      <summary id={`rich-${section}-summary`} className="cursor-pointer font-medium">
        {title}
      </summary>
      <p className="mb-6 mt-3 text-sm leading-relaxed text-muted-foreground">
        Answer only what you know. Leaving a field untouched, skipping it, and saying you do not know remain
        different answers. Changing another answer does not erase these details.
      </p>
      {section === "businessName" && (
        <p className="mb-6 rounded-xl bg-secondary p-3 text-sm">
          Name details are optional and available while signed in. They are sent for this check; the result is
          stored, privately, only when you explicitly agree to save it. Do not enter identity numbers or
          upload records here.
        </p>
      )}
      <Fields fields={fields} answers={answers} onChange={set} prefix={`rich-${section}`} />
      {section === "businessName" && (
        <>
          <fieldset className="mt-8 grid gap-5">
            <legend className="label">Partners, if relevant</legend>
            <p className="text-xs text-muted-foreground">
              List every relevant partner. No names are inferred from the business name.
            </p>
            {partners.map((partner, index) => (
              <div className="rounded-xl border border-border p-4" key={index}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="font-medium">Partner {index + 1}</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      set(
                        "partners",
                        partners.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove partner {index + 1}
                  </button>
                </div>
                <Fields
                  fields={PARTNER_FIELDS}
                  answers={partner}
                  prefix={`rich-partner-${index}`}
                  onChange={(key, value) => {
                    const next = { ...partner };
                    if (value === undefined) delete next[key];
                    else next[key] = value;
                    set(
                      "partners",
                      partners.map((old, i) => (i === index ? next : old)),
                    );
                  }}
                />
              </div>
            ))}
            <button
              id="rich-partners-add"
              type="button"
              className="btn btn-ghost btn-sm w-fit"
              disabled={partners.length >= 30}
              onClick={() => set("partners", [...partners, {}])}
            >
              <Plus className="h-4 w-4" />
              Add partner
            </button>
            {answers.partners !== undefined && (
              <button
                type="button"
                className="btn btn-ghost btn-sm w-fit"
                onClick={() => set("partners", undefined)}
              >
                Clear partner answers
              </button>
            )}
          </fieldset>
          <div className="mt-8">
            <h3 className="label mb-4">How the name is composed</h3>
            <Fields
              fields={NAMING_FIELDS}
              answers={naming}
              prefix="rich-naming"
              onChange={(key, value) => {
                const next = { ...naming };
                if (value === undefined) delete next[key];
                else next[key] = value;
                set("namingAssessment", Object.keys(next).length ? next : undefined);
              }}
            />
          </div>
        </>
      )}
    </details>
  );
}
