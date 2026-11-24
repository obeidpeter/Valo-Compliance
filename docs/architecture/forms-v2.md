# Forms that produce the document (forms v2)

Status: **design**, made under the owner's delegation of 24 November 2026 ("Implement all (make the
best decisions for me)"), for the [finishing plan](finishing-plan.md)'s phase 1, rows 1 and 2, on the
terms of its delegated decisions 1 and 3. It was made by reading the code. Each slice below is checked
against the code again when its work starts, and its pull request says what changed from this note.

## Why

A fill-in form's file prints each question with its answer (`lib/valo-core/src/guided-runtime-v1.ts`,
`questionBlocks`). For an invoice that is close to the document. For the five agreements it is not an
agreement: the file is a list of answers, with none of the template's clauses. EDT-001 asks that a
template's questions fill "selected clauses, formatting tokens and template version" (EDT-002), and
that the answers produce the document.

Three things stand in the way today:

- **The wording is held.** The templates' text exists only as frozen drafts in `docs/content-candidates/`.
  Held content stays held (AGENTS.md section 2): no form may print those drafts directly. In
  development, a template's wording is released only through the staff library (decision 0018), by a
  Content editor after a preview. Its free entries keep flattened text, and its premium entries keep a
  Word file and a public description of up to 600 characters. Neither carries placeholders a form
  could fill.
- **The contract forbids clauses.** `selectedClauses` has `maxItems: 0` (`lib/api-spec/src/shared.yaml`)
  and the renderer prints only paragraphs, lists and tables, with no headings.
- **Premium forms are open.** The five premium forms (TPL-13 to TPL-17) start, save and make files with
  no purchase check (`modules/documents/valo-documents.ts`, `createDocument`).

## The design

### 1. Wording from one released edition

A v2 form is joined to one released staff-library revision of its template: its id, its version and the
SHA-256 of the **form text** it released. The form text is the template's wording with its
placeholders named, in a small fixed grammar (below), kept in a new column of the library entry. It is
released as the rest of the entry is: a Content editor previews it and publishes the version, and the
library's trigger keeps it unchanged afterwards. The reviewed route can carry form text later through
the same interface; until then v2 runs only where the staff library runs, in development.

The coding work prepares, and never releases, the form text of the twelve templates: a server-side
annotation map per template turns the hash-checked retained draft into proposed form text, which a
staff action files as a private draft version. A test shows that the map adds no words: for every
combination of answers, the printed text with its slots left empty uses only the draft's words, in
the draft's order.

Customer code reads form text only through database functions that return it for a free edition, for a
premium edition the workspace has bought, or for the edition already recorded on one of the workspace's
documents. No public route returns it (DOC-004). Where no released edition fits a form, the form stays
on v1.

### 2. The v2 spec and the form text

**Form text** is Markdown limited to headings (`##`, `###`), paragraphs, bullet lists and pipe tables,
with three marks:

- a **slot**, the placeholder as printed followed by its name: `[ ]{=agreementReference}`;
- a **span**, text kept for one answer to a choice: `{?ipArrangement=licence}…{/?}`, with
  `{?ipArrangement=}` marking what prints while the question is unanswered;
- a **repeating row** of a table, bound to one of the form's tables, with calculated cells.

Reading the twelve retained drafts in slice 4 added three marks to the grammar before it shipped (slice
2), each needed for a finished document: a passage kept **while an optional question has an answer**,
`{?notes}…{/?}`, allowed only for a question the form may go without, so that a required answer's
placeholder always shows; a span **around a whole table row**, for an invoice's discount and tax rows;
and a **repeating group** of blocks, `{*topics}` and `{/*}`, for meeting minutes' topics, each with its
heading. An answer printed within a sentence keeps to one line, its line breaks printed as commas; a
slot that is a line of its own keeps each answer on lines of its own.

Anything else in braces, and any HTML, link or image, is refused. The grammar is frozen with the v2
spec; a change to either makes v3.

**The v2 spec** sits beside v1 (`guided-specs-v2.ts`, `guided-runtime-v2.ts`); v1's behaviour does not
change, and the package's `./guided-specs` and `./guided-runtime` stay pinned to v1. (Slice 5a widened
one v1 type only, so that v1's functions, which leave other blocks untouched, accept a document that
has v2's headings and header rows.) Following decision 1:

- every question v2 keeps is taken from `GUIDED_SPECS_V1` by reference, with its label, help, options,
  type and conditions unchanged, and a test compares them;
- `tokens`, declared but unused in v1, names the slots a question fills;
- a **clause choice** is a select question whose options keep spans of the text;
- a **new question** exists only where the template's wording needs one and v1 has none, each listed
  with the slot it serves;
- a question the edition has no wording for is dropped, with its reason (for example TPL-15's one-way
  option: the retained text is mutual only);
- **blanks** are slots left for completion by hand, such as signatures, never filled or invented
  (EDT-005);
- an **example** is a hint under an input, never saved or printed.

**The fit check** joins a form to an edition only when every token names a slot, every slot is filled
by a question, a calculation or a declared blank, every span names an option of a choice, every choice
prints something while unanswered, and the largest possible document fits the contract. A failure
names its problems and the edition is not offered. A confirmation fills no slot; it may keep the passage
its template prints once it is given with the one printed until then, as a receipt's acknowledgement does,
and no other (slice 5c).

### 3. Compiling and checking

A v2 document starts on the server (`POST /workspace/form-documents`), which reads the edition, checks
the fit and the purchase, fills in what the business profile safely gives, compiles and saves in one
transaction. A document made like another starts the same way, from the edition released at the time,
with the saved document's answers less its reference and its dates; the server checks those answers as
it checks a save, and fills in nothing from the profile. The editor then compiles in the browser for its
preview, as v1 does, from the form text the document's own endpoint returns.

At each save the server checks the answers' types (an unknown question, an option not listed, text over
its limit or too many rows is refused; a date or amount not yet valid stays a draft answer and leaves
its slot empty), that the clauses saved are those the answers choose, that the edition and its digest
are the ones recorded on the document, and that compiling the saved answers gives exactly the saved
blocks. The export worker repeats the edition check before it renders. A document records its form
version, its edition and digest and, for a premium edition, the purchase it was started under, in
columns that cannot change once written (DOC-005). v1 documents keep their `valo-guided-v1:` blocks,
their codec and their checks, and are never upgraded.

### 4. Purchases

One rule decides whether a workspace may start or convert to a premium form: it holds a verified
purchase of a live edition of that template, with the same evidence the purchased file's download uses.
A document already made stays the customer's under decision 3: a later refund or withdrawal closes new
starts and the bought file, not the drafts.

### 5. Rendering and the contract

The renderer gains heading blocks and header rows that repeat on each page, in HTML, PDF and Word.
Clause numbers stay the template's own words. The contract gains the heading block, header rows, a
bounded `selectedClauses` of `question=option` entries allowed only on form documents, and the
document's form record. The draft notice stays as it is; when a complete document may print without it
is the finishing plan's "finished file" row.

### 6. The web app

The documents starter and a template's page say, for each template, whether it starts its form, needs a
purchase first, or has no released wording yet. Questions show their examples. The business profile
fills only the business's own details: never a counterparty, an address, a date, an amount or a clause.

## Slices

| # | Pull request | Requirements |
| --- | --- | --- |
| 1 | The five premium v1 forms need a verified purchase of a live edition of their template to start, or to be added to a document, decided by one database function for the scoped workspace. The starter shows the server's refusal; slice 7 says so before a press. | DOC-005, EDT-001 |
| 2 | valo-core: the form-text grammar, the v2 spec types, the fit check, compiling and the answer-type rules. Pure code, not yet used. Shipped with slice 3. | EDT-001, EDT-002 |
| 3 | The renderer: headings and header rows that repeat on each page, v1's HTML pinned. The contract and the revision codec take them in slice 5, with the documents that use them. | EDT-002, EDT-006, EDT-009 |
| 4 | The library's form text: its column and trigger, the staff save and preview of the fit, the action that files proposed form text as private drafts, and the first v2 form and annotation map, the invoice's (TPL-01). | EDT-001, EDT-002, DOC-004 |
| 5 | Starting, editing, saving and exporting the free v2 forms, with the document's form record, and the maps and forms of the other six free templates (TPL-02, 03, 04, 05, 08, 12). In three pull requests: 5a, the server, the contract and the form record, with the invoice; 5b, the editor and the workspace around it (its questions filling the wording as they are answered, the preview, what is still needed, reused details, making another and converting, the documents list and the starter's form-first start); 5c, the other six maps. | EDT-001, EDT-002, EDT-005, EDT-006, DOC-005 |
| 6 | The premium v2 forms (TPL-13 to TPL-17), with their maps: each agreement's schedules need more question-to-wording decisions than a free form's. | DOC-004, DOC-005, DOC-007, EDT-010 |
| 7 | The starter, the template page, examples and the profile's details. | EDT-001, DOC-005, PRO-003 (in part) |

Tests that pin v1 stay unchanged throughout, among them `valo-guided.test.ts`, `valo-render.test.ts`,
`valo-validation.test.ts`, `valo-revision-codec.test.ts` and `retained.test.ts`, and the web app's
form tests. A test whose screen changes says so in its pull request, and its citation in the evidence
register is rewritten to say what it then shows.

## The owner's points

None of these blocks the engineering. Each is the owner's to settle:

1. The few new question labels, the examples, and whether a filled agreement carries the
   specification's "AI drafted and reviewed; no professional legal review" notice, and in what words.
   The five-owner test judges the labels (decision 1).
2. Releasing each template's form text in the staff library, as a Content editor, and the edits the
   annotation proposes: completion instructions printed while a choice is unanswered, and invoice rows
   v1 has no question for.
3. Wording for a one-way non-disclosure agreement, if one is wanted; v2 offers the mutual agreement.
4. The licence text that states what a buyer keeps (decision 3).
5. Whether the staff library's routes are taken to production at launch (decision 2), since v2 depends
   on them.
