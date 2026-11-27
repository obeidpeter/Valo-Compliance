import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlainText } from "./resource-parts";

test("a guide's text shows each paragraph, and a paragraph of list lines as a list, whether written with • or -", () => {
  const html = renderToStaticMarkup(
    <PlainText
      text={[
        "Before submitting:",
        "- Check dates, amounts and currency.\n- Explain the business purpose of each line.",
        "• Keep the receipt.\n• Note the payment date.",
        "A line that starts - like this\nis still a paragraph when not every line is a list line.",
      ].join("\n\n")}
    />,
  );
  assert.match(html, /<p class="whitespace-pre-line">Before submitting:<\/p>/);
  assert.match(
    html,
    /<ul class="list-disc space-y-1 pl-5"><li>Check dates, amounts and currency\.<\/li><li>Explain the business purpose of each line\.<\/li><\/ul>/,
  );
  assert.match(html, /<li>Keep the receipt\.<\/li><li>Note the payment date\.<\/li><\/ul>/);
  assert.match(html, /<p class="whitespace-pre-line">A line that starts - like this\nis still a paragraph/);
  assert.equal(html.match(/<ul /g)?.length, 2);
});
