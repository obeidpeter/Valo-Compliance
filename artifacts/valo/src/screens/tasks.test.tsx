import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { getListTasksPageQueryKey, type TaskPage, type WorkspaceTask } from "@workspace/api-client-react";
import TasksPage from "./tasks";

const task = (id: string, state: WorkspaceTask["state"]): WorkspaceTask => ({
  id,
  title: `Synthetic task ${id}`,
  notes: "",
  state,
  revision: 1,
  dueDate: null,
  dateConfirmed: false,
  assessmentId: null,
  ruleId: null,
  needsReview: false,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-02T09:00:00.000Z",
});

/** The task page as the browser first draws it, from a task list already in the query cache. */
function renderTasks(items: WorkspaceTask[]) {
  const client = new QueryClient();
  const page: TaskPage = {
    items,
    total: items.length,
    openCount: items.filter((t) => t.state !== "completed_by_user").length,
    filteredTotal: items.length,
    page: 1,
    pageSize: 20,
    hasNext: false,
  };
  client.setQueryData(getListTasksPageQueryKey({ page: 1, filter: "open" }), page);
  return renderToStaticMarkup(
    <Router ssrPath="/workspace/tasks">
      <QueryClientProvider client={client}>
        <TasksPage />
      </QueryClientProvider>
    </Router>,
  );
}

test("a task the user marks done says it was recorded by them, not approved by a regulator", () => {
  const html = renderTasks([
    task("synthetic-done", "completed_by_user"),
    task("synthetic-open", "not_started"),
  ]);
  const done = html.slice(
    html.indexOf("Synthetic task synthetic-done"),
    html.indexOf("Synthetic task synthetic-open"),
  );
  const open = html.slice(html.indexOf("Synthetic task synthetic-open"));
  assert.ok(done.includes("Done (by you)"), done);
  assert.ok(done.includes("Recorded as done by you. Not regulator approval."), done);
  assert.ok(open.includes("Not started"), open);
  assert.ok(!open.includes("Recorded as done by you"), open);
});

test("the web app never says a task or result was accepted or approved by a regulator", () => {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  const source = fileURLToPath(new URL("..", import.meta.url));
  walk(source);
  walk(fileURLToPath(new URL("../../app", import.meta.url)));
  assert.ok(files.length > 50, "the web app's source was read");
  const claim =
    /(accepted|approved|confirmed|certified|verified|signed off) by (a |an |the )?(regulator|authority|government|agency|commission)|regulator[- ](approved|accepted|verified)|government[- ](approved|accepted|verified)/gi;
  // Saying what something is not is the point of these notices, so a sentence that denies it passes.
  const denial = /\b(not|no|never|nor|without|isn't|aren't|doesn't|don't|cannot)\b/i;
  const claims: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(claim)) {
      const before = text.slice(0, match.index);
      const start = Math.max(...[". ", ".\n", ">", "{", "}", '"', "`"].map((end) => before.lastIndexOf(end)));
      const rest = text.slice(match.index);
      const end = Math.min(
        ...[".", "<", "{", "}", '"', "`"].map((e) => rest.indexOf(e)).filter((i) => i >= 0),
      );
      const sentence = text
        .slice(start + 1, match.index + end)
        .replace(/\s+/g, " ")
        .trim();
      if (!denial.test(sentence)) claims.push(`${file.slice(source.length)}: ${sentence}`);
    }
  }
  assert.deepEqual(claims, []);
});
