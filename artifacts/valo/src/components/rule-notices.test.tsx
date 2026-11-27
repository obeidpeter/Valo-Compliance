import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { getListRuleNoticesQueryKey, type RuleNotice } from "@workspace/api-client-react";
import { RuleNotices, ruleNoticeWords } from "./rule-notices";

// docs/architecture/rule-changes.md, slice 2 (EDP-011, RUL-009): a workspace that saved a result under a
// rule's version, or made a task from it, is told when the version is replaced or withdrawn, with the
// reason given, that its saved results are kept as they were saved, and that its tasks are marked for
// review with their reminders stopped.
const replaced: RuleNotice = {
  id: "00000000-0000-4000-8000-00000000e201",
  ruleId: "synthetic-rule",
  title: "Synthetic business name registration",
  version: 1,
  kind: "replaced",
  replacementVersion: 2,
  reason: "Synthetic change: the second version restates the synthetic provision",
  results: 2,
  tasks: 1,
  createdAt: "2026-11-25T09:00:00.000Z",
};
const withdrawn: RuleNotice = {
  ...replaced,
  id: "00000000-0000-4000-8000-00000000e202",
  version: 2,
  kind: "withdrawn",
  replacementVersion: null,
  reason: "Synthetic withdrawal: the synthetic provision no longer applies.",
  results: 1,
  tasks: 0,
  createdAt: "2026-11-26T09:00:00.000Z",
};

test("a rule notice names the rule, its version and what happened, gives the reason, and says what it means for the saved results and tasks", () => {
  assert.deepEqual(ruleNoticeWords(replaced), {
    title: "“Synthetic business name registration” version 1 was replaced by version 2 on 25 Nov 2026",
    lines: [
      "What changed: Synthetic change: the second version restates the synthetic provision.",
      "Your 2 saved results that list it are kept as they were saved. Check again to see what applies now.",
      "Your task made from it is marked for review, and its reminders have stopped.",
    ],
  });
  assert.deepEqual(ruleNoticeWords(withdrawn), {
    title: "“Synthetic business name registration” version 2 was withdrawn on 26 Nov 2026",
    lines: [
      "Why: Synthetic withdrawal: the synthetic provision no longer applies.",
      "Your saved result that lists it is kept as it was saved. Check again to see what applies now.",
    ],
  });
  // A workspace that only made tasks hears nothing of saved results.
  assert.deepEqual(ruleNoticeWords({ ...withdrawn, results: 0, tasks: 3 }).lines, [
    "Why: Synthetic withdrawal: the synthetic provision no longer applies.",
    "Your 3 tasks made from it are marked for review, and their reminders have stopped.",
  ]);
});

test("the workspace's home lists its unread rule notices, each with a way to check again and to mark it read, and nothing when there are none", () => {
  const shown = (items: RuleNotice[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(getListRuleNoticesQueryKey(), { items });
    return renderToStaticMarkup(
      <Router ssrPath="/workspace">
        <QueryClientProvider client={client}>
          <RuleNotices />
        </QueryClientProvider>
      </Router>,
    );
  };
  const markup = shown([replaced, withdrawn]);
  assert.match(markup, /Changes to requirements you checked/);
  assert.match(
    markup,
    /“Synthetic business name registration” version 1 was replaced by version 2 on 25 Nov 2026/,
  );
  assert.equal(
    markup.match(/<a[^>]*href="\/workspace\/checker"[^>]*>Check again<\/a> to see what applies now\./g)
      ?.length,
    2,
  );
  assert.equal(markup.match(/>Mark as read</g)?.length, 2);
  assert.match(
    markup,
    /aria-label="Mark as read: “Synthetic business name registration” version 2 was withdrawn on 26 Nov 2026"/,
  );
  assert.equal(shown([]), "");
});
