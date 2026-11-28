# The acceptance pack

The finishing plan's row: "The ten user-test packs as scripted journeys where a script can run them;
the evidence for each gate gathered by a command; the registers refreshed" (UAT-01 to UAT-10).

## What it is

A command, `pnpm --filter @workspace/scripts valo:acceptance-pack [file]`
(`scripts/src/valo/acceptance-pack.ts`). For each of the specification's ten user-test packs it
gives:

- the pack's words as the specification has them: what it covers and the evidence it requires;
- the requirements its reference names: families ("WEB, DOC, EDT"), ranges ("PAY-001–009") or both
  ("ADM + EDP-001–012"). A token that names no requirement is refused;
- the tests the evidence register cites for those requirements, with their results in the run it
  reads (`VALO_EVIDENCE_RESULTS_DIR`), or as not run without one;
- each part of the required evidence, placed as a script in CI gives it today, as a script could but
  none does yet, or as only the owner or another person can give it. For a part a script gives, the
  requirements whose cited tests give it, or, where only some of those tests do, those tests by name,
  each cited for one of the requirements; and those tests' results. The parts, joined, are the
  specification's words exactly, so no part of a pack's evidence is left out.

It accepts nothing. A pack is accepted only on all of its evidence and the owner's approval. A
citation never accepts a requirement (decision 0010), and a pack whose every scripted part passes
still waits for the rest. The placing of each part is a reading for the owner to check.

CI's evidence job runs it after the readiness report, keeps `acceptance-pack.json` as the
`acceptance-pack` artifact, and adds a table of the parts to the run's summary.

## Where each pack stands

| Pack | A script gives it today | Not yet scripted | The owner | A person |
| --- | --- | --- | --- | --- |
| UAT-01 Free journey | the recorded journey, on a phone and a desktop; correct output and stored revision | | | |
| UAT-02 Paid journey | | | sandbox tests (the test key); the live purchase and refund | |
| UAT-03 Guided editing | Word/PDF opening; revision conflicts | the golden sample comparison | | |
| UAT-04 AI drafting | | | the 60-case rubric (the customer AI path's allowance and a budget) | |
| UAT-05 Requirements | the 80-scenario suite and its results | | | |
| UAT-06 Isolation | the negative test matrix | | | |
| UAT-07 Content governance | no critical false release; immutable evidence and disclosure | | | the 60 editorial cases, judged by the independent reviewer |
| UAT-08 Operations | the load report | the restore drill | the reconciliation result (the test merchant) | the on-call drill |
| UAT-09 Privacy | the data-lifecycle test | | the processor checklist | |
| UAT-10 Enquiry and reminders | support ticket, preference and retry records | | the delivered test email (an email provider) | |

## The slices

| # | Slice | Packs |
| --- | --- | --- |
| 1 | **The command and its report in CI** (built). Unit tests: every part of each pack's evidence is placed in the specification's words; a reference names families, ranges or both, and nothing else; each part a script gives names requirements with cited tests; a run's results are counted part by part, and no pack is accepted. | UAT-01 to UAT-10 |
| 2 | **The recorded journey** (built, below): the free journey in a browser, on a phone and on a desktop, kept as recordings with its output and stored revision. | UAT-01 |
| 3 | **Golden samples:** each guided template's files compared with kept samples. | UAT-03 |
| 4 | **The restore drill,** with the finishing plan's backup row: capture, archive, restore and replay end to end, asserting the recovery point and time. | UAT-08 |

## The recorded free journey

UAT-01's journey, "visitor finds a free template, saves a draft and exports it", made by a test in CI's
database job (`artifacts/api-server/src/scripts/free-journey.integration.test.ts`) on an emulated
phone and on a desktop-sized screen, against the real API and the job's database. Each part is
recorded as a video:

1. **Finds the invoice.** A visitor who is not signed in opens the home page as the compiled web
   server renders it (decision 0011), finds the invoice among its everyday tasks, and follows "Send
   an invoice" to the sign-up page. The server's reads and the browser's reach the real API.
2. **Signs up.** The sign-up page hands the identity provider where the new account starts: the page
   where a document starts, with the invoice first; the sign-in form keeps the choice too.
3. **Saves and downloads.** Signed in there, the visitor starts the invoice, answers its questions,
   sees the draft saved, makes its finished PDF and Word files, downloads both, and finds them in the
   business library with the saved version and what they were made from.

Then the test reads what was made. Correct output: each file holds the answers and the totals worked
out from them, and no draft notice. Stored revision: the saved version is the document's current
revision, whose hash is its own content's and which holds the answers; each file's export was made
from that revision and its content, and the downloaded bytes are the file stored for it. The library
names what the files were made from: Valo's own invoice questions, or, had a form been released when
the invoice started, that release. The journey first showed it saying "Not made from a template",
which was put right (docs/architecture/library-entries.md, section 5).

CI keeps the six recordings, the four files and `journey.json` (what each screen's journey made, and
from what) as the run's `uat-01-free-journey` artifact, for a person to watch the journey and open
what it made.

What is stood in for, and nothing else: the identity provider, whose sign-up form and session are its
own and cannot load in a test (the sign-up page is drawn with the app's stand-in for it, which shows
where the form would send the new account, and the server is told which synthetic account asks), and
the queue's worker (each file is made by the function the worker calls). The phone and the desktop
are the browser's emulations of them. Whether a recording of a script on emulated screens is the
recording UAT-01 asks for, or the owner wants one made by a person on real devices with the real
sign-up, is the owner's to judge; the pack places this one as a script's and accepts nothing.

The readiness report and the status page list each pack as blocked; this command adds the evidence
beside them, and nothing changes a pack's status.
