import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readListedPage } from "./listed-page";
import { fetchListedPage, MAX_SOURCE_BYTES } from "./source-fetch";

// Nothing here is sent anywhere: the transport is a stand-in, and the addresses use a reserved
// name that reaches no one (RFC 2606).
const page = "https://pages.example.invalid/terms/";
const listed = [page, "https://pages.example.invalid/other/"];
type Answer = { status: number; mime: string; location: string | undefined; bytes: Buffer };
const answer = (over: Partial<Answer> = {}): Answer => ({
  status: 200,
  mime: "text/html",
  location: undefined,
  bytes: Buffer.from(""),
  ...over,
});
const html = (body: string) =>
  Buffer.from(
    `<!doctype html><html><head><title>Terms</title></head><body><main>${body}</main></body></html>`,
  );
const words = "These are the words of a page that is long enough to count as read. ".repeat(6);

test("only an address on the caller's own list is fetched, over https, and a redirect stays on its host", async () => {
  const asked: string[] = [];
  const through = (answers: Answer[]) => async (url: URL, limit: number) => {
    assert.equal(limit, MAX_SOURCE_BYTES);
    asked.push(url.href);
    return answers.shift()!;
  };
  // An address that is not on the list, or is on it but not plain https, is refused unsent.
  for (const [address, list] of [
    ["https://pages.example.invalid/unlisted/", listed],
    ["http://pages.example.invalid/terms/", ["http://pages.example.invalid/terms/"]],
    [
      "https://user:secret@pages.example.invalid/terms/",
      ["https://user:secret@pages.example.invalid/terms/"],
    ],
    ["https://pages.example.invalid:8443/terms/", ["https://pages.example.invalid:8443/terms/"]],
  ] as const)
    await assert.rejects(fetchListedPage(address, list, through([])), /SOURCE_NOT_ALLOWLISTED/);
  assert.deepEqual(asked, []);

  // A page served directly.
  const direct = await fetchListedPage(page, listed, through([answer({ bytes: Buffer.from("x") })]));
  assert.equal(direct.finalUrl, page);
  assert.equal(direct.status, 200);
  // A redirect on the same host is followed; the request never leaves that host.
  asked.length = 0;
  const moved = await fetchListedPage(
    page,
    listed,
    through([answer({ status: 301, location: "/terms/current/" }), answer({ bytes: Buffer.from("y") })]),
  );
  assert.equal(moved.finalUrl, "https://pages.example.invalid/terms/current/");
  assert.deepEqual(asked, [page, "https://pages.example.invalid/terms/current/"]);
  for (const location of [
    "https://elsewhere.example.invalid/terms/",
    "http://pages.example.invalid/terms/",
    "https://pages.example.invalid:8443/terms/",
  ]) {
    asked.length = 0;
    await assert.rejects(
      fetchListedPage(page, listed, through([answer({ status: 302, location })])),
      /SOURCE_REDIRECT_NOT_ALLOWLISTED/,
    );
    assert.deepEqual(asked, [page], "the redirect's target is never asked");
  }
  await assert.rejects(
    fetchListedPage(page, listed, through([answer({ status: 302 })])),
    /SOURCE_REDIRECT_MISSING/,
  );
  await assert.rejects(
    fetchListedPage(
      page,
      listed,
      through(Array.from({ length: 5 }, () => answer({ status: 302, location: "/terms/" }))),
    ),
    /SOURCE_REDIRECT_LIMIT/,
  );
});

test("a listed page is read with the official sources' extractor, and anything but a real page is refused", async () => {
  const served = (response: Answer) => async () => ({ ...response, finalUrl: page, fetchedAt: new Date(0) });
  const bytes = html(`<h1>Terms</h1><p>${words}</p><script>document.title = "never run"</script>`);
  const read = await readListedPage(page, listed, served(answer({ bytes })));
  assert.equal(read.url, page);
  assert.equal(read.fetchedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(read.rawChecksum, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(read.text.includes(words.trim()));
  assert.ok(!read.text.includes("never run"), "a script's text is not the page's words");

  await assert.rejects(
    readListedPage(page, listed, served(answer({ status: 403, bytes }))),
    /SOURCE_HTTP_403/,
  );
  await assert.rejects(
    readListedPage(page, listed, served(answer({ status: 404, bytes }))),
    /SOURCE_HTTP_404/,
  );
  await assert.rejects(
    readListedPage(page, listed, served(answer({ mime: "application/pdf", bytes }))),
    /SOURCE_NOT_A_WEB_PAGE/,
  );
  await assert.rejects(
    readListedPage(page, listed, served(answer({ bytes: html("<p>Too short.</p>") }))),
    /SOURCE_INSUFFICIENT_TEXT/,
  );
  await assert.rejects(
    readListedPage(page, listed, served(answer({ bytes: html(`<p>Just a moment... ${words}</p>`) }))),
    /SOURCE_CHALLENGE_PAGE/,
  );
  // The reader passes the caller's list to the fetch, which enforces it.
  await assert.rejects(
    readListedPage("https://pages.example.invalid/unlisted/", listed),
    /SOURCE_NOT_ALLOWLISTED/,
  );
});
