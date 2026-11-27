# What to do in a security or privacy incident

The steps behind the "Security/privacy incident" runbook in [operating-runbooks.md](operating-runbooks.md)
(SEC-008, PRV-003; [design](../architecture/incident-response.md)). It is a development baseline written
under the owner's delegation. It is not a staffed or exercised response: the roles below are roles, not
named people, and no tabletop has been held. It is not legal advice.

## When it applies

- **An alert under the "Security/privacy incident" runbook:** `DENIED_ACCESS`, `SIGNATURE_FAILURES`,
  `SPREAD_REFUSALS`, `LIMITED_CALLERS`, `REFUSED_INPUT`, `ROLE_CHANGES`, `BULK_EXPORTS`, `AI_ACTIVITY`,
  `AI_SPEND`, `WORKSPACE_DOWNLOADS`, `STAFF_COPIES`, `GUARD_REFUSALS`, `PRIVILEGED_READING` or
  `HISTORY_INTEGRITY`, raised or with its probe unavailable. The operations probe writes them to the
  worker's alert file (`artifacts/api-server/generated-artifacts/valo-operations/alerts.json`); run
  `pnpm --filter @workspace/api-server run valo:operations-probe` to read them now.
- **A report** from a customer, a member of staff or an outside service that someone saw, changed or
  removed data they should not have, or misused Valo's sign-in, payments or drafting assistant.
- **When in doubt,** treat it as an incident. Closing one that turns out to be nothing costs little.

## Who

- **The incident lead** runs the response, decides each containment step, keeps the record and calls
  the others. The lead holds a permanent System assignment.
- **The privacy owner** decides everything about personal data: whether it was affected, who is told,
  what they are told, and whether the authority is contacted. PRV-003: "the privacy owner owns incident
  decisions".
- **Privacy staff** hold workspaces and handle the affected people's privacy requests.
- **Support staff** answer the affected people who write in.
- **The owner** approves any message outside the app, any spending and any change to production.

The owner names who holds each role, outside this public repository.

## 1. Open the record

- Start the incident's record outside this repository and outside customer logs, in the place the owner
  names. Write when it began, when and how it was noticed (the alert's code, or who reported it), and
  who is leading.
- Write the time and the person for each step that follows.
- Write only what is needed. Name customers' records by their identifiers. Never copy a customer's
  documents, messages or answers into the record, a chat or a ticket.

## 2. Contain

Take the smallest step that stops the harm, with a reason each time: each lever records who used it,
when and why.

| What is at risk | The step | Where |
| --- | --- | --- |
| A member of staff's access | Revoke the assignment. It is refused from the next request. Emergency access also ends by itself after at most 60 minutes. | `/staff`, System area, staff role administration |
| A person's sign-in | End the account's sessions at the sign-in provider. | The provider's dashboard, outside Valo |
| The drafting assistant or checkout | Pause the service. Only new work of that service is refused: free guidance, saved documents and completed purchases stay available. | `/staff`, System area, service safety pauses |
| A wrong or harmful template, guide or rule | Hold or withdraw its version. | `/staff`, Content area, source checks and version safety |
| A workspace whose data must stay as it is | Hold the workspace. Valo's own deletion of its data stops until another member of privacy staff releases the hold. | `/staff/privacy`, holds on workspaces |
| A secret or key | Replace it in the server's secret store and at the provider. No replacement has been rehearsed. | The host's secret store |
| The whole service | Stop it, or restore a backup, only through the approved platform path, with the owner. | The "Site/database unavailable" runbook |

## 3. Preserve evidence

- **Do not delete anything.** Hold the affected workspace before anything removes data that matters,
  and run no cleanup by hand.
- **Leave the histories as they are.** The audit trail, staff reads, role changes, safety pauses,
  privacy requests and holds refuse changes and removal, and each keeps a digest. Read them in the
  System area's audit history. The hourly count raises `HISTORY_INTEGRITY` for any history whose
  digest no longer matches its rows.
- **Copy what does not last.** Security signals are kept for a day, the alert file keeps a bounded
  list, and request logs follow the host's retention. Copy the alert entries, and the times and request
  identifiers of the log lines that matter, into the record. Copy no private data.
- **Backups** hold every record for 35 days (the owner's approval of 20 November 2026). If an earlier
  state matters, tell the owner while it is still held. A restore goes only through the approved
  platform path.

## 4. Assess, and escalate to the privacy owner

- **Bring in the privacy owner at once** whenever personal data may be involved, before it is certain.
- **The privacy owner assesses** whose data it was, what kind, what happened to it (seen, changed,
  removed or sent outside Valo), and the likely harm to the people it is about.
- **No time limit is given here as the law's.** PRV-003 requires retrieved statutory evidence and AI
  checks for any notification trigger or deadline. Neither has been done, so this procedure names no
  period for telling the authority or the people affected.
- **When unsure, contact the authority.** If the privacy owner is unsure whether the law requires
  telling the authority, the Nigeria Data Protection Commission, or by when, the privacy owner assesses
  at once and contacts it, rather than waiting or assuming a deadline. PRV-003: "Uncertainty prompts
  immediate assessment and authority contact, not an invented deadline." The owner keeps the
  authority's contact route with the other private contacts.
- **Record each decision,** who made it, when, and what it rested on.

## 5. Tell the people affected

- The privacy owner decides who is told and what they are told. The owner approves any message outside
  the app.
- **Inside the app, today:**
  - support staff answer a person on a support request they opened (`/staff`, Support area, reply);
  - privacy staff answer a person on their privacy request (`/staff/privacy`).
- **Outside the app:** Valo sends no email yet. An email, a text or a public statement needs the owner's
  approval of the channel and of its words.
- **Say plainly** what happened, what it means for them, what Valo has done, what they can do, and how
  to reach Valo. Do not guess, do not give a time limit as the law's, and do not blame anyone.
- **Keep a copy** of each message, and when and to whom it went, in the record.

A starting draft, to change for each incident:

> We are writing about your Valo account. On [date], we found that [what happened, in one sentence].
> It affected [what of yours]. It did not affect [what was not affected, if known].
>
> What we have done: [for example, we stopped the access and are keeping your workspace's data as it
> is while we look into it].
>
> What you can do: [only what helps, for example, check your saved documents].
>
> If you have a question, reply to this message, or write to us from the contact page.

## 6. Recover

- Undo each containment step only once its cause is fixed, with a reason: remove the safety pause in
  the same place, grant a fresh assignment through staff role administration, and have another member
  of privacy staff release the hold.
- Check that the histories still match their digests and that the alerts that started the incident
  have cleared.

## 7. Review

- Write what happened, when, what worked, what did not, and what will change. Keep it with the record,
  and add the changes to the plan. The owner sets the period for writing it; none is set yet.

## Rehearsing it

- **The tabletop:** [incident-tabletop.md](incident-tabletop.md) takes the people above through one
  incident. It has not been held.
- **The rehearsal in CI:** the database test "an incident rehearsal on synthetic data detects the
  refusals and the role change, contains them, keeps the workspace's data and the histories as they
  are, and answers the person affected in the app without sending anything"
  (`artifacts/api-server/src/modules/operations/incident-rehearsal.integration.test.ts`) takes the
  technical steps of the tabletop on a disposable database. It shows that the levers work as this
  procedure says. It is not a tabletop, and it accepts nothing.
