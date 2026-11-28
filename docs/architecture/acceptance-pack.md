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
  requirements whose cited tests give it, and those tests' results. The parts, joined, are the
  specification's words exactly, so no part of a pack's evidence is left out.

It accepts nothing. A pack is accepted only on all of its evidence and the owner's approval. A
citation never accepts a requirement (decision 0010), and a pack whose every scripted part passes
still waits for the rest. The placing of each part is a reading for the owner to check.

CI's evidence job runs it after the readiness report, keeps `acceptance-pack.json` as the
`acceptance-pack` artifact, and adds a table of the parts to the run's summary.

## Where each pack stands

| Pack | A script gives it today | Not yet scripted | The owner | A person |
| --- | --- | --- | --- | --- |
| UAT-01 Free journey | correct output and stored revision | the recorded journey, on a phone and a desktop | | |
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
| 2 | **The recorded journey:** the free journey in a browser, on a phone and on a desktop, kept as recordings with its output and stored revision. | UAT-01 |
| 3 | **Golden samples:** each guided template's files compared with kept samples. | UAT-03 |
| 4 | **The restore drill,** with the finishing plan's backup row: capture, archive, restore and replay end to end, asserting the recovery point and time. | UAT-08 |

The readiness report and the status page list each pack as blocked; this command adds the evidence
beside them, and nothing changes a pack's status.
