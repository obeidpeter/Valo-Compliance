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
