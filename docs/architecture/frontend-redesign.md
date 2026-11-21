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
