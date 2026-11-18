# 0011 — Server-render the public pages

Date: 2026-11-18. Status: **proposed**, waiting for the product owner's review. Nothing in it
is built.

## Context

The technical requirements choose Next.js for "Server-rendered public content, one same-origin
app/API and a typed codebase. Validate self-hosting." (VALO-TRD-001 v1.1). Their reference S14
asks to "Pin a supported version and validate proxy, caching and multi-instance behaviour."
NFR-002 asks for "Mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative supported
devices/connections."

No page is server-rendered today. One catch-all route (`artifacts/valo/app/[[...slug]]/page.tsx`)
returns a loading mark. The browser then downloads the app shell and the screen's own chunk, asks
the API for the page's data, and only then shows content. The server already writes each public
page's title and description (`generateMetadata`), but the body stays empty until the scripts run.

The NFR-002 lab check measured this in CI run 583, on commit `e22669b`. It runs on an emulated
Moto G4 with a four times slower processor, over slow 4G:

| Page | p75 LCP ms | p75 INP ms | p75 CLS |
| --- | ---: | ---: | ---: |
| /library | 2844 | 48 | 0.000 |
| /library/synthetic-template-1 | 3040 | 48 | 0.000 |
| /compliance | 2820 | 48 | 0.000 |
| /industries | 2832 | 48 | 0.000 |
| /services | 2820 | 40 | 0.000 |
| /pricing | 2640 | 40 | 0.000 |

- INP and CLS meet their targets. LCP misses on every page, so the LCP check is a todo test.
- Splitting the bundle (PR 51) took LCP from 3.5–3.7 s to 2.8–3.2 s in a local run.
- What remains is the time to download and run scripts before any content exists. Only content
  in the server's HTML removes it.

Server rendering must keep what the app guarantees today:

- Every response carries its own content security policy nonce, set by the middleware, with
  `'strict-dynamic'`. CI proves that injected scripts are blocked.
- Pages are `Cache-Control: private, no-store` and stay `noindex` while launch is not approved.
- Only the editorial gates decide what is public. Outside development the released-content reader
  returns nothing. Production mode serves only `/api/healthz` until a reviewed launch change exists.
- A withdrawal must reach readers at once. EDP-011's acceptance: "withdrawal reaches search,
  caches, downloads and checker".
- Only configuration chooses where the server fetches from, never a request's `Host` or
  `Forwarded` headers (`metadataOrigin`).
- The server never knows who the visitor is. The identity provider runs in the browser.

## Decision (proposed)

**1. Scope.** Server-render the pages anyone may read without signing in:

- the pages the metadata already lists as public (`publicPages` in `src/lib/public-metadata.ts`),
  except the checker;
- the library, resource and industry detail pages.

The checker depends on account state, so it stays in the browser. So do the workspace, account,
staff, AI, support, account-access, development and sign-in pages, unchanged.

**2. Each public page is its own Next.js route.**

- A server component fetches the page's data and renders its HTML.
- Small client components ("islands") add what needs the browser: the menu button, search and
  filters, save and download buttons, and the account link.
- The private app stays a browser-only single-page app behind the catch-all route, as today.
- Next.js serves a route that has its own folder before the catch-all, so pages can move one
  route at a time.
- Moving between a public page and the private app loads the new page in full.

**3. Data comes from the public API, without the visitor's identity.** The web server calls the
same public endpoints the browser calls, over HTTP, through one server-only module:

- The API's address comes from configuration: a new `VALO_API_INTERNAL_ORIGIN`, checked like
  `VALO_TRUSTED_ORIGIN`. Never from the request.
- It sends no cookies and no `Authorization` header. So a server-rendered page holds only what any
  anonymous visitor may see, and it is the same for every visitor.
- It never uses the browser client's module-level settings (`setBaseUrl`, `setAuthTokenGetter`).
  On a server, every request would share them.
- It checks every answer with the contract's Zod schemas (`@workspace/api-zod`), refuses
  redirects, caps the response size, and gives up after a short timeout (1.5 seconds proposed).
- When the API refuses, fails or times out, the page renders its unavailable or error state, and
  the browser island tries again.
- The metadata and the sitemap use the same module. Today they fetch discovery through the public
  origin.

Going through the API keeps one place that enforces the editorial gates, the production gate and
the rate limits. Reading the database from the web server would duplicate all three, and the web
app has never connected to the database.

**4. Rate limits count each visitor, not the web server.**

- The API limits anonymous reads per client address: 60 a minute (`requestReadQuota`).
- Server-side calls come from the web server, so on their own every visitor would share one budget.
- The fix:
  - The web server passes on the `X-Forwarded-For` it received, unchanged.
  - The API trusts the web server's exact address as one more proxy hop, through
    `VALO_TRUSTED_PROXY_CIDRS`.
- That is a configuration change. Like every proxy range today, it is made only after the deployed
  topology has been observed.
- Until then, server-rendered pages work but share one budget, so the launch checklist must
  confirm this setting.

**5. Nonces and caching.**

- Public routes render on every request (`dynamic = "force-dynamic"`).
- Next.js reads the nonce from the request's `Content-Security-Policy` header, which the
  middleware already sets. It puts the nonce on every script it writes, including the data it
  embeds for hydration.
- No page is generated ahead of time or kept in Next's route or data cache. Every server fetch
  uses `cache: "no-store"`. So a withdrawal is gone from the next page view on every instance.
- `Cache-Control`, `noindex` and the other headers stay as they are.
- A shared cache in front of the pages is a separate, later decision, because EDP-011 would then
  need it invalidated.

**6. Identity stays in the browser.**

- Public pages render the signed-out form of the account link.
- After the page is interactive, the account island loads the identity provider and updates the
  link for a signed-in visitor. Content never waits for it.
- Code that reads `window` when its module loads moves into the islands: the identity key worked
  out from the host name, and the logo address.

**7. The home page.**

- Today `/` shows the public home to signed-out visitors and sends signed-in visitors to
  `/workspace`. Telling them apart needs the identity provider's script.
- Proposed: server-render the public home for everyone, and keep sending signed-in visitors to the
  workspace once the identity provider loads. They see the public home for a moment first.
- The alternative is to leave `/` in the browser app.

## How it will be checked

- **Server HTML.** For each public route, a test fetches the HTML without a browser and finds the
  page's heading and content in it.
- **No visitor identity.**
  - The same routes, requested with a synthetic session cookie and `Authorization` header, return
    the same HTML as an anonymous request, apart from the nonce.
  - The synthetic API records that the web server sent it no cookie and no `Authorization` header,
    and passed `X-Forwarded-For` on unchanged.
- **Gates and failures.**
  - When the synthetic API answers like the production gate (not found), refuses (429) or does not
    answer, each page shows its unavailable or error state within the time limit.
  - An item the synthetic API stops listing is gone from the next page view (EDP-011).
- **Nonces.** The compiled-frontend security check also covers the server-rendered routes: a fresh
  nonce on every response, no script without it, and injected scripts blocked.
- **Hydration.** The browser checks fail on any hydration warning on a public route.
- **NFR-002.**
  - The lab check starts a synthetic API process. It gives the web server the same
    contract-checked data that the in-page routes already give the browser.
  - The LCP test stops being a todo test once it passes in hosted CI. Only then is it cited in
    `docs/registers/ci-evidence.json` for NFR-002.
  - A citation never accepts a requirement. Real-user measurements need a deployed instance.
- **Repository rule.** A rule keeps identity code and the browser client's settings out of the
  public routes' server code.

## Order of work

One pull request per step. Within each, moving code and changing behaviour stay in separate
commits.

1. The server-only API client with its tests, and the lab check's synthetic API process.
2. The public header and footer as server components, with the menu and account islands.
3. The pages with fixed content: about, help, contact, privacy and terms. Then pricing, which makes
   one API call.
4. The catalogue pages: the library and its detail page, resources, industries, compliance and
   services.
5. The home page, as the owner decides.
6. The LCP test becomes a normal test, and the browser app drops the public routes.

## Consequences

- Each public page view costs the web server one render and one to three API calls. Before
  launch, the NFR-003 load test should measure them, pointed at public pages.
- During the move a page can render two ways. The browser app's public screens are deleted as
  their routes land.
- Public pages ship less JavaScript, because content rendered on the server needs none. The lab
  check decides whether LCP meets 2.5 seconds; it is not assumed.
- Nothing needs spending, and nothing here launches anything. Pages stay `noindex`, and production
  still serves only `/api/healthz` until a reviewed launch change.

## Alternatives considered

- **Server-render the existing single-page app**, with wouter's server path and React Query's
  dehydration. Rejected, for three reasons:
  - Every screen, the private ones too, would become code that can run on the server.
  - The browser identity SDK, the browser reads at module load and the client's shared settings
    would all have to be made safe per request.
  - Public pages would still download the whole app shell.
- **Generate pages ahead of time, or regenerate them on a schedule.** Rejected: per-response nonces
  need rendering per request, and a stored page could outlive a withdrawal.
- **Read the database in the web server.** Rejected: it would duplicate the editorial gates, the
  production gate and the rate limits, and give the web app database credentials.
- **Keep rendering in the browser and trim more.** Splitting the bundle already did most of what
  trimming can do. The content would still wait for the scripts.

## Decisions for the product owner

1. Approve this approach, or choose another.
2. What signed-in visitors see on the home page (point 7).
3. Agree that `VALO_TRUSTED_PROXY_CIDRS` gains the web server's address once a deployed topology
   has been observed (point 4). This belongs with the hosting decision in record 0005.
