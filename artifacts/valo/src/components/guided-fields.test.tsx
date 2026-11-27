import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { emptyFormData } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { formViewV2, type FormView } from "@/lib/form-view";
import { GuidedFields } from "./guided-fields";

// EDT-001: a v2 form's questions show their examples, as hints under their inputs that describe
// them for a screen reader. The questions-only forms (v1) keep their questions exactly as they were.
const drawn = (spec: FormView, value: Parameters<typeof GuidedFields>[0]["value"]) =>
  renderToStaticMarkup(<GuidedFields spec={spec} value={value} onChange={() => undefined} />);

test("a v2 form's question shows its example under its input, and the input is described by it", () => {
  const spec = GUIDED_SPECS_V2["TPL-17"]!;
  const html = drawn(formViewV2(spec), emptyFormData(spec));
  const example =
    /<p id="([^"]+)-example" class="hint" data-testid="example-[^"]+">For example: ([^<]+)<\/p>/g;
  const shown = [...html.matchAll(example)].map(([, id, text]) => [id, text]);
  const expected = spec.fields.filter((f) => f.example).map((f) => f.example!.replaceAll("'", "&#x27;"));
  assert.deepEqual(
    shown.map(([, text]) => text),
    expected,
  );
  for (const [id] of shown)
    assert.match(
      html,
      new RegExp(`id="${id}"[^>]*aria-describedby="[^"]*${id}-example`),
      `${id} is described by its example`,
    );
  assert.ok(shown.some(([, text]) => text === "The office manager, at reception"));
});

test("a questions-only form shows no examples", () => {
  const html = drawn(GUIDED_SPECS_V1["TPL-17"] as unknown as FormView, emptyGuidedData("TPL-17"));
  assert.doesNotMatch(html, /For example:/);
});
