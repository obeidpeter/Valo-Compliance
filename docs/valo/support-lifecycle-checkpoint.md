# Durable support lifecycle

This change connects the existing saved support intake to private customer and staff workflows. It implements the support lifecycle portions of SRV002, ADM008 and WRK006; it does not establish full R1 acceptance or send an external message.

## Recorded behaviour

- Workspace and account-access intake create a case in the same transaction, preserving the original reference, scope and consent. Migration `0039_support_lifecycle.sql` (first numbered 0033) backfills existing intake as open cases without inventing assignment, replies or resolution.
- Customers can read and reply only within their current, non-erased workspace. Replies reopen resolved conversations. Staff with a current, unexpired support role and recent server-verified MFA can assign an active support colleague, reply, resolve or reopen a case. Anonymous account-access responses stay internal because the original intake does not establish account ownership.
- Every mutation binds a request UUID, actor, payload and expected case version. Exact retries reuse the durable action; changed intent or a stale version conflicts. Replies, assignment and state transitions commit with append-only case events. A customer sees portal replies; internal content-triage notes and staff assignment identities are excluded.
- Support can refer an exact content or rule record, version and hash to content staff. Internal triage does not depend on consent to share information with an outside adviser. It grants no content-hold or publication authority. Content staff may acknowledge, close triage, or explicitly invoke the existing source-control authority to hold that exact version and queue reassessment. Closing triage never approves publication or releases a hold.
- The source hold and its review queue are independently durable. If final support persistence fails, retrying the original key recovers the existing source audit and links its impact, including after an intervening customer reply or triage closure. It does not issue a second hold with a replacement key. Source audit contains a reference and payload digest, not the private complaint text.
- Lists and conversations are paged. Customer export includes only the customer's case summaries and visible replies. The existing support-content erasure phase redacts private reply and complaint text, anonymizes customer reply authors, and clears original intake scope/contact copies using one shared 100-row budget. Minimal case and audit references remain. Existing privacy phase indices remain unchanged.

The UI preserves drafts on errors, keeps the same request key while an outcome is unknown, blocks accidental navigation with unsaved work, and requires a refreshed version after a conflict. A successful response must identify the submitted case or escalation and a version newer than the submitted expectation. A confirmed hold additionally requires a durable source-impact UUID. Malformed successful responses remain uncertain rather than clearing the draft.

## Validation and limits

The focused UI contract suite passes locally (7 tests). Full repository typechecking remains part of the pending integrated CI run; this sparse local checkout lacks some UI dependency aliases. The PostgreSQL suite is registered for disposable local CI PostgreSQL, with actual intake, role/MFA checks, assignment and reply state transitions, append-only events, account isolation, actual HTTP routing, content-authorized source hold, deliberately failed support completion and exact-key recovery, paging and export coverage. The privacy integration test seeds 203 replies in one conversation plus a complaint and original intake copies, then checks that three bounded batches clear private text without advancing the phase early; minimal case references remain. These database results remain pending until the branch's actual CI run succeeds.

The controlled browser harness exercises the real React components with synthetic API transport; it is registered in CI. Local browser execution was unavailable because this execution environment disallows Chromium sockets, so no local browser pass is claimed.

This code depends on the shared staff authority checks and on PR 29's source controls (migration 0037). Migration 0039 is new and has not been applied to native Replit; see [migration-0039.md](migration-0039.md). Private branch review and CI do not authorize native application, deployment, provider spending, external referral, email delivery or publication. All finite-inference approval and shared-budget restrictions remain unchanged.

## Port into the working branch (2026-11-17)

PR 31 was merged into the working branch and adapted:

- Its nine routes are in the OpenAPI contract. The server validates path and query
  parameters with the generated schemas and parses every response with them, so
  a customer response cannot carry staff-only fields. Request bodies keep the
  service's stricter schemas (unknown keys rejected, text trimmed). The web client
  calls the generated functions and encodes identifiers in paths.
- The contract-driven tests now cover the routes: another workspace's case
  identifiers are refused like unknown ones, and every staff route refuses
  customers and anonymous callers.
- Migration 0039 uses the Drizzle snapshot's constraint names and declares every
  check in the schema.
- After a content triage action the screen keeps the referral's case reference;
  the action result does not include it.
- The support erasure batch shares one 100-row budget with payment concern copies.
- Test fixtures follow the current staff grant rules: only a time-limited emergency
  grant can expire.
- CI runs the UI and browser checks in the main job rather than a separate one.

In this port the UI suite (7 tests), the browser harness, the PostgreSQL suite
(11 tests), the cross-tenant tests and the erasure tests pass locally.
