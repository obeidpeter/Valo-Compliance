import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_PAGES,
  WORKSPACE_SECTIONS,
  inWorkspace,
  onAccountPage,
  onPage,
  sectionOf,
} from "./workspace-sections";

const section = (path: string) => sectionOf(path)?.id;

test("a workspace address belongs to one section, and a screen opened from a page is counted with that page", () => {
  assert.equal(section("/workspace"), "home");
  assert.equal(section("/workspace/documents"), "documents");
  assert.equal(section("/workspace/documents/00000000-0000-4000-8000-00000000d001"), "documents");
  assert.equal(section("/workspace/ai"), "documents");
  assert.equal(section("/workspace/ai/00000000-0000-4000-8000-00000000e001"), "documents");
  assert.equal(section("/workspace/checker"), "requirements");
  assert.equal(section("/workspace/assessments"), "requirements");
  assert.equal(section("/workspace/assessments/00000000-0000-4000-8000-00000000a001"), "requirements");
  assert.equal(section("/workspace/tasks"), "tasks");
  assert.equal(section("/workspace/reminders"), "tasks");
  // The old address of the reminders page still opens it.
  assert.equal(section("/workspace/notifications"), "tasks");
  assert.equal(section("/workspace/profile"), "profile");

  // Home is the workspace's own address alone, and an address that only starts like a page's is
  // not that page.
  assert.equal(section("/workspace/somewhere-else"), undefined);
  assert.equal(section("/workspace/documents-archive"), undefined);
  assert.equal(section("/workspace/tasksheet"), undefined);

  // The public checker is the same screen outside the workspace, and is in none of its sections.
  assert.equal(section("/checker"), undefined);
  assert.equal(inWorkspace("/checker"), false);
  assert.equal(inWorkspace("/workspaces"), false);
  assert.equal(inWorkspace("/staff"), false);
  assert.equal(inWorkspace("/workspace"), true);
  assert.equal(inWorkspace("/workspace/tasks"), true);
});

test("the account's pages are in no section, and each marks only itself", () => {
  assert.deepEqual(
    ACCOUNT_PAGES.map((page) => page.label),
    ["Sign-in and security", "Privacy and data", "Purchases", "Messages", "Support requests"],
  );
  for (const page of ACCOUNT_PAGES) {
    assert.equal(onAccountPage(page.href), true, page.href);
    assert.equal(section(page.href), undefined, page.href);
    assert.deepEqual(
      ACCOUNT_PAGES.filter((other) => onPage(other, page.href)),
      [page],
      page.href,
    );
  }
  assert.equal(onAccountPage("/workspace"), false);
  assert.equal(onAccountPage("/workspace/tasks"), false);
  assert.equal(onAccountPage("/workspace/accounting"), false);
});

test("a section opens its first page, and every page of every section marks only itself", () => {
  assert.deepEqual(
    WORKSPACE_SECTIONS.map((s) => [s.label, s.short, s.href]),
    [
      ["Home", "Home", "/workspace"],
      ["Documents", "Documents", "/workspace/documents"],
      ["Requirements", "Requirements", "/workspace/checker"],
      ["Tasks", "Tasks", "/workspace/tasks"],
      ["Business profile", "Profile", "/workspace/profile"],
    ],
  );
  const pages = WORKSPACE_SECTIONS.flatMap((s) => s.pages);
  for (const s of WORKSPACE_SECTIONS) {
    assert.equal(section(s.href), s.id, s.href);
    if (s.pages.length > 0) assert.equal(s.pages[0]!.href, s.href, `${s.label} opens its first page`);
    // A section with one page has no tabs, so it lists none.
    assert.notEqual(s.pages.length, 1, s.label);
    for (const page of s.pages) {
      assert.equal(section(page.href), s.id, page.href);
      assert.deepEqual(
        pages.filter((other) => onPage(other, page.href)),
        [page],
        page.href,
      );
    }
  }
});

test("every workspace screen the app has a route for is in a section or among the account's pages, and every page listed has a route", () => {
  const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
  const routes = [...app.matchAll(/<Route path="(\/workspace[^"]*)"/g)].map((match) => match[1]!);
  assert.ok(routes.length >= 15, `the app's workspace routes were read (${routes.length})`);
  for (const route of routes) {
    const path = route.replace(":id", "00000000-0000-4000-8000-000000000001");
    assert.ok(
      sectionOf(path) !== undefined || onAccountPage(path),
      `${route} is in no section and is not an account page, so no menu would mark it`,
    );
    assert.ok(!(sectionOf(path) !== undefined && onAccountPage(path)), `${route} is in two places`);
  }
  const listed = [
    ...WORKSPACE_SECTIONS.map((s) => s.href),
    ...WORKSPACE_SECTIONS.flatMap((s) => s.pages).flatMap((page) => [page.href, ...(page.also ?? [])]),
    ...ACCOUNT_PAGES.map((page) => page.href),
  ];
  for (const href of listed)
    assert.ok(routes.includes(href), `${href} is listed but the app has no route for it`);
});
