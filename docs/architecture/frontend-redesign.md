# Frontend redesign

Status: the plan was accepted by the product owner on 2026-11-20 ("Go with your recommendations",
in reply to the plan and its decisions). Nothing in it is built yet. Each phase lands as its own
pull requests, and this note records what was built as it lands.

## Why

The owner found the website, and the landing page most of all, hard to understand, and asked for a
major overhaul that takes Jakob Nielsen's ten usability heuristics into account.

## What the audit found

On 2026-11-20 the compiled web app was run against the tests' synthetic content. Sixteen public
pages and nine signed-in screens were captured on a desktop and a phone, and the landing page, the
library, a template page, the checker, the workspace home and the document editor were studied
against the ten heuristics.

The site is hard to understand because it describes itself instead of the visitor's task. The
visual identity (warm paper, forest green, a serif for headings) is sound.

| Finding | Evidence | Heuristic |
| --- | --- | --- |
| The first screen names nothing a visitor can do | The headline is "The documents you need. The business rules you should know."; no document or rule appears before scrolling | Match with the real world |
| The site leads with what it is not | 16 of the landing page's 38 sentences are caveats or negatives; the pricing page, 5 of 8 | Aesthetic and minimalist design |
| The words are the project's, not the customer's | "Shelf one", "business draft", "released template", "rev 3", raw labels such as "retail-wholesale" | Match with the real world |
| There are too many doors | 7 header links, four of which (Library, Resources, Industries, Compliance) open the same content; 17 footer links; signed in, 11 more tabs, with "Checker" in both rows; on a phone 3 of the 11 tabs fit | Consistency; recognition |
| Nothing real is shown | The only picture is grey bars captioned "Not a sample document" | Recognition rather than recall |
| The next step is unclear | The main button opens a sign-up form before any document is shown; the workspace home offers three ways to start a document | User control; consistency |
| Styles silently lose to each other | The hand-written `.btn` and `.field` styles sit outside Tailwind's layers, so they beat utility classes: the phone menu button shows on a desktop, and the search icon covers the search text | Consistency and standards |
| Dates and money are formatted in many places | Six places show a date in the browser's default locale and four others each set their own locale and style; money is formatted in three separate places | Consistency and standards |
| The workspace home is out of order | Its greeting and main actions sit under two other cards | Aesthetic and minimalist design |

What already works and stays: the editor shows "Saved", offers undo and keeps every version; the
checker accepts "I do not know"; pages say when they have nothing to show; accessibility and phone
speed are checked in CI.

## The target

### Landing page

In order:

1. A headline that says what a visitor can do: **"Make your business documents. Know which rules
   apply."**
2. Two buttons of equal weight, "Create a document" and "Check my requirements". WEB-001 requires
   documents and compliance guidance to be equally visible and one action away.
3. A realistic example of each: a document and a checker result, labelled as examples.
4. "What do you need to do today?": everyday tasks, each leading straight to the right document,
   and one tile for the checker.
5. "How it works": three steps for documents and three for requirements.
6. "Why you can rely on it": sources shown, documents private, gaps stated. One note carries "not
   legal, tax or accounting advice", "no regulator endorses it" and the AI-review disclosure.
7. A short list of questions and answers, and a closing pair of buttons.

### Navigation

- Public header: Documents, Check requirements, Guidance, Pricing, Help. No page is removed:
  WEB-002 requires the library, compliance, industries, resources, services, pricing, support and
  legal pages, and their addresses stay. Guidance groups the resources, industries and official
  sources pages.
- Public footer: about eleven links in three groups. The developer notes leave the customer footer.
- Workspace: five sections (home, documents, requirements, tasks, business profile) and an account
  menu for sign-in and security, privacy and purchases, in place of eleven tabs. On a phone, a
  bottom bar.

### Words

One plain word for each idea, the customer's word where there is one. The list below starts the
glossary; it grows as pages are rewritten.

| Say | Instead of |
| --- | --- |
| document | business draft, draft document |
| version 3 | rev 3 |
| documents | library, catalogue, shelf one |
| guidance, requirements | compliance guidance, shelf two, source-governed guidance |
| check my requirements | requirements checker, check rules |
| create account, sign in | open a workspace |
| not yet available | not released, held |
| saved results | assessment history, saved assessments |
| industry names as written ("Retail and wholesale") | slugs ("retail-wholesale") |
| amounts in naira ("₦1,500.00") | whole kobo |

Dates read "18 Nov 2026" and "18 Nov 2026, 09:00" everywhere.

### Look

The colours and typefaces stay. Headings get smaller and calmer, and each screen has one primary
action. The component styles move into Tailwind's component layer, so a utility class always wins
over a component default.

## Phases

1. **Foundations.** The component styles in their layer, which fixes the menu button and the search
   icon; one formatter for dates and money; the word list. Nothing else looks different.
2. **Menus and structure.** The new header and footer, and the workspace's sections and account
   menu.
3. **Landing page.** The page above, server-rendered, with its lists and counts read from live
   data.
4. **Public pages.** The documents list and document page (what it is for and a preview first; the
   source dates, disclosure, scope and limitations stay, below, in plain words), guidance, the
   checker, pricing and help.
5. **Sign-up and workspace.** A visitor who picks a task lands in that task after signing up. One
   "New document" entry. A calmer home screen and plainer editor labels.
6. **Messages, help and testing.** Every loading, empty and error state says what happened and what
   to do next. Then five business owners try the site, with made-up details, and what trips them
   up is fixed.

## What is built

### Phase 1: the component styles in their layer

The hand-written classes in `artifacts/valo/src/index.css` now sit in Tailwind's components layer,
so a utility class on the same element always wins. Only the page's own rules (`html`, `body`) and
the overrides of the identity provider's card stay outside the layers.

The plan said nothing else would look different. That was wrong. The two defects in the audit were
not alone: across the web app's 2,568 class attributes, a utility class was losing to a component
class in 41 places. In 40 of them the class now does what it says; the other is the first
exception below.

Screenshots of 22 public pages and 19 signed-in screens, on a desktop and a phone, were compared
pixel by pixel before and after. 51 of the 84 differ. One is a rendering flicker in the phone
header that also shows between two captures of the same build. The other 50 differ for these
reasons, and for no other:

| What changed | Where |
| --- | --- |
| The phone menu button no longer shows on a desktop | The header of every page (30 screens show only this) |
| The search text starts after the search icon, and the industry filter keeps its own width | Documents list |
| Message boxes start three to five lines tall instead of two | Contact, account access, the privacy request and a document's notes |
| The status list has one width, with slightly smaller text | Tasks |
| A hint sits a little further below what it explains | Document editor, reminders |
| The "Restore" button's text is slightly smaller | Document editor |
| The illustration has its larger shadow | Landing page |

These apply too, in states the screenshots do not show. They were found by reading the code:

- An error under a field is red, not grey: the contact, account access and service enquiry forms,
  and the privacy request.
- An amount field leaves room for its "kobo" label.
- A card responds to the pointer: on the landing page, the documents list, guidance, industries,
  saved assessments and the workspace's document rows.
- Staff and support message boxes are taller. The document preview has its larger shadow. The
  "Remove row" button has smaller text. The heading above the business-name fields has more space
  below it. The "New task from this item" panel has a green border.
- On a phone the workspace's document rows leave out the "N missing" pill, as their classes say,
  which gives the title room. The workspace phase puts the count on the row's second line.
- Buttons that set their own focus ring show it 2 pixels from the button, not 4: the filters on
  the documents list and the tasks screen, the staff areas and the editor's tabs.

Two things were changed by hand:

- The profile's save button lost its shadow class. Applied, it would have replaced the primary
  button's edge. The button looks as it did.
- The loading mark's animation is renamed `boot-pulse`. Tailwind's own `pulse` has the same name
  and had been replacing it, so the mark now pulses as it was written to.

Forty more classes carry `!` to force them past the component styles, such as `!px-2.5` and
`!text-destructive`. They are no longer needed and come out as each screen is rebuilt.

`artifacts/api-server/src/scripts/component-styles.test.ts` checks four things in a browser,
against the compiled app. All four fail on the stylesheet as it was:

- no class rule sits outside a layer;
- the header shows its links and no menu button on a desktop, and the reverse on a phone;
- the search text starts clear of its icon;
- an error under a field is in the error colour.

### Phase 1: one formatter for dates, times, amounts and counts

`artifacts/valo/src/lib/format.ts` now writes every date, time, amount and count the web app
shows. The specification asks for Lagos time, dates that cannot be misread and naira formatting
(NFR-008).

| It writes | As | Before |
| --- | --- | --- |
| A day | 18 Nov 2026 | "18 November 2026", "18/11/2026", "11/18/2026" or "2026-11-18", depending on the screen and the browser |
| A time | 18 Nov 2026, 09:00, on a Lagos clock | The viewer's own time zone on most screens, and the browser's own format in six places |
| An amount | ₦1,500.00 | "₦1,500.00" in three places and "NGN 1,500.00" in two |
| A count | 12,345 | The browser's own grouping |

A customer whose device is on Lagos time sees the same clock times as before, in one format. A
task's due date reads "1 Dec 2026" where it read "2026-12-01". A download's deadline reads
"25 Nov 2026, 10:00"; on the test machine, set to American English and UTC, it read
"11/25/2026, 9:00:00 AM".

The text is built from numbers, not from the browser's or the server's own words for a locale, so
a page the server renders shows the same text once it is in the browser.

Not changed:

- A template's own help text still says "100 kobo = NGN 1.00". It is part of the template and
  changes with the template's next version.
- The date boxes in forms are the browser's own, and show a date in the device's format.
- The developer notes page shows source-check times as they are recorded.
- Times carry no time zone label. The help page will say that the site's times are Lagos time
  (phase 6).

The `web-formatting` repository rule, part of the lint, fails any file of the web app that
formats a date or a number another way. On the code before this change it reports 18 places in 13
files.

### Phase 1: the word list

The word list is the table under [Words](#words). Each page takes its words as the page is
rewritten in the later phases. A check that the old words are gone comes with the last of them.

### Phase 2: the header, the footer and the phone's bar

| Part | Now | Before |
| --- | --- | --- |
| Header | Documents, Check requirements, Guidance, Pricing, Help | Checker, Library, Resources, Industries, Compliance, About, Help |
| Account buttons | Sign in, Create account | Sign in, Open a workspace |
| Footer | 11 links in three groups: Product, Help, Company | 17 links in three groups |
| Phone's bar | Create a document, Check requirements | Start a draft, Check rules |

- Every page marks the header section it belongs to. Guidance is marked on the overview, the
  guides and the industries pages, and on a guide's or an industry's own page.
- Guidance opens the overview (`/compliance`), which always has the official sources to show, even
  before any guide is published. Tabs above its heading join it to the guides (`/resources`) and to
  guidance by industry (`/industries`).
- No page is removed and no address changes. A page the footer no longer lists is linked from
  somewhere else: the guides and the industries from the guidance tabs, the support page from the
  help page, and the developer notes from the development banner.
- "Create account" also replaces "Open a workspace" in the sign-up page's title and on three
  buttons.

The pages' own headings and text still use the old words, such as "Compliance guidance" and
"Resources". The public pages phase rewrites them.

### Phase 2: the workspace's sections, its account menu and the phone's bar

The workspace had eleven tabs in one row, which ran off the side of a phone. It now has five
sections, and the pages about the account itself are in a menu of their own.

| Section | Opens | Tabs on its screens |
| --- | --- | --- |
| Home | `/workspace` | none |
| Documents | `/workspace/documents` | Your documents, Drafting assistant |
| Requirements | `/workspace/checker` | Check requirements, Saved results |
| Tasks | `/workspace/tasks` | Tasks, Reminders |
| Business profile | `/workspace/profile` | none |

- On a wide screen the header lists the five sections in place of the site's pages, then Help, the
  account menu and sign out. The account menu is a button with the person's initial. It lists
  Sign-in and security, Privacy and data, and Purchases, and those three screens show tabs of
  their own.
- On a phone a bar at the bottom lists the five sections, in place of the public pages' two
  buttons. The menu button opens help, the account's three pages and sign out. It does not list
  the site's pages, so "Documents" names one place on the screen; the footer still links to them.
- Every screen marks its section in the header and in the bar, and its page in the tabs. A screen
  opened from a page is marked with it: a document's editor with Documents, a saved result with
  Saved results.
- One list, `artifacts/valo/src/components/workspace-sections.ts`, feeds the header, the tabs and
  the bar. A test fails when the app has a workspace screen that is in no section and not among
  the account's pages.
- **Your documents** (`/workspace/documents`) is a new screen. It has every saved document, the
  files ready to download and the saved templates, which were all on the home screen. The home
  screen keeps the three documents saved most recently and a link to the rest.
- No address changes. Every address that opened a screen before still opens it.
- Outside the workspace a signed-in person keeps the site's header, with a Workspace button, the
  account menu and sign out. The phone's first button reads "Your documents" and opens that
  screen.

Not changed, and why:

- The screens' own headings and page titles still use the old words, such as "Saved assessments"
  and "History". The sign-up and workspace phase rewrites them.
- The home screen still has two ways to start a document and the documents screen repeats them.
  The same phase makes them one "New document" entry.
- A customer's support requests stay on the support page, which the workspace reaches through
  Help. The messages and help phase looks at a shorter way there.

What no browser test covers: the server-rendered pages signed in. The identity provider cannot
load in a test, so no browser sees them that way. A test draws their account links for a
synthetic signed-in visitor and checks what is drawn. How the account menu opens and closes is
checked on the same component in the browser app.

### Found on the way: keyboard focus rests clear of the bars

On a phone, pressing Tab could leave the focused control behind the bar fixed to the bottom of the
screen, and Shift+Tab could leave it behind the header. Before the fix this happened at 173 focus
stops across 36 of the screens the tests visit. WCAG 2.2 asks that a focused control is never
hidden this way (Focus Not Obscured, part of NFR-006).

The page now brings a focused control to rest clear of both bars, and of the business profile's
own Save button, which is held at the bottom of that screen. The keyboard checks that already ran
on every screen now also fail when a focused control comes to rest behind a bar that stays on
screen, going forward with Tab and back with Shift+Tab.

### Found on the way: the phone's opened menu fits the screen

The header stays at the top of the screen while the page scrolls. With the menu open the header
is as tall as its row and the menu together, and whatever part of the menu ran past the bottom of
the screen could not be scrolled to. On a phone held sideways (640 by 360 pixels) that was Help,
behind the bar at the bottom, and the account buttons below it, off the screen. An upright phone
was spared only because the menu was short.

The opened menu is now never taller than the room between the header's row and the bar at the
bottom of the screen. A longer menu scrolls inside itself, with a soft shadow along the edge it
continues past.

A new check opens the menu at 360 by 640, 320 by 480 and 640 by 360 pixels, signed out and signed
in, on server-rendered pages and in the browser app. It fails when a control in the menu comes to
rest off the screen or behind a bar. The keyboard checks that run on every screen now also fail
for a control left off the screen.

## How the ten heuristics are applied

1. **Visibility of system status.** Keep "Saved"; add progress in the checker and on downloads.
2. **Match with the real world.** The customer's words, naira and one date format.
3. **User control and freedom.** Undo and back everywhere; "Start over" asks first.
4. **Consistency and standards.** One set of components and one name for each thing.
5. **Error prevention.** Missing details are flagged before download; "Skip" is not pre-selected
   in the checker; destructive actions ask first.
6. **Recognition rather than recall.** Task tiles, recent documents and visible steps.
7. **Flexibility and efficiency.** "Make another like this", with saved business details filled in.
8. **Aesthetic and minimalist design.** Each caveat is said once, where it matters.
9. **Help users recover from errors.** Plain messages that include the fix, never a code.
10. **Help and documentation.** Questions and answers on the landing page, and short explanations
    beside terms such as TIN and CAC.

## Rules the redesign keeps

- Every claim on a page is true when it is shown. Lists and counts come from live data; examples
  are labelled; a page says so when nothing is published.
- No testimonials, customers, ratings or regulator endorsements (WEB-004).
- AI review is never described as legal, tax or regulatory review.
- No price and no "free" until the owner sets pricing.
- The accessibility checks (NFR-006), the phone speed check (NFR-002), the 360-pixel layout rule
  (NFR-007), the content security policy checks and the server-rendered public pages
  ([decision 0011](decisions/0011-server-rendered-public-pages.md)) keep passing. A test changes
  only where the screen it describes changes.
- Launch stays off. All of this is in the development build.

## Decisions

Accepted by the owner on 2026-11-20:

1. The direction of the mock-up shown with the plan: the landing page structure above.
2. The headline "Make your business documents. Know which rules apply."
3. The current colours and typefaces stay.
4. No price words until pricing is set.

Open:

5. Five small-business owners for the phase 6 test, about twenty minutes each, with made-up details
   only. The owner arranges them.
