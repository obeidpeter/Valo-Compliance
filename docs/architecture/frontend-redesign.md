# Frontend redesign

Status: the plan was accepted by the product owner on 2026-11-20 ("Go with your recommendations",
in reply to the plan and its decisions). Phases 1 to 5 are built, except the twelve forms' own
questions, which are frozen. Phase 6 is built except for testing with five business owners, which
waits for the owner. What is not done is listed under [Where it stands](#where-it-stands). Each
phase landed as its own pull requests, and this note records what was built.

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
| optional business documents | operational aids |

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
rewritten in the later phases. The check that the old words are gone came with the last of them,
in [phase 5](#phase-5-the-last-of-the-old-words-and-the-check-that-they-are-gone).

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

### Phase 3: the landing page

The home page is rebuilt to the mock-up the owner accepted: the headline, two buttons of equal
weight, an example of each, the everyday tasks, how it works, why it can be relied on, five
questions and answers, and a closing pair of buttons. The server renders all of it, and it adds
no script: the questions open and close as plain HTML.

What the page reads when it is shown:

- **The tasks.** Each of the eight is tied to documents the workspace's starter can start. A task
  leaves the page when the starter stops offering one of its documents, so the page never offers
  something Valo cannot make.
- **The count of ready-made templates.** It is the number the API gives. When the API cannot be
  read the line is left out, and the rest of the page still renders.

Where the built page differs from the mock-up in substance, and why. Each change keeps a claim
true of this build:

| Mock-up | Built | Why |
| --- | --- | --- |
| The requirement example named a real registration and a real authority, with a date it was checked | The example shows what a result holds: its name, why it may apply, its source and the date checked | Guidance is published only through its own checks. An example may not stand in for one |
| "Choose a task. We take you straight to it." | "Each of these is a document you can make once you have an account." | A task leads to sign-up, and the choice is not carried through it yet. The sign-up and workspace phase does that and restores the promise |
| "Set a date and get a reminder." | "Add a date, and tick it off when it is done." | Reminder emails are not sent in this build |
| "Only you can see them." | "They are kept in your own workspace", and "other customers cannot see them" | It is what the workspace's isolation is tested to do |
| "Guidance is checked by AI against official sources, not by a lawyer." | "Templates and guidance are drafted and reviewed by AI, not by a Nigerian legal, tax or sector specialist." | The disclosure EDP-008 requires, in its own terms |
| Amounts such as "₦15,000" | "₦15,000.00" | The example is written by the same formatter as every real document |

A few other phrases were tightened the same way: a result "names" its source, and the reminder
letter and the non-disclosure agreement go by the names the workspace gives them.

The old page's "Why two shelves" and "Before you begin" blocks are gone. What they said is in
"Why you can rely on it", its "Good to know" note and the development banner. The note still
sets a customer's own draft apart from Valo's templates and guidance, as EDP-008 asks.

On a phone the two buttons come after the headline and its opening sentence, below the first
screen on a short phone. The bar at the bottom of the screen offers both from the start.

### Phase 4: the documents list and the document page

**The list** (`/library`, which the header calls Documents):

- Its heading is "Documents and guidance", and its opening sentence says what the search covers.
- A result names its kind in words (Template, Guidance, Article, Industry page, Service enquiry)
  and its industries by name. It showed the catalogue's short codes, such as `template` and
  `retail-wholesale`. More than two industries are counted, and a code with no name is left out.
- The count of results is written by the shared formatter, with the page number when there is
  more than one page.
- With nothing to show, the page offers "Create a document" and says in plain words what is and
  is not searched.

**The document page** (`/library/<slug>`):

- What the template is for and its preview come first. The dates its sources were checked, how
  it was written and checked, what it covers and its limits follow, under plain headings. Every
  one of them is still on the page, and the disclosure is still the release's own text (EDP-008).
- The button reads "Make my own copy", and the blank files are "Blank Word file" and "Blank PDF".
- The "Not for sale" note no longer adds that use is free.
- One sentence still says "drafts": "Drafts you already created stay in your workspace." A test
  for EDT-010 holds that sentence, so it changes in the workspace phase, where the word is
  replaced everywhere at once.

**Kept, and why.** The list keeps its Access filter with "Free" and "Premium templates", and a
result still shows which it is. DOC-002 requires free and premium filters, so the rule against
price words does not reach them. The owner decides whether that changes while no price is set;
it would be a change to the requirement, not to this page.

### Phase 4: the guidance pages

The three pages the header's Guidance link groups, and the page of a guide and of an industry:

| Page | Heading now | Heading before |
| --- | --- | --- |
| Overview (`/compliance`) | Guidance, and where it comes from | No rule is shown until it can name its source. |
| Guides (`/resources`) | Guides | Guidance that names its sources. |
| By industry (`/industries`) | Guidance by industry | Find what fits your trade. |

- The browser tab of each page now carries the same name as its heading: "Guidance", "Guides"
  and "Guidance by industry", and "Documents and guidance" for the documents list. They read
  "Business requirements", "Business resources", "Industry coverage" and "Document library".
- Every button to the requirements check reads "Check my requirements". They read "Run the
  requirements checker".
- A page with nothing to show says "No guidance is published yet", or "No guides are published
  yet", and says in plain words what a visitor can still do.
- A guide's date reads "Sources checked", on its card and on its page, as a template's does. It
  read "Reviewed", which could be taken for a person's review (CMP-004). Its notices have the
  same plain headings as a template's.
- An industry is named the same way on every page: as the list of industries writes it, starting
  with a capital, in the heading, the browser tab, the search results and the filter. The name
  itself comes from the coverage plan and is not changed.
- Counts are written by the shared formatter, as "3 guides".

### Phase 4: the requirements check

The page behind "Check requirements" and "Check my requirements" (`/checker`, and
`/workspace/checker` signed in). Its heading and its browser tab read "Check your requirements".
They read "What might apply to your business, and why." and "Business requirements checker".

**Nothing is chosen for the visitor.** Every question opened with "Skip for now" showing as
chosen, so a page nobody had touched looked answered. A question now shows no choice until the
visitor makes one.

- "I do not know", "Skip for now" and "Not applicable" are still three separate answers, and none
  of them is a "No" or a zero (RUL-002). What is sent for them has not changed: a question nobody
  touched and a question skipped both go as unanswered.
- A question answered in a box shows the box at once, with those choices beside it after "or".
  It showed a choice called "I can answer" first, and choosing that put a 0 in the number of
  people, or last year in the turnover year, before anything was typed. An emptied box is
  untouched again.
- The state is chosen from a list that opens on "Choose a state or the FCT".
- A step is ticked in the list of steps once every question it asks has been dealt with. It was
  ticked as soon as the visitor had gone past it.

**Questions that do not apply are skipped (RUL-001).** When the visitor says turnover does not
apply, the seven questions about the figure are not asked, as the local government area already
was not for a business with no premises. Their answers are sent as "not applicable" and no exact
figure is sent. The rule engine already left those questions out of what is still unanswered.

**Asked first.** "Start over" asks before it clears answers the visitor gave, and has nothing to
do on a fresh page. Signed in, "Fill in from my business profile" asks before it replaces answers
the visitor gave on the page, and says when it has filled them in.

**Words.**

| Now | Before |
| --- | --- |
| Your business, What it does, Where it is, Size and turnover, Personal data, Review your answers | Business, Activities, Location, Size and turnover, Data, Review |
| Is it registered with the Corporate Affairs Commission (CAC)? | Is it registered with the CAC? |
| Roughly, what is the business's turnover? | Turnover band |
| Under ₦5 million | Under N5m |
| The exact figure, if you have it (optional). In naira. | Exact turnover in naira (optional). Stored as whole kobo. |
| Which year is that figure for? What period does the figure cover? | Turnover year. Period. |
| What does the figure measure? Which currency is the figure in? | Measured as. Currency. |
| Fill in from my business profile | Prefill from my profile (rev 3) |
| Check my requirements | Check these answers |
| You are not signed in. Your answers are not saved, and leaving this page clears them. | Anonymous. Answers stay in this tab only and are never saved. |

- The note under a signed-out visitor's results now says that the answers on the page are not
  carried over to a new account. That was already so, and was not said.
- An answer of "I do not know" reads back in those words, on the review and in saved results. It
  read "Unknown".
- The business profile names the turnover bands the same way, from the same list.

**Not changed.** The optional detail sections keep their wording, which was written with the
rules they feed. So do the results: the four result labels (CMP-002), "Why am I seeing this?"
(RUL-004), the coverage gaps and the official routes. The panel that saves a result to the
workspace is rewritten with the workspace, in phase 5, where "assessment" and "revision" change
everywhere at once.

**Found on the way.**

- The review's list of answers failed an accessibility rule: each "Edit" button sat directly in
  a list of terms, which may hold only terms and their descriptions. The checks had looked at the
  first step only. A new check runs on every step, the review, the results and the "Start over"
  dialog.
- The business profile's "Save before leaving?" dialog opened in the top left corner of the
  screen, and on a phone it filled the width edge to edge. Tailwind's reset removes the margin
  that centres a dialog. One rule now puts every dialog in the middle of the screen, clear of a
  phone's sides. A check measures this page's dialog and the profile's, on a phone and on a
  desktop. The app's four other dialogs get the same rule and are not measured.

### Phase 4: pricing, help and the pages about Valo

The last of the public pages. Each is headed with the name its links give it.

| Page | Heading now | Heading before |
| --- | --- | --- |
| Help (`/help`) | Questions and answers | Straight answers |
| Contact (`/contact`) | Contact us | Write to the people building Valo. |
| Report a problem (`/support`) | Report a problem | Tell us what went wrong. |
| Trouble signing in (`/account-access`) | Trouble signing in | Cannot get in? Start here. |
| About (`/about`) | Documents and guidance for Nigerian small businesses | Two shelves, kept apart on purpose. |
| Services (`/services`) | Ask about a service | Need a person, not a page? |

- The browser tabs follow: "Contact us", "Report a problem", "Trouble signing in" and "Ask about a
  service". They read "Contact Valo", "Support", "Account access help" and "Service enquiries".
- These pages' links to each other use those names, and so do the sign-in page and the error
  screens, which said "Get account access help" and "Account access help". The reminders screen
  still says "Contact support"; it changes with the workspace.
- **Help.** The eight answers use the site's words. Two were out of date:
  - Where to get a copy of your data. The answer said "Workspace, then Privacy", which the
    workspace's sections replaced. It now says "Privacy and data", in the account menu.
  - How to download a document. The answer named an "Export" control the editor does not have. It
    now says where the Word and PDF files are made.
- **About.** "What works today" is in plain words, and says that the drafting assistant is AI
  and runs only when asked for and agreed to.
- **Pricing.** The page still opens on "Prices have not been set". The disabled "Checkout
  unavailable" button is gone; the page says that payments are switched off.

**Kept, and why.**

- Services keeps the sentence "No professional providers are listed yet, so nothing is booked or
  forwarded." A test for SRV-001 holds it.
- About keeps its list headed "What Valo is not". The check that the site shows no endorsement
  (WEB-004) reads that list by its heading.
- The privacy and terms pages keep their words. They are working notes that the owner and legal
  advisers have not approved, and say so. Only a doubled word is corrected.
- The forms on these pages are rewritten with the other messages, in phase 6.

### Phase 5: one place to start a document, and a calmer home

**One place.** A document now starts on one page, "New document" (`/workspace/documents/new`).
It shows the twelve everyday documents, each with a line saying what it is for, and each a button
that starts it. Below them are a blank document and the drafting assistant.

The home screen had three ways to start a document and the documents screen two: a list to pick
a document's questions from, "Prepare invoice or quotation" and "New blank draft". Each screen now
has one button, "New document", which opens that page. With nothing saved yet, the empty list
carries the button instead, so a screen never shows two.

**The home.** The greeting and its button come first. Then anything that needs a look, the
documents last worked on, the way into the requirements check and saved results, and the
business profile. The home had no way into the requirements check before.

| On the home | Now | Before |
| --- | --- | --- |
| First thing on the screen | The greeting and "New document" | A card headed "Prepare a structured private draft" |
| Documents | "Recent documents", three of them, and "All documents" | "Business drafts" |
| Requirements | A card with "Check requirements" and "Saved results" | Not on the home |
| Business profile | Its name and four lines | The same, with "rev 3" in the corner |

**Changed since.** A document's row read "Business draft" and "rev 3", and a new document was
titled "private business draft". Those words changed with the editor's, described
[below](#phase-5-the-document-editor-in-plain-words).

**Found on the way: the phone's menu closes when focus moves on.** With the menu open, Tab went
on from its last link to the page behind it, where the control that took the focus lay hidden
under the menu. The new home put its first button exactly there, and a check that already ran
reported it. The menu now closes when keyboard focus moves on from the header, on
server-rendered pages and in the browser app.

Two scripts that need a verified test account, and so run in no CI job, start their documents on
the new page. They were updated and not run.

### Phase 5: a task chosen on the landing page is carried through sign-up

A visitor who picks a task on the landing page now starts on it once they have an account.

- Each of the eight tasks leads to sign-up with the task on the address, as
  `/sign-up?start=invoice`. "Create a document" does the same with `start=document`, on the
  landing page, on the phone's bar and on an empty documents list.
- The sign-up page hands the identity provider's form the page to go to afterwards: "New
  document", with the task. Its link to the sign-in form keeps the choice, and the sign-in page
  does the same the other way.
- "New document" then shows the chosen task first, under "You chose", with its one, two or three
  documents as buttons, and the full list below.
- Only the site's own choices are passed on. A made-up value, such as another site's address, is
  handed to nobody and the page opens as usual.
- The landing page's sentence over its tasks reads "Choose one. After you create your account,
  you start on it." It read "Each of these is a document you can make once you have an account."
- The sign-up card is headed "Create your account". It read "Open your workspace".

**What is and is not checked.** The identity provider cannot load in a test. The checks use
stand-ins for its forms that show what the app hands them: where to go afterwards and the other
form's address. That covers the app's side. The provider's own redirect after a real sign-up is
documented in its library and is not exercised here.

**Where the choice is lost.** It is kept while the sign-up page stays open, through the
provider's own steps. Reloading the page part-way, or finishing sign-up in another tab, loses it,
and the visitor then starts on the workspace's home, where "New document" is one press away.

### Phase 5: the document editor in plain words

The editor and the documents list now say what they mean in the customer's words. How a document
is saved, checked and downloaded is unchanged.

| Where | Now | Before |
| --- | --- | --- |
| A document's row in the list | "Draft", "Version 3", "Saved 19 Nov 2026, 10:00" | "Business draft", "rev 3" |
| A new document's title | The kind's name, such as "Invoice"; a blank one is "Untitled document" | "Invoice — private business draft"; "Untitled business draft" |
| The way back | "Your documents", to the documents list | "Workspace", to the home |
| Where the document stands | One "Draft" mark and "Your own document: not a Valo template, and not reviewed." | Three marks: "Business draft", "Not a released template", "Not reviewed" |
| Saved state | "Saved · version 3" | "Saved · rev 3" |
| The two views | "Edit" and "Preview" | "Edit" and "Saved preview" |
| What is missing | "Still needed", each question by its own name | "Missing details", each line ending "This answer is required." |
| Earlier saves | "Versions", "Version 3" | "Revisions", "rev 3" |
| Files | "Download this document", "Make a Word file", "Make a PDF file", "PDF · version 3 · ready", "13 KB" | "Private exports · development only", "Create DOCX draft", "Revision 3 · PDF · ready", "Attempts: 1 · 12,345 bytes" |
| A file that was not made | A sentence for each of the three reasons a customer can act on, and a reference to quote for any other | The failure's code alone |
| The questions | "Questions", "Row 1", "Add a row" | "Guided form · TPL-01", "Goods, work and agreed charges · row 1", "Add goods, work and agreed charges row" |
| The document's own text | "Text and tables", "Add a paragraph", "Lettering", "Colour" | "Body", "Paragraph", "Typeface", "Accent" |

**Kept on purpose.**

- A draft status stays in the list, in the editor and under the preview. EDT-003 asks for "a clear
  draft status".
- A file is still made only after the customer ticks a box that asks for a draft copy (EDT-005).
  The box now reads "I want a draft copy: marked as a draft on every page, with any missing details
  left as they are."
- A document's title is printed as its heading. That is why a new invoice now starts as "Invoice"
  and not as "Invoice — private business draft".
- What the editor says a document is not (a Valo template, reviewed, proof of payment, a
  government tax invoice, professionally reviewed) is all still said, in fewer words.

**Moved, not removed.** The panel and the documents screen each carried a sentence for developers:
that the approval of downloads for production and their disaster recovery are still unproved.
It is now on the developer notes page. The banner on every page still says that the build is not
launched and takes made-up details only.

**Found on the way.** The list of what is missing named a table's unanswered cells by an internal
key ("items:0:description: This answer is required."). Each now reads by the table's, the row's
and the column's names: "Goods, work and agreed charges, row 1: Description".

**Not changed, and why.**

- The questions themselves ("Issuing business legal name", "Goods/work supplied and agreed
  billing basis") and the notice over each form come from the frozen question definitions.
  Rewording them changes the twelve forms, not the editor, and waits for the owner's decision.
- Amounts in the questions were still typed in kobo. That changed in a step of its own,
  [below](#phase-5-amounts-are-typed-listed-and-printed-in-naira).
- A downloaded file still prints "Saved revision 3". The words inside a file are the API's.
- The sentences a wording check pins keep the word "drafts", such as "Drafts you already created
  stay in your workspace."
- The drafting assistant's screens keep their words until their own step.

Four scripts that need a verified test account, and so run in no CI job, name the editor's
buttons and tabs. They were updated and not run.

### Phase 5: a new form opens without red marks

A document started from its questions opened with every required question outlined in red and
"This answer is required." under each one. A new invoice showed thirteen of these messages before
the customer had typed anything.

- A required question nobody has answered is now marked "Still needed", in amber beside its
  name. The mark goes when the question is answered.
- The question is outlined in red, with "This answer is required.", only once the customer has
  been to it and left it empty.
- A wrong answer is marked at once, while the customer is still in the question, as before.
- The list beside the form still names every unanswered question, and the count over the form is
  unchanged.

The business profile and the support forms already show no mistake until the customer has used
the form. EDT-005 asks to "highlight unresolved fields": each one is still highlighted, in the
form and in the list.

### Phase 5: amounts are typed, listed and printed in naira

A question about money asked for whole kobo. To enter ₦1,500.50 a customer had to type 150050.
The amounts panel of a blank document already took naira, so two parts of the same editor
disagreed.

- **Typed.** A money question takes naira, with or without separators and kobo: "1500" or
  "1,500.50". A naira sign stands in the box, and the amount is read back under it: "Reads as
  ₦1,500.50".
- **Stored.** The answer is still stored as whole kobo, worked out from the digits alone. Nothing
  is rounded. The saved document, its checks and its totals are as before.
- **Refused.** What is not an amount, such as "12.5x", stays in the box as typed, is saved as
  typed, and is refused with "Enter an amount in naira, such as 1500 or 1500.50."
- **Asked and listed.** The question reads "Unit price in naira, for the chosen quantity unit",
  in the form and under "Still needed". The frozen question definitions still say "in whole
  kobo"; only what the editor shows changes.
- **Printed.** A document printed "Agreed fee in whole kobo" over "₦1,500.00 (150000 kobo
  entered)", and headed a column "Unit price in NGN displayed from supplied kobo". It now prints
  "Agreed fee" over "₦1,500.00", and "Unit price, for the chosen quantity unit". The preview, the
  Word file and the PDF share this one projection of the saved answers.
- **Files.** A saved version now prints differently, so the render version is raised. A file
  asked for again is made afresh, not handed back as it was first made.
- The amounts panel's labels say "(₦)" where they said "(NGN)", and the drafting assistant says
  totals are worked out "to the exact kobo".

**Kept.** Everything that is not an amount is still stored exactly as typed. Digits too long to
be an amount in naira (more than 22 before the point) are stored as naira and refused, so they
can never be read as a smaller amount in kobo.

**Not changed.** The purchases screen ("Refund amount in NGN") and the finance staff screens keep
their labels until their own step.

One script that needs a verified test account, and so runs in no CI job, types amounts into the
questions. It now types naira. It was updated and not run.

### Phase 5: saved results, the profile and tasks in the customer's words

The workspace called a saved result an "assessment", a version a "revision" or "rev", and the
check "the checker". The word list's words replace them. No address changes: saved results are
still at `/workspace/assessments`.

| Where | Now | Before |
| --- | --- | --- |
| Saved results list | "Saved results", under "Requirements" | "History", under "Saved assessments" |
| A result's row | "Rules as at 18 Nov 2026", "Rules version …", "From your profile, version 3" or "From the answers you gave" | "as of 18 Nov 2026", "ruleset …", "profile rev 3" or "questionnaire snapshot" |
| An empty list | "No saved results yet", with "Check my requirements" | "No saved checks yet", with "Run the checker" |
| One saved result | "Result saved 18 Nov 2026, 10:00" and "Worked out from your business profile, version 3." | "Assessment of 18 Nov 2026, 10:00" and "From saved profile revision 3" |
| Its comparison | "Earlier result", "No other saved results" | "Earlier assessment", "No other assessments" |
| Page titles | "Saved results", "Saved result" | "Assessment history", "Assessment" |
| The check's save panel | "Save this result", "With the answers I gave here", "With my business profile, version 3" | "Save to your workspace", "These questionnaire answers", "My saved profile, revision 3", "Save assessment" |
| Business profile | "Version 3", "Save profile", and "I do not know" and "Not answered" as the check says them | "revision 3", "Save new revision", "Unknown" and "Not answered yet" |
| Tasks | "Version 1 · saved 12 Nov 2026, 10:00", "From a saved result" | "rev 1 · 12 Nov 2026, 10:00", "rule SYNTHETIC-RULE-1" |
| Reminders | No version beside "Preferences" | "rev 3" |

**Kept on purpose.**

- A result is still saved only after the customer ticks a box. It now reads "I agree to Valo
  storing this result privately in my workspace."
- Each saved result still names the version of the rules it used, so two results can be told
  apart (CMP-005).
- What the save panel says happens is what happened before: the profile is not changed, the
  extra details are left out when the profile is used, and nothing is saved if the profile has
  changed.

**Not changed, and why.**

- The result itself, as it reads after a check and in a saved result, still said "As of",
  "Ruleset", "hash" and "Coverage unavailable". The public check shows the same result, so it
  changed in a step of its own, [below](#phase-5-a-result-in-the-customers-words).
- The account screen's paragraph about the copy of your data, and the reminders' words about
  what an email provider accepted, are exact statements that checks pin. They wait for the
  review of the privacy pages and for phase 6.
- The drafting assistant's screens, and the API's own messages, keep their words.

One script that needs a verified test account, and so runs in no CI job, reads the profile's
version. It was updated and not run.

### Phase 5: a result in the customer's words

A result is shown after a check, to a visitor and to a signed-in customer, and again inside a
saved result. It is one component, so these words change in all three places.

| Where | Now | Before |
| --- | --- | --- |
| What a result was worked out from | "Rules as at 18 Nov 2026", "Rules version …", "1 result with a source", "Reference cccccccccccc" | "As of 18 Nov 2026", "Ruleset …", "1 source-backed", "hash cccccccccccc" |
| No rule matched | "Nothing to show yet", "No published rule covers these answers yet." | "Coverage unavailable", "No released rules cover these answers yet." |
| What that means | "This does not mean that you are exempt from anything." | "This is not a finding that you are exempt from anything." |
| Where a requirement applies, and its rule | "Federal · Rule SYNTHETIC-RULE-1, version 1"; "State: Lagos"; "Local government: Ikeja, Lagos" | "FEDERAL · SYNTHETIC-RULE-1 V1", in capitals; "state / Lagos" |
| The question a rule checked | "The question checked:" | "Question assessed:" |
| What is not covered | "What Valo does not cover yet" | "Known coverage gaps" |
| Official links | "Official sources" | "Official routes" |

**Kept on purpose.** The four labels a result can carry ("Likely relevant", "May apply", "More
information needed", "Not indicated by these answers") are CMP-002's own words. "Why am I seeing
this?" is RUL-004's. Each requirement still shows its rule and version, where it applies, its
sources and its next step, and a result still shows no score.

The check's optional name details said "a private assessment is stored only when you explicitly
agree to save it". It now says "the result is stored, privately, only when you explicitly agree
to save it".

### Phase 5: "Make another like this", and one door to a new document

**Make another like this.** A business that sends an invoice every week started each one from
empty questions. The editor now has a card, "Make another", with one button.

- It starts a new document with the saved one's details and opens it.
- Its reference and its dates are left blank, so the new document gets its own. Everything else is
  kept as it was saved. Nothing is filled in or invented.
- The saved document is not changed.
- It waits while the editor has changes it has not saved, and says "Save your changes first."
- The new document says what it still needs, as any document does.
- No copy is offered of a document whose saved questions cannot be read.

**One door.** "Create a document" on an industry's page and on the guides page led to the
workspace. That sent a signed-out visitor to sign-in and forgot why they came. Both now lead
through sign-up with the choice kept, as the landing page's and the documents search's links
already did.

**A signed-in visitor is sent on.** The sign-up and sign-in pages now send a visitor who is
already signed in to where the form would have sent them: "New document" for what they chose,
otherwise their workspace. Until now this was left to the identity provider's form, which no
test can load. It is now the app's own code and is tested with the stand-in identity.

### Phase 5: the last of the old words, and the check that they are gone

**The last of them.**

| Where | Now | Before |
| --- | --- | --- |
| Drafting assistant, saving | "Save to your documents", "Save to my documents", "It is my own document, not legal, tax or accounting advice, and not approved by anyone." | "Save to your drafts", "Save as business draft", "It is my business draft, …" |
| Drafting assistant, once saved | "Already saved to your documents", "Open the document" | "Already saved as a business draft", "Open draft and exports" |
| A page the site does not have | "This page does not exist." | "This page is not on either shelf." |
| Help | 'It is marked "Draft"', "make a Word file or a PDF" | 'It is labelled "business draft"', "create a Word or PDF file" |
| Sign-in and security | "documents, saved results, tasks or requests" | "drafts, assessments, tasks or requests" |
| The copy of your data | "documents and their versions, saved results" | "drafts and revisions, assessments" |
| The site's default description | "Business documents and source-backed guidance for Nigerian small businesses." | "your business drafts kept separate from source-governed compliance guidance" |

In the paragraph about the copy of your data, only those names change. What the copy holds and
what it leaves out read as before.

**The check.** One list holds the old words: the "Instead of" column of the table under
[Words](#words). Three tests read what a person sees and fail on any of them:

- every signed-in customer screen;
- every public page, where an industry must also be named as it is written and never by its
  address name;
- the signed-out screens, with the page the site does not have among them.

A document's status is still "Draft" and a version is still a version: the check refuses only
the old phrasings. Staff screens and the developer notes are tools, not customer screens, and
are not checked.

**What the check cannot see.** It reads each screen as it opens with the tests' synthetic data.
Words that appear only in a state it does not open, such as an error message or a dialog, are
not read. Phase 6 goes through those messages.

### Phase 6: asking before something is discarded

Five places asked a question in the browser's own box. Its buttons read "OK" and "Cancel" and
say nothing of what happens next.

| Where | The question | Keep | Go ahead |
| --- | --- | --- | --- |
| Editor, Undo, with amounts not applied | "Undo, and discard the amounts you have not applied?" | "Keep them" | "Discard them and undo" |
| Editor, restoring a version, with unsaved changes | "Restore version 2?" | "Keep my changes" | "Replace them with version 2" |
| Editor, after a change somewhere else | "Discard what you typed here?" | "Keep what I typed" | "Discard mine and load the newest" |
| Editor, resetting the amounts | "Discard the amounts you have not applied?" | "Keep them" | "Discard them" |
| Tasks, choosing a view while editing a task | "Leave your task edits?" | "Stay and save them" | "Discard them and change view" |

Each now asks in the app's own dialog, as the requirements check and the business profile
already did. The heading names what would be lost. The button that keeps it comes first and
takes the focus, and Escape does the same. The second button says what going ahead does.

No new question is asked: each of these was asked before, in the browser's box. One is asked
less often: the keyboard's undo no longer asks about unapplied amounts when there is nothing to
undo. The staff privacy screen keeps the browser's box, as a staff tool.

The browser's box stopped the page while it was open. The app's dialog does not. So while the
editor asks, its autosave waits, and so do the keyboard's save and undo: otherwise a save could be
on its way when the customer chose, and the choice would do nothing. The answer starts the autosave
again, so text that was waiting is saved as it would have been.

Two scripts that need a verified test account, and so run in no CI job, answered the browser's
box. They now press the dialog's buttons. They were updated and not run.

Found on the way: "Save before leaving?" did not catch the browser's Back button. That is the
next section.

### Phase 6: the browser's Back button asks too

"Save before leaving?" caught a link and the app's own buttons. It never caught the browser's Back
or Forward button. A screen with unsaved work on it was taken away without a question, and what
was typed and not saved was lost. Every screen that uses the guard was affected: the document
editor, the business profile, the tasks, a customer's support and privacy requests, and the staff
screens.

Why: on the window, listeners are called in the order they were added. The router's was added
first. It re-rendered before the next listener was called, so the screen was gone, and its guard
with it, before the guard was asked.

Now one listener is added as the app starts, before the router's. It asks the open screens'
guards. If one has unsaved work, the address is put back, the router hears nothing, and the screen
asks "Save before leaving?". Staying keeps everything. Leaving goes where Back was going. A move
that changes only the part of the address after `#` is not a move away, and is let through.

A question of the screen's own that is still open is answered by keeping, because leaving asks
about everything that is not saved. Without this, the editor's "Save and leave" would wait on a
question the customer could no longer reach.

What is checked, and what is not:

- A test in the bundled app covers the editor, the business profile and the tasks: Back asks,
  staying keeps what was typed, "Discard and leave" sends nothing and goes back, and "Save and
  leave" saves the typed amount and goes back, also when a question of the editor's own was open.
- The other screens use the same guard and are not each tested.
- The compiled site adds Next.js's own router, which also listens for Back, and no test can sign
  in to it. It was checked once by hand, with a temporary guard on a signed-out screen: with this
  change Back asked and the screen stayed, and without it Back left without asking. That temporary
  change is not in the repository.
- Closing the tab or reloading still shows the browser's own warning, as before.

### Phase 6: the reminders in plain words

The reminders screen spoke in the words of the system that sends email. It now says the same
things in the customer's words.

| Before | Now |
| --- | --- |
| "Development-only delivery: sending stays off unless an approved sender and the specifically authorized verified owner recipient are configured. Provider acceptance is not inbox delivery." and "Delivery not available", with a note written for operators | "Reminder emails are not being sent yet", with "You can save your choices now. Nothing is sent, and each reminder stays on hold, until sending is switched on." |
| "Delivery available" | "Test emails only", with "Valo is still being built. A reminder is sent only as a test, to the workspace owner's verified email address." |
| "Remind me about due tasks", "Opt-in. You can turn this off at any time." | "Send email reminders before a task is due", "Off unless you turn it on. You can turn it off at any time." |
| "When (choose 1 to 4)" | "How long before the due date (choose up to 4)" |
| "Times use Africa/Lagos." | "Each reminder is planned for 09:00, Lagos time." |
| "Held", "Pending", "Accepted by provider" | "On hold", "Scheduled", "Accepted by email service" |
| "scheduled 25 Nov 2026, 10:00", in the typeface kept for codes | "Planned for 25 Nov 2026, 10:00" |
| "Attempts: 2 · Last attempt …", "Retry after … if reminders are still enabled." | "Tried 2 times. Last tried …", "Valo tries again after …, if reminders are still on." |
| "Actual status, from the server" | "What has happened to each reminder" |
| "Contact support", leading to the help page | "Report a problem", leading to the form |

What is kept:

- "Delivery log", the requirement's own name for it (WRK-003).
- The difference between the email service accepting a message and the message reaching an inbox.
  No label says "sent" or "delivered". An accepted message reads "The email service accepted this
  message. That does not show it reached your inbox."
- Every reason the server records has a sentence. They are in `lib/reminder-words.ts`.

Corrected on the way:

- A cancelled reminder of an archived task had no sentence of its own, and read "This reminder is
  paused. Contact support for details." It now reads "The task was archived." A reason the screen
  does not know says only what the reminder's state means.
- The hour is stated. It is the hour the server plans every reminder for.
- On a phone the log's heading broke over two lines, and a long task title was cut off. The
  heading's caption now goes under it, and a title wraps.

Not changed: the reminder email's own words, which are the server's, and the note the server
sends for operators, which the screen no longer shows. No reminder email is sent to a customer
yet.

One script that needs a verified test account, and so runs in no CI job, looked for "held" in the
log. It now looks for "on hold". It was updated and not run.

### Phase 6: errors in plain words

Every screen describes a failed request with the same few sentences, and most show them in the
same alert. Both are reworded.

| Before | Now |
| --- | --- |
| The status code after every message, in the typeface kept for codes: "(500)" | No status code. For a failure at Valo only: "If this keeps happening, report a problem and quote reference 4821." |
| "You appear to be offline. Nothing was lost; reconnect and try again." | "You seem to be offline. Reconnect and try again." |
| "The Valo service could not be reached. Check your connection and retry." | "Valo could not be reached. Check your connection and try again." |
| "Sign in required", "Please sign in to continue." | "Sign in to continue", "You are not signed in, or your session has ended." |
| "Access not available", "Your account cannot access this yet. It may need email verification, or it may be suspended." | "You cannot open this", "Your account cannot open this. Your email address may still need to be verified, or the account may be suspended." |
| "We could not find that record in your workspace." | "We could not find that in your workspace." |
| "This was changed elsewhere since you opened it." | "This was changed somewhere else after you opened it." |
| "Some details were not accepted. Please review and try again." | "Some details were not accepted. Check them and try again." |
| "Something went wrong on our side. Your work in this tab is unchanged." | "Something went wrong at Valo. Try again in a moment." |
| Too many requests, described as a failure at Valo | "Too many requests in a short time. Wait a moment and try again." |
| Drafting assistant: "Your entries are unchanged; retrying reuses the same request key." | "What you entered is still here. Trying again asks for the same draft, not a second one." |

Two sentences promised what they could not know: "Nothing was lost" and "Your work in this tab is
unchanged". The function that writes them does not know what the screen holds. They are gone. A
screen says it itself where it is true, as the editor and the drafting assistant do.

The reference is the failed request's own, in Valo's records. The API already sent it with every
error and the web app did not show it. It is the only code shown, and only as something to quote.
It counts requests since the server last started, so staff need the time of the report with it.

Found on the way: "offline" was said whenever the browser's online flag was missing, not only when
the browser reported being offline. A browser always has the flag, so customers were not shown
this. Outside a browser, in the Node version this repository runs, there is a `navigator` with no
such flag: a failure described there was called offline, and "not found" was never recognised.
Now offline is said only when the browser reports it.

Not changed: the server's own sentences, which are shown as sent wherever the server sends one.
There are over three hundred in the API. Putting them in plain words is a separate pass, on the
API's side, and is not done.

### Phase 6: the support forms in plain words

Three places where a customer writes to Valo and reads what happened next.

**The form for a request or a problem, and its receipt**

| Before | Now |
| --- | --- |
| "Saved. Waiting for a person.", then the server's sentence: "Enquiry received and saved. Awaiting staff review; no appointment or external dispatch has been confirmed." | "Enquiry received", then "It is saved for a member of Valo's staff to read. No appointment has been made, and no time for a reply has been set. Nothing has been sent to anyone outside Valo." |
| "Awaiting staff" | "Waiting for staff" |
| "Your request is durably stored. It has not been sent to any outside provider, and no appointment or response time has been set." | "Keep the reference if you write again." |
| "Requests are stored in your private workspace so we can tie them to your account. That needs a verified email first." | "A request is saved in your workspace, so it needs an account with a verified email address." |

"Enquiry received" is the requirement's own wording (SRV-002), and the screen now says it itself.
It came before only inside the server's sentence.

**The form for someone who cannot sign in, and its acknowledgement**

| Before | Now |
| --- | --- |
| Nothing said before the message was written | "A member of Valo's staff reads your message. Valo does not send replies by email yet, and no time for a reply is promised." |
| The server's sentence: "Request received and saved. No account details have been confirmed. Replies are not yet dispatched from this development build." | "Your message is saved for a member of Valo's staff to read. Nothing about your account has been checked or confirmed." |
| "Delivery: Not dispatched" | "Email: None sent" |
| "You can retry safely; it will not create a duplicate." | "You can try again: your message is saved once, not twice." |

Someone who cannot sign in has nowhere else to read a reply. So the form says before the message
is written, not only after it is saved, that no reply is emailed yet.

**The customer's own requests**

| Before | Now |
| --- | --- |
| "Your saved support requests", "Replies are saved in this signed-in portal; email delivery is not available." | "Your support requests", "Replies are kept on this page. Valo does not email them yet, so come back here to read them." |
| "support · awaiting customer", the system's names with the underscores taken out | "Valo product support · Staff have replied" |
| "awaiting customer · version 4" | "Staff have replied" |
| Two notes in the server's words: "Saved support workflow. Replies and decisions are durable; no external dispatch is enabled." and "No email, appointment, professional review or external referral is implied." | One note in the screen's words: "A reply here is not an appointment or a professional review. Nothing is emailed, and your request is not passed to anyone outside Valo." |
| "Customer" beside the customer's own messages | "You" |
| "Save reply to portal", "This case changed", "Your reply was saved to this case. It was not emailed." | "Save reply", "This request changed", "Your reply is saved with this request. It was not emailed." |
| "The save result is unknown. Retry the same request safely; it uses the same reference and will not create a second reply." | "Valo could not confirm whether your reply was saved. Try the same reply again: it is saved once, not twice." |

The states read "Waiting for staff", "With a member of staff", "Staff have replied" and
"Resolved". They are in `lib/support-words.ts`.

No limit that a screen stated was dropped:

- The receipt still says that no appointment is made, that no time for a reply is set, and that
  nothing is sent outside Valo.
- The acknowledgement still says that no email is sent, that no time for a reply is promised, and
  that nothing about the account is confirmed.
- The customer's requests still say that nothing is emailed, and that a reply is not an
  appointment, a professional review or a referral outside Valo.

The screens no longer print the server's notes. Those are written for the workflow that staff and
customers share. The server still sends them, unchanged.

Not changed: the staff screens, which say "case"; the dialog that asks before leaving an unsaved
reply, which staff screens share; and two panels left for a later, more careful step, because
their words carry limits on privacy rights and on refunds: the customer's privacy requests and the
payment concerns.

### Phase 6: the help page answers the first questions

The help page had eight questions in one list. None said how to make a document or how to check
requirements, which are the two things the site is for.

It now has fourteen questions in five groups, named for what the visitor is trying to do: "Making
a document", "Checking your requirements", "Dates and reminders", "Your account and your data" and
"Getting help".

Six questions are new:

| Question | What the answer says |
| --- | --- |
| "How do I make a document?" | Sign in, choose "New document", pick one of the twelve everyday documents or a blank one. Valo saves as you work and shows when it has. |
| "How do I find out which requirements may apply to my business?" | Open the check, which needs no account. "I do not know" is an answer. A result with no published rule is not an exemption. |
| "Is this legal, tax or accounting advice?" | No, in the footer's own words. |
| "What time zone are dates and times in?" | "Lagos time, wherever you are." |
| "Will Valo remind me about a due date?" | Only if reminders are turned on, only for a confirmed due date, and no reminder email is sent to customers yet. |
| "Where do I read the reply to a request I sent?" | On the "Report a problem" page, under the form. Replies are not emailed yet. |

Three answers link to the page they send the visitor to: the requirements check, "Report a
problem" and "Trouble signing in".

Each new answer was checked against the screen it describes: the "New document" page and its
twelve documents, the check's own introduction, the clock in `lib/format.ts`, the reminders screen
and the customer's requests. The eight earlier answers keep their words.

The page names no price, as no price is set.

The business profile asked for "CAC registration". It now asks for "Registration with the
Corporate Affairs Commission (CAC)", as the requirements check already did.

### Phase 6: privacy requests in words

The "Privacy and data" screen showed a request in the system's own names: "export · awaiting
verification · version 2", "external_processors: not applicable", "erasure quarantined · worker".
They are now words.

| The system's name | What the customer reads |
| --- | --- |
| Kinds: correction, export, deletion | "Correct something", "Full data request", "Delete my data", the words the form offers them in |
| States: awaiting verification, verified, assigned, in progress, needs information, held, partially fulfilled, fulfilled, rejected, cancelled, failed | "Waiting for you to confirm it", "Confirmed, waiting for staff", "With privacy staff", "Being carried out", "Staff need more information", "On hold", "Partly done", "Done", "Refused", "Cancelled", "Failed" |
| Steps: identity_verification, application, private_files, managed_identity, external_processors, retention_and_recovery | "Confirming it is you", "Your Valo workspace", "Your files", "Your sign-in account", "Other services Valo uses", "Records Valo must keep, and backups" |
| Step states: pending, running, confirmed, held, failed, not applicable | "Not started", "In progress", "Confirmed", "On hold", "Failed", "Not needed" |
| Who: customer, staff, worker | "You", "Valo staff", "Valo's system" |
| "version 2" | Not shown |

Only the server's "fulfilled" reads as "Done". The server gives a request that state only when
every system it tracks has a confirmed outcome.

Sentences reworded, each with its limit kept:

| Before | Now |
| --- | --- |
| "Verification, assignment and preparation are separate steps. A received or partially fulfilled request is not a confirmed deletion or complete provider-wide export." | "Confirming a request, giving it to staff and carrying it out are separate steps. A request that is received, or partly done, is not a confirmed deletion, and is not a complete copy from every service Valo uses." |
| "You can read and answer your own requests after workspace access is restricted for deletion; this does not restore business-data access." | "You can still read and answer your own requests after a deletion has restricted your workspace. That does not give back access to your business data." |
| "Processing has begun and cannot be cancelled as though no data had been removed. … doing so does not restore workspace access or confirm completion." | "Work on this request has begun, so it cannot be cancelled as though no data had been removed. … Doing so does not give back workspace access, or confirm that the request is done." |
| "A reply does not verify identity or confirm fulfilment." | "A reply does not confirm who you are, or that the request is done." |
| "I confirm this is my business's request and want the signed-in owner identity checked. This does not confirm that processing is finished." | "I confirm that this is my business's request, and I want Valo to check that I am the signed-in owner. This does not confirm that the request is done." |
| "These are saved support acknowledgements, not privacy-fulfilment outcomes. … older support-only requests still require intake." | "These are requests that were saved earlier as support messages. They are not the results of a privacy request. … An older one listed here has still to be taken up by staff." |
| "Verify my request", "Cancel before processing", "Download prepared result" | "Confirm my request", "Cancel before work begins", "Download the result" |

An older support reference showed the customer's own text with every word given a capital. It is
shown as written.

Left alone, on purpose:

- The paragraph that lists what the workspace download holds and does not hold. It is a precise
  list, and a test reads two of its phrases.
- The form that makes a request, and its acknowledgement, which already say that nothing is
  corrected, exported or deleted yet.
- The server's own sentences: a request's scope, a step's detail and an event's reason are shown
  as sent.
- The privacy and terms pages, whose words are not yet approved.
- The payment concerns panel on the purchases screen. Its words are about money and refunds, and
  no purchase is made in this build. It is not done.

These sentences describe privacy rights. No limit was changed, but a legal reader should see them
when the privacy page's words are approved.

One script that needs a verified test account, and so runs in no CI job, pressed "Verify my
request" and "Cancel before processing" and read the states by their old names. It was updated and
not run.

### Phase 6: words in the states a screen does not open in

The three browser tests of the word list read each screen as it opens. A sentence that shows only
in another state was never read: an empty list, a form that has to be opened, a failure. Reading
the source found six such sentences.

| Where | Before | Now |
| --- | --- | --- |
| Tasks, the form for a new task | "open a saved assessment and use "Add task" on a likely relevant item" | "open a saved result and use "Add task" on an item marked "Likely relevant"" |
| Tasks, with no task yet | "From an assessment", "no released rules for your situation" | "From a saved result", "no published rule covers your situation" |
| Saved templates | "Open a released template and choose Save template.", "the current released version" | "Open a template under Documents and choose "Save template".", "its current version" |
| Purchases, with no order | "Back to your drafts" | "Back to Home", which is where the button leads |

The empty list of reminders said what would fill it and offered nothing to do. It now offers "Go
to your tasks".

A new test reads the words where they are written. It parses every source file of the web app that
a customer's screen is built from, takes each piece of text a person could be shown, and checks it
against the same word list. The screens that only staff or developers open are named in the test
and left out. The test was tried by putting an old word back in three kinds of place: in a
screen's text, in a sentence chosen by a condition, and in a title. It failed each time.

What the test does not do: it reads the web app's source, not what the server sends, and it knows
only the word list. It would not notice "provider" or "dispatch".

The list of files left out was wrong at first. It named two files as staff-only that hold text a
customer can be shown: the panel of optional documents under a result, and the panels about a
bank dispute, one of which is on the purchases screen. Both are now read. A file that holds
anything a customer can be shown is read, even where staff panels share it.

Reading the first of them found a panel no browser test had ever drawn, because every test
answered its list with nothing:

- Above its heading it said "Optional operational aids", and a failure read "Optional operational
  aids could not be loaded." with a "Retry" button. It now says "Optional" above the heading, and
  a failure reads "A list of optional business documents could not be loaded. Your results above
  are not affected." with "Try again". The heading, "Business documents you may find useful", is
  unchanged, and so is the sentence that says the documents are not legal advice, are not chosen
  from the answers and do not mean any duty applies.
- With a document in the list, the result page grew wider than a phone's screen: 425 pixels on a
  360-pixel phone, with the test's one-sentence summary. A row keeps its summary on one line,
  and the row could not shrink to the screen. It now does, and a summary too long for the row
  ends in an ellipsis.

"Operational aids" joins the word list. A new browser test draws the panel with a document in it,
and with its list failing, on a phone.

### Phase 6: what the purchases screen opens on

The development database has no published content, so nothing is for sale. A customer who opens
"Purchases" finds a notice, a list with nothing to buy and a list with no order. All of it was in
the system's words.

| Before | Now |
| --- | --- |
| "Keep your order, verification, receipt and licence history together. A saved order or checkout return is not proof of payment." | "Your orders, their receipts and the licences you accepted are listed here. A saved order is not proof of payment, and neither is coming back from the payment page." |
| "Live payments are off", "Only explicitly enabled Paystack test-mode checkout is supported. Do not use real payment or confidential customer information. Email receipts are not marked delivered without delivery evidence." | "Real payments are switched off", "Where a checkout is offered here, it is a test, in Paystack's test mode. Do not enter a real card, or real or confidential customer details. A receipt sent by email is not shown as delivered unless its delivery is confirmed." |
| "Available documents", "There are no released documents with approved prices and commercial licences available to buy. Your existing drafts and private exports remain available." | "Documents you can buy", "Nothing can be bought yet. A document is listed here once it is published with a price and a licence. The documents you have made, and their files, stay in your workspace." |
| "Order history", "No orders saved", "Orders will appear here when you choose an available document and accept its licence. No payment has been assumed." | "Your orders", "No orders yet", "An order appears here once you choose a document to buy and accept its licence. Saving an order does not pay for it." |

Each limit is kept:

- A saved order is not proof of payment, and neither is coming back from the payment page
  (PAY-003).
- A checkout on this screen is only ever a test. The server starts one only in a development
  build, with test checkout switched on and a Paystack test key.
- No real card, and no real or confidential customer details.
- An emailed receipt is not called delivered without confirmation.

"Switched off" and "Nothing can be bought yet" are the pricing page's own words. The screen names
no price.

A new browser test opens the screen with nothing for sale and no order, on a phone, and reads
these sentences. The other tests give the screen an order, so its list with no order had never
been drawn.

Not changed: everything the screen shows once there is something to buy or an order. That is the
button that saves a test order, an order's states, the test checkout, the receipt, the refund form,
the information for a bank dispute and the payment concerns panel. These say "test order" and
"test-only refund policy" because only a test checkout exists, and they state what a refund and a
dispute do and do not do. They are left for when a price and a refund policy are set.

One script that needs a verified test account, and so runs in no CI job, read the two empty
states by their old words. It was updated and not run.

### Phase 6: the tax authority and its number, as the specification names them

The guidance page lists six official sources. One read "Federal Inland Revenue Service", "Federal
taxes and TIN", with the address firs.gov.ng. It was the only place the site said "TIN", and the
plan asked for a short explanation beside that term.

The specification no longer uses either name. Its 2026 update reads: "The Nigeria Revenue Service
has replaced the former FIRS framework, and the new Tax ID replaces the previous TIN identifier."
Its source S02 is the Nigeria Revenue Service's, on www.nrs.gov.ng.

The entry now follows the specification:

| | Before | Now |
| --- | --- | --- |
| Name | "Federal Inland Revenue Service" | "Nigeria Revenue Service" |
| What for | "Federal taxes and TIN" | "Federal taxes and the Tax ID" |
| Added line | | "It has replaced the Federal Inland Revenue Service (FIRS), and the Tax ID replaces the TIN." |
| Address | https://www.firs.gov.ng | https://www.nrs.gov.ng |

The added line is for someone who knows the earlier names. It says what the specification says and
no more. The sentence above the list is unchanged: "These are links, not endorsements, and none of
these bodies has reviewed Valo."

The address was not opened. This environment's network settings do not allow that host, or the
earlier one. It is the host of the specification's own source, and it is listed as open decision 12
for the owner to open once.

Each link in the list was named for a test by the first word of the source's name. Two names now
begin with "Nigeria", so each link is named by its address instead.

A new test reads the page in the server's HTML: the six addresses in order, the entry's three
lines, that the earlier address is gone, and that each link has a name of its own.

### Phase 6: a last survey for the system's words

The word list holds the phrases the redesign replaced. It does not hold every word of the
system's. As a last check, every piece of text a customer can be shown was read from the web app's
source, as the source test reads it, and searched for about thirty more: "released", "provider",
"server", "revision", "export", "schema", "synthetic", "queued", "payload" and others like them.
Twenty of the 147 files held one.

Fixed:

| Where | Before | Now |
| --- | --- | --- |
| The banner on every page | "Use synthetic test details only" | "Use made-up details only", the words the pricing page and the plan use |
| The sign-in and sign-up pages | "Email sign-in with verification and recovery is handled by our authentication provider.", "Use test details only." | "Signing in, confirming your email address and recovering your account are handled by our sign-in provider.", "Use made-up details only." |
| Sign-in and security | "Email, password, connected sign-in methods and active sessions are managed by our authentication provider." | "Your email, password, other ways of signing in and the devices you are signed in on are managed by our sign-in provider." |
| The documents and guides pages' descriptions, which a search result or a shared link shows | "Search released business templates…", "Browse currently released business guidance, with source details and review dates." | "Search the business templates and guidance Valo has published…", "Browse the business guidance Valo has published, with its sources and the dates they were checked." |

"Valo never sees your password" and "no real customer or confidential data" are unchanged. The
contact page already said "sign-in provider".

Found and left, each already listed as not done: the purchases screen once there is an order, with
its bank dispute and payment concern panels; the workspace data download; the drafting assistant;
and the privacy page, whose words are not yet approved.

Found and not a fault:

- "Provider" for someone who provides a service, and "reconcile" for amounts that do not add up,
  are the everyday words.
- A published template's page says "Development release" and "Not for sale". Those notices were
  kept when the page was rewritten. They change with launch and with a price.
- An alert that names a form's "schema" cannot be shown: the editor builds the answers from the
  form itself, so the two never differ.

The survey reads the web app's source. It does not read what the server sends.

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

## Where it stands

What is built for each heuristic, and what is not. "Built" means merged into the integration
branch. The tests that read each change are named in its pull request and, where one is cited as
evidence, in `docs/registers/ci-evidence.json`. Nothing here is launched, and no requirement is
accepted by it.

| Heuristic | Built | Not done |
| --- | --- | --- |
| 1. Visibility of system status | The editor says "Saved · version 3" or "Unsaved changes". A download says "waiting to be made", "being made" or "ready". The check ticks a step once its questions are dealt with. The reminders screen says whether emails are being sent and what has happened to each reminder. A support request and a privacy request say where they stand in words. The purchases screen says that real payments are switched off and that nothing can be bought yet. | The words inside a downloaded file, such as "Saved revision 3", are the server's and are unchanged. |
| 2. Match with the real world | One word list, with three tests that read the screens and one that reads the source, so that an old word cannot come back in any state. Amounts are typed, listed and printed in naira. Every date and time is on one Lagos clock in one format. | The twelve forms' own questions, which are frozen. The server's own sentences, over three hundred of them. The staff screens. On the purchases screen, everything about buying and about an order: saving a test order, an order's states, the refund form ("Refund amount in NGN"), "Provider dispute observation", the information for a bank dispute and the payment concerns panel. None of it shows while nothing is for sale and nothing was ordered. The drafting assistant still says "AI provider", "server" and "hash". The workspace download still says "Queued" and "JSON snapshot". |
| 3. User control and freedom | The editor has undo and keeps every version. "Start over" asks first. Five discards ask in the app's own dialog. "Save before leaving?" also catches the browser's Back and Forward buttons. | On the compiled site the Back button was checked once by hand; no CI test can sign in to it. |
| 4. Consistency and standards | The component styles are in one layer. Dates, times, amounts and counts go through one formatter. One header, one footer and one phone bar. One page where a document starts. | |
| 5. Error prevention | A new form opens without red marks, and what a document still needs is listed before a download. The check chooses no answer for the visitor. The editor saves nothing underneath an open question. Someone who cannot sign in is told before writing that no reply is emailed. | |
| 6. Recognition rather than recall | The landing page lists eight everyday tasks. The home lists the newest documents. The check shows its steps. A request's kind is named as the form named it. | |
| 7. Flexibility and efficiency | "Make another like this". A task chosen on the landing page is carried through sign-up. The check fills in from the business profile. | A new document is not filled in from the business profile: its questions are the frozen forms'. |
| 8. Aesthetic and minimalist design | The landing page is rebuilt around the two things a visitor can do. A document page gives what it is for before its notices. The home opens on its greeting. | |
| 9. Help users recognise, diagnose and recover from errors | A failed request is described in words, with no status code. A failure at Valo offers the way to report it, with a reference to quote. | The server's own sentences, which are shown as sent. |
| 10. Help and documentation | The help page has fourteen questions in five groups, and three of its answers link to the page they send the visitor to. The landing page has five questions. "CAC" is spelt out in the check and on the business profile. The guidance page names the "Tax ID" and says it replaces the TIN. | |

Not built, and not a matter of words: testing with five business owners. The plan called for it to
find what an audit by one reader cannot. It waits for the owner to arrange the participants.

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
6. The twelve forms' own questions, and the notice above them, are frozen in
   `lib/valo-core/src/guided-specs-v1.ts`. Some are in the project's words. The screen already
   shows "naira" where a question says "in whole kobo", but the question itself is unchanged.
   Rewording the questions needs a decision to unfreeze them.
7. The documents list has an "Access" filter for free and paid documents, which DOC-002 requires.
   No price is set, so the page cannot say what a paid document costs. Hide the filter until a
   price is set, or keep it.
8. The names of the workspace's sections ("Home", "Documents", "Requirements", "Tasks", "Business
   profile") were chosen in the plan. They stand unless the owner prefers others.
9. Every date and time is Lagos time, with no label beside it. The help page says so once.
10. Words that are the server's and were left alone: inside a downloaded file ("Saved revision 3",
    the draft notice), and the server's own sentences for a failed request.
11. Legal approval of the privacy and terms pages. The privacy requests' sentences were put in
    plainer words with no limit changed; a legal reader should see them at the same time.
12. The guidance page now names the "Nigeria Revenue Service" and the "Tax ID", in the
    specification's words, and links to https://www.nrs.gov.ng, the host of the specification's
    source S02. This environment's network settings do not allow that host, so the address was
    not opened. Open it once to confirm that it is the authority's site.
13. The drafting assistant says "AI provider", "Inserted verbatim by the server" and "Input hash".
    Its sentences are the notice a customer agrees to before anything is sent to the AI, and the
    server records that notice's version with every request (`customer-ai-development-notice-v2`).
    Putting the notice in plainer words means a new version of it, which touches the records and
    the prepared evaluation packages. It belongs with the decision on the AI budget, so it is
    unchanged.
14. The workspace data download says "Queued", "Prepare a private JSON snapshot" and "Prepared
    export availability withdrawn". Its sentences state limits on a privacy right, and a test in
    CI reads most of them word for word. They are unchanged; reword them with the privacy page.
15. The purchases screen's words about buying and about an order: "Save test order", "Continue
    hosted test checkout", "Staff reconciliation required", "Refund amount in NGN", "Provider
    dispute observation", and the panels for a bank dispute and a payment concern. They say
    "test" because only a test checkout exists, and they state what a refund and a dispute do and
    do not do. They are unchanged. Reword them when a price and a refund policy are set, with a
    legal reader.
