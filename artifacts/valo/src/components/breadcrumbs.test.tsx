import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { Breadcrumbs } from "./breadcrumbs";

test("Breadcrumbs renders parent links with testIds and marks the final item as current page", () => {
  const html = renderToStaticMarkup(
    <Router ssrPath="/workspace/documents/1">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/workspace" },
          { label: "Your documents", href: "/workspace/documents", testId: "link-back" },
          { label: "November Invoice" },
        ]}
      />
    </Router>,
  );
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /href="\/workspace"[^>]*>Home<\/a>/);
  assert.match(html, /data-testid="link-back"[^>]*>Your documents<\/a>/);
  assert.match(html, /aria-current="page"[^>]*>November Invoice<\/span>/);
});
