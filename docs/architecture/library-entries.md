# Library templates as full entries

Design for the finishing plan's Phase 1 row "Library templates as full entries" (DOC-001, DOC-003,
DOC-006, DOC-009, EDP-008). It is a proposal under the owner's delegation of 24 November. As the plan
says, the statement of how a template was written and checked is the owner's to approve.

## The problem

A template released from the staff library (decision 0018) has a title, a text and a file. Its page
shows a preview, a download and one line: "Published by the Valo editorial team." Beside a reviewed
template's page, it lacks five things:

- **Saving and suggestions (DOC-009).** Saving takes only a reviewed version, and the suggestions read
  only reviewed versions. So a library template's page has no save button, and the saved list never
  suggests one.
- **A copy in the workspace.** "Make my own copy" makes a document only from a reviewed version's
  text.
- **What it is for, what you need and its limits (DOC-003).** The page shows no summary for a library
  template. The API sends "Business template" and "Everyday business use." for every one. A reviewed
  template's page shows a summary and limits, but no template page says what a customer needs.
- **Related guidance (DOC-003).** No template page links guidance, on either route.
- **How it was written and checked (DOC-003, EDP-008).** "Published by the Valo editorial team." says
  nothing of AI drafting or of the absence of professional review. Both requirements ask the page to
  say both.

The 40 retained drafts reach the library through the staff library. So these gaps are on the template
pages a customer is most likely to see.

## What changes

### 1. The entry's details, released with its text

A template's revision gets five details of its own. A Content editor writes them, previews them with
the text, and releases them with it:

| Detail | On the page | Limits |
| --- | --- | --- |
| What it is for | "What it is for", and the summary in the library's list | 1 to 400 characters |
| What you need | "What you need", one item to a line | up to 12 lines of up to 120 characters |
| Its limits | "Limits you should know" | 1 to 800 characters |
| Related guides | "Related guidance", each a link | up to 6 library items |
| Whether AI drafted it | "How it was written and checked" | yes or no |

As columns of the revision, they are kept unchanged by the database guard that keeps a saved text
unchanged. They join the revision's fingerprint only when present, as the form text does, so every
earlier revision keeps its fingerprint.

The database guard releases a template revision only when it says what it is for, its limits and
whether AI drafted it. That follows DOC-001's acceptance: incomplete evidence prevents release. A draft
saved before this change must be saved again with them. A template already released keeps its page. It
shows the details it has, and the statement for a version whose drafting was not recorded.

The page shows a related guide only while that guide is released. A withdrawn one drops from the page,
so the list degrades gracefully, as DOC-009's acceptance asks.

The library's list shows a library template's purpose as its summary, in place of the opening of its
text.

### 2. How it was written and checked

Under "How it was written and checked", the page shows one of three statements, with the release date:

- **Drafted with AI:** "Drafted with AI. A Valo Content editor read this version before releasing
  it. Valo ran no AI review of it, and no Nigerian legal, tax or sector specialist reviewed it."
- **Written without AI:** "Written without AI. A Valo Content editor read this version before
  releasing it. No Nigerian legal, tax or sector specialist reviewed it."
- **Not recorded**, for a version released before this change: "A Valo Content editor read this
  version before releasing it. No Nigerian legal, tax or sector specialist reviewed it."

The reviewed route's statement would be untrue here: "AI drafted and reviewed; not reviewed by a
Nigerian legal, tax or sector specialist". Valo runs no AI review on the staff library's route. The
words are a proposal for the owner, as the statement for owner-signed rules was (decision 0020).

The page still says that the template is an everyday business document, not legal guidance. That keeps
a business draft apart from general guidance (EDP-008). A related guide is labelled as guidance.

### 3. Proposed details for the 40 retained drafts

Filing a retained draft also files proposed details with it. They come from a file in the repository
written for this design (`retained-entry-details.ts`):

- **What it is for and its limits** are written from the draft's own "Purpose" paragraph, in the
  site's words, where it has one; 19 of the 40 do. The other 21 include the agreements and the employment, governance and privacy
  documents. Their purpose and limits are written from the draft's own sections.
- **What you need** lists the facts and records the draft asks for, from its fields and sections.
- **Related guides** are the retained guides that name the template as related: the practical guides'
  "Suggested related templates" lines and the regulatory guides' "Related templates" lines. 24 of the 40
  templates have at least one. A link points to the guide's library item, so it appears once the guide
  is released.
- **Whether AI drafted it** is yes. The intake manifest records that the retained drafts were written
  in a ChatGPT conversation.

A test checks each proposal:

- It fits its limits.
- A higher-risk template's limits say when independent advice may be useful (DOC-003's acceptance).
  Higher-risk means any of the reviewed route's risk classes other than general: tax, employment,
  privacy, governance, contracts and regulated sector.
- No proposal promises that a document is enforceable, suitable or compliant, or officially approved.
- Every related guide names the template in its own retained text.

The details are proposals and publish nothing. A Content editor previews each one with its text, then
releases it or corrects it first.

### 4. Saving and suggestions

Saving takes a staff-library release in the same way as a reviewed one. The saved row keeps the item's
address name (`manual-<item>`), which stays the same from version to version, with the title and
version saved. The saved list reads each saved template's current release on either route. A withdrawn
one stays in the list, marked unavailable, with the title it had (DOC-009's acceptance). The
suggestions draw on the staff library's templates as well, by the same rules: first an activity in the
business profile, then a category the customer saved.

A customer request cannot read the staff library's table. So it reads the released templates through
a function that runs as the table's owner and returns what the library lists of each, never a draft,
a file or form text. Only the workspace's scoped role may call it, as with the forms' editions.

### 5. A copy in the workspace

A free library template's page offers "Make my own copy", as a reviewed one's does. The copy is a
document typed from the release's text: each paragraph is a block, and a run of lines with cells
separated by a bar is a table. The document records the release it was copied from, in a new column
(`library_edition`), as a reviewed copy records its version. The business library names that release
beside the document's files, by the title it was released under (DOC-005). The copy is the
customer's own work. A later release or a withdrawal never changes it (DOC-007, EDT-010).

A text too long for a document is not copied: more than 100 blocks, or a block over 8,000 characters.
The page then says that the template is available as its Word file only.

A database guard records the release only from a released free template, when the document is
written, and never changes it. Two more owner's functions give the scoped role what a copy needs: a
released free template's text, and the release each of the workspace's copies came from, for the
business library.

The staff library holds only a premium template's public description. Its whole text is in its Word
file. So a premium library template offers no copy. Its page says that it comes as a Word file, as
DOC-009 asks of an unsupported format. The five premium templates with forms keep their questions.

### What does not change

The reviewed route's pages keep what they show. Its candidates record scope and limits, but not what a
customer needs or related guidance. Adding those would change its reviewed bundles, and this row does
not.

## Slices

There are two pull requests. The first carries this design and slice 1. The second carries slices 2
and 3, each in commits of its own.

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | The details and the statement. A migration adds the five columns and the guard's release check, with its upgrade test and runbook. Then the staff screen's inputs, the proposals for the 40 retained drafts with their test, and the API and template page. Database tests: a release without its details is refused; the details cannot change once saved; a withdrawn related guide drops from the page. A browser test of the staff screen's new inputs. | DOC-001, DOC-003, DOC-006, EDP-008 |
| 2 | Saving and suggestions for library templates, with the function that reads the released templates for the scoped role. A database test of saving, listing, withdrawal and removal, and a render test of the save button on a library template's page. | DOC-009 |
| 3 | The copy. The column `valo_documents.library_edition`, its guard, and the functions for a copy's text and the business library. Then the copy route, the page's button and the business library's link. Database tests: a copy records its release, stays the customer's after a withdrawal, and is refused for a withdrawn release; a premium release offers none. | DOC-005, DOC-007, EDT-010 |

Slices 2 and 3 share one migration, with its upgrade test and runbook.

## The owner's points

1. The three statements' words, in section 2.
2. The proposed details of the 40 templates, especially the higher-risk ones' limits. A Content editor
   releases them; the owner may want to read them first.
3. Whether a file made from a library template also carries the template's statement. EDP-008 asks
   for the statement on exports. This joins forms-v2 owner's point 1, which asks the same of agreements.
