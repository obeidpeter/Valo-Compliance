# A finished file

Design for the finishing plan's Phase 1 row "A finished file" (EDT-005, EDT-006, EDT-009). It is a
proposal under the owner's delegation of 24 November; the notice's words are the owner's to settle.

## The problem

Every file a customer makes carries "INCOMPLETE DRAFT" on each page, complete or not. The editor asks
the customer to say they want a draft copy before any file is made, and the server refuses a request
that does not say so (`acknowledgeDraft`). So a complete invoice, filled in with every answer it needs,
can only ever leave Valo marked as an incomplete draft.

EDT-005's acceptance asks for the opposite split: "final export blocks mandatory omissions or requires a
deliberately watermarked incomplete draft; never invent legal names, addresses or signatures". A
complete document should make a finished file. An incomplete one should make only a marked draft, and
only when the customer asks for one.

## What changes

### 1. Two kinds of file

A file request says which kind it wants, with the field it already has:

- `acknowledgeDraft: true` makes a marked draft, as today, for any saved version.
- `acknowledgeDraft: false`, refused today, now asks for a finished file. The server makes one only
  when the saved version is complete. Otherwise it refuses with 422, sends the customer to the
  editor's "Still needed" list, which names each missing detail, and offers the marked draft. For a
  document typed by hand it says why its file is a marked draft.

The export job records which kind it is, in a new column (`finished`), and the job's reply carries it.
A finished file and a marked draft of the same version are two different jobs. Asking twice with the
same key and a different kind is a conflict (409), as for any other change.

### 2. What complete means

A document is complete when the editor's "Still needed" list is empty. That list moves from the web
app into `valo-core`, so the server, the worker and the editor read the same answer:

- **A document made from a v2 form:** no answer is still a draft answer, and compiling the answers
  leaves no slot unfilled. A declared blank, such as a signature or the response record of an offer
  letter, is not an omission: the parties complete it by hand, and Valo never invents a signature.
  The editor lists blanks left in the text today, declared blanks among them; with the form text it
  now lists the slots left unfilled instead. That is the one change to what the list says.
- **A document made from questions (v1):** the questions report no issue, and no blank is left in the
  text, as the list says today.
- **A document typed by hand** is never complete in this sense, so its file stays a marked draft.
  No questions say what it must hold, and the editor's list for it asks for every field the document
  has, a due date and notes among them, which a letter or a policy does not need. Its list is
  unchanged and still helps the customer; a rule of its own is left for a later decision.

### 3. Checked twice

The request checks the saved version in its own transaction, before it records the job. The worker
checks again in the workspace's scope, just before it renders, as it already rechecks a form
document's edition. A saved version never changes, so the two checks agree unless the rule itself
changed in between, or a job row was written some other way. Either way the worker refuses to make a
finished file of an incomplete version, and the job fails with `DOCUMENT_INCOMPLETE`.

### 4. What a finished file prints

A finished file drops the words "INCOMPLETE DRAFT". It keeps a notice where the draft notice is today,
in the page header of the Word file and the PDF, because EDP-008 asks for the document's status and
limits on exports:

> Prepared with Valo from the details the business entered. Not proof of payment, a government tax
> invoice, an official approval or legal advice.

The words are a proposal for the owner. They keep what the draft notice says about the details and
what the file is not, and drop only the claim that the file is incomplete. Whether a filled agreement
also carries the specification's "AI drafted and reviewed; no professional legal review" notice stays
the owner's decision (forms-v2 owner's point 1). Until the owner decides, a finished agreement carries
the same notice as any other finished file.

A marked draft prints exactly what it prints today.

The blank Word masters filed from the retained drafts are templates, not documents, so they stay as
they are: "BLANK DEVELOPMENT TEMPLATE" says what each one is, in the development library it belongs
to. Whether the staff library goes to production at launch is the owner's decision (forms-v2 owner's
point 5); the masters' notice changes with that decision, not with this one.

### 5. The editor and the lists

The editor's file panel offers "Make the finished file" when the saved version is complete. When it is
not, it says what is still needed and offers only "Make a marked draft", after the customer says they
want one, as today. For a document typed by hand it says that its file is a marked draft, and why.
The documents list and the business library say which files are finished.

## Slices

The three slices come in one pull request, each in commits of its own, since each is small and they
are verified together.

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | The "Still needed" list moves into `valo-core` unchanged, in a commit of its own; then it takes a v2 document's form text and lists unfilled slots instead of every blank, and says whether a document is complete. Tests for each kind of document. | EDT-005 |
| 2 | The server: the job's `finished` column (a migration with its upgrade test and runbook), the request's check, the worker's check, the finished notice in the renderer, and the reply. Database tests: a complete version makes a finished file without the draft label; an incomplete one is refused with what is missing; a marked draft is still made for either; a finished job of an incomplete version fails in the worker. | EDT-005, EDT-006, EDT-009 |
| 3 | The editor's file panel, the documents list and the business library, with browser tests. | EDT-005, DOC-005 |

## The owner's points

1. The finished file's notice, in section 4.
2. Whether a finished agreement also carries "AI drafted and reviewed; no professional legal review"
   (already forms-v2 owner's point 1).
