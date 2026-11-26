# Hostile markup, injection and cross-site requests

Design for the finishing plan's Phase 7 row "Tests in CI that store hostile markup and render it,
reflect it, inject it and cross sites; a rule against raw-HTML output; two test files that run
nowhere", for SEC-003. It is a proposal under the owner's delegation of 24 November. The tests it
adds are not an independent security assessment, which the register names as this requirement's
owner.

The requirement, verbatim from the specification:
- SEC-003: "Use parameterised database access, schema validation, sanitised rich text and a
  restrictive content-security policy. Apply CSRF protection to cookie-authenticated mutations.
  Accept: stored/reflected XSS, injection and cross-site mutation tests pass."

The register adds, for SEC-003: suggested owner "Security / independent assessor"; dependencies "all
private surfaces", "least-privilege roles" and "staging environment"; and the risk "Passing builds and
generic scans are not independent security acceptance."

## What there is

- **Cross-site changes.** The browser signs in with the identity provider's session cookie, which it
  sends on the site's own requests. Every change the API accepts passes one check first
  (`sameOriginMutation`, `artifacts/api-server/src/middlewares/valo-identity.ts`). It refuses the
  request with 403 `UNTRUSTED_ORIGIN` unless:
  - its `Origin` is exactly the site's configured origin, which never comes from the `Host` or
    forwarding headers;
  - its `Sec-Fetch-Site`, when sent, is `same-origin` or `none`;
  - its body is JSON, which a page on another site cannot send without the browser asking the API
    first.

  The workspace and file routes check this before they look at who is signed in. Each staff route
  checks it first, after the gate that admits only staff. There is no CSRF token: the origin and JSON
  checks are the protection, two of the defences OWASP's cross-site request forgery guidance names
  (checking the origin with standard headers, and a content type a form cannot send).
  - Tested: the origin comparison and the check itself, in unit tests; a hostile `Origin` on five
    routes, in database tests.
  - Not tested: `Sec-Fetch-Site`, a form's body sent with the right `Origin`, a missing `Origin`
    across the routes, and whether every one of the contract's 77 changes passes the check.
- **Two test files that run nowhere.** `artifacts/api-server/src/lib/valo-proxy-security.test.ts` and
  `artifacts/api-server/src/lib/valo-http.test.ts` probe the Replit development preview:
  - forwarding headers sent through the real proxy;
  - malformed bodies, private reads and cross-site changes;
  - the development database's own data.

  CI runs neither. The test inventory records both as "probes a running development preview".
- **Content security policy.** The web app's policy allows scripts only by a nonce made for each
  response, with `strict-dynamic`. In production it allows no inline or evaluated script, no
  objects and no framing, with `base-uri 'none'` and `form-action 'self'`.
  - Tested: in a unit test; in a browser against the compiled app, where an injected script without
    the nonce does not run; and on the pages the server draws.
  - The API answers JSON and files. It sets `nosniff`, `X-Frame-Options`, `Referrer-Policy` and HSTS,
    but only after it has read the body. So these answers go without them:
    - the 400 or 413 for a malformed or oversized body;
    - the production rehearsal's 503;
    - the payment provider's webhook.
- **Rich text.** Valo has none.
  - Documents, forms, support messages and privacy messages are plain text, and validation refuses an
    HTML block.
  - The web app draws every text through React. Nothing in it uses `dangerouslySetInnerHTML`,
    `innerHTML` or an HTML sanitiser.
  - A guide's links are made only from https addresses among its verified sources.
  - The PDF is drawn from HTML in which every text is escaped, with scripts off and every request the
    page makes refused. The Word file is built by a library that escapes its text.
  - Tested: the renderer's tests store markup, local-file and metadata addresses in a document, and
    find them inert in the PDF and the Word file.
  - Not tested: no test stores markup through the API and then draws it on a screen.
  - No rule stops raw HTML: the linter's `react/no-danger` is off.
- **Database access.** Every request reaches the database through Drizzle's query builder or its
  `sql` template, both of which send values as parameters.
  - Text is put into SQL only in reviewed places: a role name from a fixed list; operator commands
    that apply committed SQL files; and table, column and schema names from fixed lists, or checked
    against a pattern.
  - Both searches that use `LIKE` escape `%`, `_` and `\` first.
  - Not tested: no test sends SQL or wildcards as input.
  - No rule stops a new `sql.raw`.
- **Schema validation.**
  - Request bodies are parsed with the generated Zod schemas, most of them made strict, and path
    parameters with schemas of their own.
  - Limits on size and structure come first.
  - A failure answers 422 and names the fields.
- **Reflection.** Errors are JSON. Two of them repeat what the caller sent, both inside JSON: a 422's
  field paths, which can name the caller's own keys, and a form's sentence that a key "is not a
  question of this form". The library page puts its search into the page, through React.

## The parts

### Part 1: every change, from another site

A CI test in the database job starts the whole API on a disposable database. As in the other HTTP
tests, it stands in for the identity provider. It signs in a synthetic customer with a workspace, and
a synthetic member of staff who holds every staff role but the reviewer's and has just passed both
sign-in factors. Then it sends every change in the contract, as a page on another site could:
- with that site's `Origin`;
- with no `Origin`, and with `Origin: null`;
- with the site's own `Origin` and `Sec-Fetch-Site: cross-site`, then `same-site`;
- with the site's own `Origin` and a body a form sends without script: `text/plain`,
  `application/x-www-form-urlencoded` and `multipart/form-data`.

It reads the changes from the contract, so a change added later is covered the day it is added. Each
must be refused with 403 `UNTRUSTED_ORIGIN`. Each refusal must be counted as denied access for the
security alerts (SEC-008), and the database must be otherwise unchanged.

One change is exempt, with its reason in the test: the anonymous requirements preview, which has no
account and saves nothing but the visitor's count. The payment provider's webhook is not in the
contract. It carries the provider's signature and no cookie, and its own tests refuse a forged one.

The same test takes the checks from the two preview files that need no preview:
- **Forwarding headers, against the API itself.** Each is refused:
  - a hostile `X-Forwarded-Host` and `X-Forwarded-Proto`, and the standard `Forwarded` header;
  - a list of hops, whichever comes first;
  - a wrong scheme or port;
  - two `Origin` values.

  The right `Origin`, with spoofed forwarding headers, reaches the sign-in check and gets 401.
- **Request handling:**
  - a malformed body and an oversized one fail with 400 and 413, and neither answer repeats what was
    sent;
  - private reads made signed out get 401, with `no-store` and no cross-origin header;
  - the right `Origin` without a sign-in gets 401.

The preview files stay, as probes of the real proxy and of the development database's data. The test
inventory says which of their checks now run in CI.

### Part 2: stored markup, drawn on the screen

A CI browser test in the database job, using the harness the tester tasks rehearsal uses: the real web
app, the real API and a disposable database. A synthetic customer saves hostile markup through the
API wherever they type text that the app shows back:
- the business profile;
- a document's title and fields;
- the answers to a template's questions;
- a task;
- a support request;
- a privacy request.

A member of staff answers the support request with markup too. The test opens each screen that shows
these texts, the customer's and the staff's, and checks three things:
- **No script runs.** Each payload tries to set a flag, call `alert`, or load an image whose error
  handler sets a flag. None of them fires, and no dialog opens.
- **No element appears.** None of the elements the markup tries to make is in the page: `script`,
  `img`, `svg`, `iframe`, `object`, or a link to a `javascript:` address.
- **The text is shown.** The markup appears as the text the person typed.

The test page is served without the content security policy. So the test shows that the app's own
handling of text stops the markup, and not the policy behind it.

The payloads live in one test-support list. They cover:
- elements;
- breaking out of an attribute (`"><img src=x onerror=…>`);
- event handlers and `javascript:` addresses;
- SVG;
- HTML entities and template text;
- SQL text.

### Part 3: reflected markup and injection

- **The API.** Every operation in the contract is sent hostile text in its path parameters, its query
  and its body. Each answer is JSON or empty, never HTML, and carries `nosniff`. A private answer is
  also `no-store`.
- **A fix.** The API's security headers move ahead of reading the body, so that every answer carries
  them, including the 400 for a malformed body.
- **The web app.** The pages the server draws that read a query, the library's search and the
  services page's category, are fetched with hostile values. The HTML holds them only escaped, and a
  browser that loads them runs nothing.
- **Injection.** SQL text and wildcards saved through the API come back byte for byte. A search for
  `%`, `_` or `\`, or for SQL text, finds only what holds that text.

### Part 4: rules against raw HTML and SQL text

- **The linter.** `.oxlintrc.json` turns on `react/no-danger` and `react/no-danger-with-children`,
  with the reason beside them.
- **A repository rule, `raw-html`.** In product code, the run fails on assigning `innerHTML` or
  `outerHTML`, on calling `insertAdjacentHTML`, `document.write` or `createContextualFragment`, and
  on a `srcdoc`. The API's PDF renderer, whose tests escape every text, is the one place allowed to
  hand a browser HTML (`setContent`).
- **A repository rule, `raw-sql`.** The run fails on `sql.raw`, and on a database query whose text is
  built while the program runs (a template with substitutions, or a joined string). The exceptions
  are reviewed entries, each with the reason its text cannot come from a request.

## What does not change

- **No CSRF token.** The origin and JSON checks already refuse a form from another site, and Part 1
  tests them on every change.
- **No HTML sanitiser**, as Valo has no rich text. A rich text field added later needs one, with tests
  of its own, and the raw-HTML rule makes that a reviewed change.
- **No content security policy on the API.** It answers JSON, and files sent as attachments.
- **Not an independent assessment.** None of this is one. The requirement's suggested owner is
  "Security / independent assessor".

## Slices

| Slice | What | Size | State |
| --- | --- | --- | --- |
| 1 | Part 1: every change from another site, and the preview files' checks that need no preview | M | Built |
| 2 | Part 2: stored markup, drawn on the customer's and staff's screens | M | Built |
| 3 | Parts 3 and 4: reflected markup, injection, the security headers fix and the two rules | M | Built |

## Settled while building it

- **Staff who hold the role.** The staff library checks the content role before it checks where a
  change comes from. So a member of staff without that role is refused by the role check, which
  refuses too. The test signs in a member of staff with every role but the reviewer's, which no one
  holds with the content role, who has just passed both sign-in factors. For every staff change,
  only the origin check then stands in the way. The reviewer's own routes check the origin first.
- **What the comparison leaves out.** It compares every table's rows but the security counts, which
  the refusals add to. The signed-out reads come after it, as each read counts against the reader's
  limit, which is saved.
- **The comparison can fail.** After it, the same kind of request from the site's own page saves a
  task, and the comparison sees the tasks table change.
- **The preview files stay.** They probe the real proxy and the development database's data, which CI
  cannot reach. The test inventory says which of their checks now run in CI.
- **Slice 2: a template's questions.** A template's form of its own (forms v2) needs the template's
  wording released for it, which a disposable database does not hold. The test starts the invoice's
  questions-only form instead, as the app's own button starts it, with the markup among its answers.
- **Slice 2: the staff roles.** The member of staff holds the content, support and privacy roles. The
  staff page opens on its Content area, whose requests are refused to staff without the content role,
  and every request a screen makes must be answered.
- **Slice 2: the check can fail.** After the screens, the same markup is put into a page as HTML on
  purpose. It runs and leaves its elements, and the check finds both.
- **Slice 3: a NUL character.** The reflection test found that a NUL character in a text made the
  server fail, with a 503, where it should refuse the detail: PostgreSQL cannot hold one in text. The
  check every body passes for its size and shape now refuses one, in a body's keys and texts, in the
  query and in the path, as the 422 the schemas give, naming where it was and never what.
- **Slice 3: two answers outside JSON.** Before the fix, an address the API does not have was answered
  with a page of HTML, and a malformed or oversized body's answer had no `nosniff` and could be framed.
  The headers are now set first, and an unknown address is answered in JSON. The test shows both
  failing without the fix.
- **Slice 3: the catalogue's search reads words.** It keeps letters and digits only, so punctuation alone
  is no search and lists everything, as an empty search does, and SQL text finds only what holds its
  words. The staff library's search runs in the database: the test loads the drafts kept in the
  repository, and each of `%`, `_`, `\` and SQL text finds only titles that hold it.
- **Slice 3: the site's own scripts.** On the pages the server draws, the check passes over the site's
  inline scripts, each of which carries the response's nonce. A payload's script carries none.
- **Slice 3: what the SQL rule reads.** It reads a query's own text: `sql.raw` of anything but a fixed
  string, and a query whose text is a template with substitutions or a joined string. Text built
  elsewhere and passed by name is not read. Its review lists 25 files and the 43 texts they build, none
  of them a customer's route: the AI ledger's checked schema name, the recovery tools' fixed tables,
  development databases with random names, and operator commands that apply committed migrations.
- **Slice 3: what the HTML rule reviews.** Two places hand a browser HTML: the PDF renderer, which
  escapes every text, and the reader of an official source's page, with scripts off and every request
  refused.

## The owner's points

1. **An independent assessor.** SEC-003's suggested owner is "Security / independent assessor", and its
   risk says passing builds and scans are not independent acceptance. Who assesses it, and when?
2. **Staging.** SEC-003 depends on a "staging environment". These tests run on a disposable database in
   CI, not on a staging site, which does not exist yet (the finishing plan's Phase 8).
