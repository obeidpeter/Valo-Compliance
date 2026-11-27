# The editor: one text, headings on every page, files that open, fixed wording shown as fixed

Design for the finishing plan's Phase 1 row "The editor: a lock on a template's fixed wording; a check
that the preview and the files say the same; a check that Word opens the file; table headings repeated
across pages" (EDT-002, EDT-003, EDT-006). It is a proposal under the owner's delegation of 24 November.

The three requirements' acceptance, verbatim:

- EDT-002: "preview, DOCX and PDF use the same saved revision, not three independently generated texts."
- EDT-003: "changes remain after reload and login on another device; locked guidance is distinguished
  from editable business content."
- EDT-006: "each guided template opens in Word and a standard PDF reader; long names, multi-page tables
  and the naira symbol render correctly."

## What there is today

**The text.** The preview, the Word file and the PDF share one function for a document's blocks,
`guidedRenderableBlocks` in `valo-core`. Everything around the blocks is written three times: in
`components/document-preview.tsx` for the preview, and twice in `lib/valo-render.ts`, once for the
PDF's page and once for the Word file. The three differ:

| | Preview | Word and PDF |
| --- | --- | --- |
| A field left empty | "Missing" | "[Not supplied]" |
| The line under the title | "Draft · version 3 · your own document, not reviewed" | "Valo · Saved version 3" |
| The notice | not shown | the draft or finished notice, on every page |
| An empty paragraph | "Empty paragraph" | nothing |
| A blank line in a list | left out | an empty item |

"Copy text" is a fourth text, `formatDocumentPlainText` in the web app. It has a notice of its own, and
it looks for the prefix `guided-`, which no document has. So for a document made from a form it also
prints the business details the form already holds in its text.

No test compares the preview with the files. The nearest tests find a few strings in each.

**Headings across pages.** A table's first row repeats on each page only when the table says it is a
heading row (`headerRows: 1`). Only the tables of a document made from a v2 form say so. In a document
made from questions (v1), the invoice's items have their column names in the first row and no heading
mark, so a 40-row invoice prints its column names on the first page only. A customer's own table cannot
have a heading row at all: the server refuses `headerRows` on a typed document. No test renders a table
over several pages and looks for its heading on each.

**Files that open.** The Word file is made by the `docx` package and the PDF by Chromium's print. The
tests check that a Word file is a zip with a document part, a table and a header, and that `unzip` can
read it. Nothing checks the file against the rules Word itself enforces, and no second program opens
it.

**Fixed wording.** A document made from a v2 form is the template's released wording with the answers
filled in. Its wording cannot be changed: the editor shows only its questions, and the server refuses a
save, or a file, whose text is not the wording filled with its answers. A document made from questions
(v1) is checked the same way for the blocks its questions make; the customer's own blocks around them
stay free. A copy of a library or reviewed template is the customer's own and stays free. What is
missing is the distinction EDT-003 asks for: the preview shows the wording and the answers alike, and
nothing on screen says which part is fixed. One gap on the server: a typed document may carry blocks
whose identifiers belong to a form, and the editor then hides them, so nobody can change or remove
them.

## What changes

### 1. One text for the preview, the files and "Copy text" (EDT-002)

The text around the blocks moves into `valo-core`, next to the blocks' function, as one description of
the printed page: the notice, the title, the line under it, the fields with their names, and the
blocks. The preview, the Word file, the PDF and "Copy text" each draw that description and add none of
their own. The renderers' code moves first, unchanged, in a commit of its own.

The differences are settled on what the file prints, because the preview is there to show the file:

- An empty field reads "[Not supplied]" in the preview, as in the files. The editor's own list of what
  is still needed keeps saying "Missing".
- The line under the title is the file's: "Valo · Saved version 3".
- The preview shows the notice its file will carry: the finished notice when the document is
  complete, the draft notice otherwise (docs/architecture/finished-file.md).
- An empty paragraph prints nothing anywhere. The editor still shows it in the block list.
- A blank line in a list is left out everywhere.
- "Copy text" starts with the same notice, and reads a form document's details from its text only.

The check is a test that each of the four gives the same text as the description, for a set of
synthetic documents: a typed document with every kind of block, a long name and an amount in naira; an
invoice made from questions with 40 items; a document made from a v2 form; a library copy; each as a
draft and as a finished document. The preview's text is read from its rendered page, the Word file's
from its document part, and the PDF's with `pdftotext`.

### 2. A table's heading row on every page (EDT-006)

- A table made from questions (v1) prints its first row as a heading row, as a v2 form's table does.
  So do the invoice's totals tables. The saved documents do not change: the printed page reads the
  heading from the table's kind.
- A customer's own table can have a heading row. The block editor gains "First row is a heading", and
  the server accepts `headerRows: 1` on any table, as it does on a form's. A table without the mark
  prints its first row once, as today.
- Word repeats a heading row at the top of each page (`w:tblHeader`), and the PDF does too (`thead`), as
  both already do for a v2 form's table.

The check renders a 40-row table of each kind to a PDF of several pages, and reads each page's text: the
heading row is at the top of every page. In the Word file, exactly the heading row is marked to repeat.

### 3. Files that open (EDT-006)

- **Word's own rules.** A check reads a Word file the way Word does, and fails on what makes Word refuse
  a file: a part that is not well-formed XML; a part, or a relationship's target, missing from the
  package or from its content types; a main document whose type is not a Word document's; a table
  cell with no paragraph; a table with no grid. The export worker runs the check on each Word file
  before storing it. A file that fails it is not given to the customer: the job fails at once, since
  the same version would make the same file again, and says so: "This Word file did not pass Valo's
  check that Word can open it, so it was not kept. You can still make the PDF of the same version."
- **A second program.** In CI, LibreOffice opens each Word file and prints it to PDF. The text it prints
  must be the description's text. The foundation job installs LibreOffice for this step, which costs
  nothing.
- **What is checked:** every guided template's Word file and PDF, made from synthetic answers: the
  twelve templates' forms made from questions and their twelve v2 forms. Also the typed document, the
  library copy and slice 2's long tables. The PDFs are read by `pdftotext`, as the file tests already
  read them.

Settled while building it: LibreOffice found a fault in the Word files. With nothing between them,
Word and LibreOffice join two tables in a row into one, so an invoice's totals took the heading row of
its items. A Word file now keeps two tables in a row apart with an empty paragraph, which prints no
word.

Neither check is Microsoft Word itself, which cannot run in CI. Opening one file of each kind in Word
and in a standard PDF reader stays a manual check for the owner, with the five test sessions (redesign
phase 6). It is listed in the owner's points below. Until it is made, EDT-006 is not accepted.

### 4. Fixed wording, shown as fixed (EDT-003)

- **A document made from a v2 form.** The preview marks the customer's answers inside the template's
  wording. A line under the questions says: "The template's wording stays as it was released. You
  change this document by changing your answers." The compiler gives the preview each answer's place in
  the text. Nothing about it is saved.
- **A document made from questions (v1).** The preview marks the blocks the questions make: "From your
  answers". The customer's own blocks are not marked, and stay free in the block list.
- **The notice.** The preview marks the notice as added by Valo, which cannot be removed.
- **The gap.** The server refuses a typed document whose blocks carry a form's identifiers, with the
  same message as any other refused save.
- **Copies stay free.** A copy of a library or reviewed template is the customer's own, as
  library-entries.md decided, and nothing in it is fixed.

The server's refusals do not change; they are tested already. The new checks are render tests of the
marks, a database test of the refused typed document, and the signed-in screens' accessibility check of
a form document with its marks.

Settled while building it:

- What the preview marks in a form's wording is what the answers put there: each answer, and what the
  form works out from the answers, such as a line's amount or a total. A placeholder still waiting for
  its answer is part of the wording. The marks are highlighted and underlined, so they show without
  colour too. The preview marks only text whose pieces are the block's own text, so a mark can never
  change what the page says.
- "From your answers" is said once above each run of blocks the questions make, which carry a line
  down their side.
- The notice's mark reads: "Added by Valo to every page of the file. It cannot be removed."
- The refused typed document is one with a block of a form's wording (forms v2). A stray block of a
  form made from questions (v1) was refused already: the questions' check needs their form's own block.

## What does not change

- The saved documents, their versions and their files already made.
- The server's checks of a form document's wording and of its questions' blocks.
- What a customer can edit.

## Slices

There are three pull requests: the design and slice 1; slices 2 and 3; slice 4.

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | One text. Move the printed page's description into `valo-core`, unchanged (its own commit), then draw the preview and "Copy text" from it and settle the five differences. Tests: each of the four gives the description's text, for the synthetic documents above. | EDT-002 |
| 2 | Heading rows. The heading row of v1 and totals tables, `headerRows` on any table, the block editor's choice. Tests: the heading row on every page of a 40-row table's PDF, and only the heading row marked in its Word file. | EDT-006 |
| 3 | Files that open. The Word check in the export worker, and LibreOffice in the foundation job. Tests: every guided template's files, the typed document and the library copy pass the check, and LibreOffice prints the description's text. | EDT-006 |
| 4 | Fixed wording shown as fixed. The marks in the preview, the line under the questions, and the refused typed document. Tests: render tests, the database test and the accessibility check. | EDT-003 |

## The owner's points

1. The words: "[Not supplied]" in the preview, "First row is a heading" in the block editor, what a
   job says when its Word file fails the check, the line under a form's questions, "From your answers"
   and the notice's mark.
2. The manual check: one file of each kind opened in Word and in a standard PDF reader, with the five
   test sessions. EDT-006 is not accepted without it.
