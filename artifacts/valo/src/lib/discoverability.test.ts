import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { before, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { publicPages } from "./public-metadata";

// The server reads the API while rendering a request, so the request's headers come from Next. Here
// a synthetic request carries the address its proxy forwarded, which the reads must pass on.
const forwardedFor = "203.0.113.9";
mock.module("next/headers", {
  namedExports: { headers: async () => new Headers({ "x-forwarded-for": forwardedFor }) },
});
let generateMetadata: (typeof import("../../app/[[...slug]]/page"))["generateMetadata"];
let templateMetadata: (typeof import("../../app/(public)/library/[slug]/page"))["generateMetadata"];
let sitemap: (typeof import("../../app/sitemap"))["default"];
before(async () => {
  ({ generateMetadata } = await import("../../app/[[...slug]]/page"));
  ({ generateMetadata: templateMetadata } = await import("../../app/(public)/library/[slug]/page"));
  ({ default: sitemap } = await import("../../app/sitemap"));
});

// WEB-004: "Render public content with meaningful metadata, canonical URLs and a sitemap; exclude
// accounts, drafts and admin pages", accepted when "no fictional testimonials, customers, ratings or
// regulator endorsements are displayed in production".
const origin = "https://synthetic-valo.example";
const released = [
  {
    path: "/library/synthetic-invoice",
    title: "Synthetic invoice",
    description: "A released synthetic template.",
    modifiedAt: "2026-11-02T00:00:00.000Z",
  },
  {
    path: "/resources/synthetic-guide",
    title: "Synthetic guide",
    description: "Guidance.",
    modifiedAt: null,
  },
];
// What the API must never return, and the web app must drop if it did.
const privatePaths = [
  "/workspace/drafts",
  "/staff/users",
  "/account",
  "/admin/roles",
  "/resources/../workspace",
];

async function withDiscovery<T>(run: (requested: string[]) => Promise<T>) {
  const fetch = globalThis.fetch;
  const saved = process.env.VALO_TRUSTED_ORIGIN;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    requested.push(String(url));
    // As an anonymous visitor: no cookie, no Authorization, and the forwarded address passed on.
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-forwarded-for"), forwardedFor);
    const items = [...released, ...privatePaths.map((path) => ({ ...released[0]!, path }))];
    return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  process.env.VALO_TRUSTED_ORIGIN = origin;
  try {
    return await run(requested);
  } finally {
    globalThis.fetch = fetch;
    if (saved === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
    else process.env.VALO_TRUSTED_ORIGIN = saved;
  }
}

const accountOrAdmin = /^\/(workspace|account|staff|admin|sign-in|sign-up|drafts?)(\/|$)/;

test("the sitemap lists the public pages and released items only, never accounts, drafts or staff pages", async () => {
  await withDiscovery(async (requested) => {
    const entries = await sitemap();
    assert.deepEqual(requested, [`${origin}/api/public/discovery`], "only the configured origin is asked");
    assert.deepEqual(
      entries.map((entry) => entry.url),
      [...Object.keys(publicPages), ...released.map((item) => item.path)].map((path) => origin + path),
    );
    assert.deepEqual(
      entries.find((entry) => entry.url.endsWith("/library/synthetic-invoice"))?.lastModified,
      new Date("2026-11-02T00:00:00.000Z"),
    );
    assert.deepEqual(
      Object.keys(publicPages).filter((path) => accountOrAdmin.test(path)),
      [],
    );
  });
});

test("public pages get a title, description and canonical URL; private or unknown pages get neither", async () => {
  await withDiscovery(async () => {
    const page = (...slug: string[]) => generateMetadata({ params: Promise.resolve({ slug }) });
    assert.deepEqual(await page("library"), {
      title: "Document library — Valo",
      description: publicPages["/library"]!.description,
      alternates: { canonical: `${origin}/library` },
      robots: { index: false, follow: false },
    });
    // Support and account access help are public pages too, so each is titled for what it is.
    assert.equal((await page("support")).title, "Support — Valo");
    assert.equal((await page("account-access")).title, "Account access help — Valo");
    // A released item's page is its own server-rendered route, titled as the API's discovery lists it.
    const template = (slug: string) => templateMetadata({ params: Promise.resolve({ slug }) });
    assert.deepEqual(await template("synthetic-invoice"), {
      title: "Synthetic invoice — Valo",
      description: "A released synthetic template.",
      alternates: { canonical: `${origin}/library/synthetic-invoice` },
      robots: { index: false, follow: false },
    });
    assert.deepEqual(await template("not-released"), {
      title: "Page unavailable or private — Valo",
      robots: { index: false, follow: false },
    });
    for (const slug of [["workspace", "drafts"], ["staff", "users"], ["account"]])
      assert.deepEqual(await page(...slug), {
        title: "Page unavailable or private — Valo",
        robots: { index: false, follow: false },
      });
  });
  // Every page stays out of search engines until a reviewed launch change (AGENTS.md section 8).
  assert.equal(
    readFileSync(fileURLToPath(new URL("../../public/robots.txt", import.meta.url)), "utf8"),
    "User-agent: *\nDisallow: /\n",
  );
});

test("the web app shows no testimonials, customer counts, ratings or regulator endorsements", () => {
  const source = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(source);
  walk(fileURLToPath(new URL("../../app", import.meta.url)));
  assert.ok(files.length > 50, "the web app's source was read");
  const claim =
    /testimonial|trusted by|as seen (in|on)|featured in|[0-9.]+\s*(\/\s*5|out of 5|stars?)\b|★|\brated\b|happy (customers|clients)|[0-9,]+\+? (businesses|customers|smes|users)\b|endorse|accredit|certified by|approved by|official partner|in partnership with|(government|regulator)[- ](approved|backed|endorsed)/gi;
  // Saying Valo has no such backing is the point, so a sentence that denies the claim passes.
  const denial = /\b(not|no|never|nor|without|isn't|aren't|doesn't|don't|cannot)\b/i;
  // The About page lists what Valo is not, under that heading; its items deny by position.
  const about = fileURLToPath(new URL("../../app/(public)/about/page.tsx", import.meta.url));
  const aboutText = readFileSync(about, "utf8");
  assert.match(aboutText, /<p className="eyebrow">What Valo is not<\/p>\s*<ul[^>]*>\s*\{NOT\.map\(/);
  const notStart = aboutText.indexOf("const NOT = [");
  const notList = [notStart, aboutText.indexOf("];", notStart)] as const;
  assert.ok(notList[0] > 0 && notList[1] > notList[0], "the About page's list of what Valo is not");
  const claims: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(claim)) {
      if (file === about && match.index > notList[0] && match.index < notList[1]) continue;
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
  // The site footer says so on every page.
  assert.match(
    readFileSync(join(source, "components/site-chrome.tsx"), "utf8"),
    /Valo does not provide legal, tax or accounting advice, and no regulator endorses it\./,
  );
});
