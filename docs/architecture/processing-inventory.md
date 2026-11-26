# The processing inventory

Design for the finishing plan's Phase 7 row "The processing inventory", for PRV-001 and PRO-002. It is a
proposal under the owner's delegation of 24 November. The inventory and the notice it produces are
drafts for the privacy owner: what they say about lawful bases, recipients and retention is a proposal
for that owner to decide, not legal advice, and not a review by a privacy professional.

The requirements, verbatim from the specification:
- PRV-001: "Record purpose, lawful basis, data categories, subjects, recipients, retention and
  processors for accounts, drafts, orders, AI and support. Accept: the privacy notice reflects actual
  production processing and optional consent is not bundled with required service terms."
- PRO-002: "Separate necessary processing notices from optional marketing consent; support profile
  correction, account export and deletion requests. Accept: the user can decline marketing and still use
  the product; consent versions and changes are recorded."

## What there is

- **The privacy page** is a four-paragraph development note. Nothing ties it to what the code stores.
- **The processor review** (`docs/valo/processor-review.md`) lists each outside service, what the code
  sends it, and what is not verified: regions, retention and contracts.
- **Consents.**
  - Marketing consent is a field of the business profile (`marketingConsent`), off by default. Each
    profile revision keeps its value, but not the wording the person agreed to.
  - The reminder opt-in (`valo_reminder_preferences`) records a consent version, but is changed in
    place, so its history is lost.
  - A support request records its sharing consent and the version of its wording.
- **Requests.** Profile correction, the data download and deletion requests exist (the privacy cases).
  A workspace's erasure does not yet remove its edition notices ([editions](editions.md)).

## The parts

### Part 1: the inventory

- **One record in code.** The inventory is a typed list in `lib/valo-core`, so that the API, the web
  app and the tests read the same record. Each processing activity names:
  - its purpose, in plain words;
  - the proposed lawful basis, as the Nigeria Data Protection Act 2023 names the bases: consent, a
    contract, a legal obligation, vital interests, a public task or legitimate interests;
  - the categories of data and the people they are about;
  - who receives the data: Valo's staff and each outside service, by its entry in the processor review;
  - how long it is kept, or "not decided" where the owner has not decided;
  - whether it is optional, and if so the consent that starts and stops it;
  - the database tables that hold it.
- **Checked against the code.** A test fails when:
  - a table in the database schema is named by no activity and is not on the short list of tables that
    hold no personal data, each with its reason;
  - an activity names a table that does not exist;
  - an activity names an outside service the processor review does not list, or one the review says
    receives no customer data;
  - an optional activity has no consent, or a required one depends on a consent.
- **Activities.** Accounts and sign-in; the business profile; documents, drafts and their files; the
  requirements check and its tasks; reminders; orders and payments; the drafting assistant; support;
  privacy requests; security and abuse prevention; and staff work and its audit.

### Part 2: the notice, made from the inventory

- The privacy page is rendered from the inventory, activity by activity, in plain words, with its
  version: a checksum of what it shows. Optional processing is set apart from what the service needs.
- It keeps saying it is a draft until the privacy owner approves its exact wording, as the guidance
  policy is approved by its checksum.

### Part 3: the notice where data is collected

- Sign-up, the business profile, a support request and the drafting assistant's consent link the notice,
  and the record each one saves keeps the version of the notice that was shown.

### Part 4: consents with their versions and history

- Marketing consent and the reminder opt-in each keep every change: who, when, what was chosen and the
  version of the words agreed to. Declining either changes nothing else a person can do.

### Part 5: erasure

- A workspace's erasure removes its edition notices, as it removes its other rows.

## What does not change

- No processing starts or stops. No message is sent. No real data is used: tests are synthetic.
- The processor review stays the record of each outside service. The inventory points to it.

## The slices

Each slice is its own pull request.

| # | Slice | Requirements | State |
| --- | --- | --- | --- |
| 1 | **The inventory.** This design, part 1, and its tests against the database schema and the processor review. | PRV-001 | Built |
| 2 | **The notice.** Part 2: the privacy page from the inventory, with its version, and its browser test. | PRV-001, PRO-002 | Built |
| 3 | **The notice where data is collected.** Part 3, with a migration for the version each record keeps. | PRV-001, PRO-002 | Not started |
| 4 | **Consents.** Part 4, with a migration for the consent history and its upgrade test. | PRO-002 | Not started |
| 5 | **Erasure.** Part 5, with a database test. | PRV-003 | Not started |

## Settled while building it

### Slice 1: the inventory

- **Staff tables.** The test's check for columns that name a person found three tables that record a
  member of staff (the publication audit, source impacts and source review preparations), which the
  first draft had listed as holding no personal data. They belong to the staff activity.
- **Recipients.** An activity names only the services that may receive personal data. The processor
  review says Healthchecks.io and GitHub receive no customer data, and the test fails when an activity
  names either.
- **Support's retention.** A verified deletion request replaces the words of a person's support
  messages and keeps the case and its record, as erasure does.

### Slice 2: the notice

- **Where it lives.** `lib/valo-core/src/privacy-notice.ts` makes the notice from the inventory
  (`buildPrivacyNotice`), so the privacy page and, from slice 3, the API read the same words. The page
  (`artifacts/valo/app/(public)/privacy/page.tsx`) only lays them out.
- **What it shows.** For each activity: its purpose, what it holds, whom it is about, its proposed
  lawful basis and why, who at Valo reads it, the outside services it reaches, and how long it is kept.
  What the service needs comes first. What a person may choose comes after it, each with how they
  choose it, and marketing messages are a choice of their own there: off unless turned on in the
  business profile, and none sent. Then the outside services, with what is not yet checked about them,
  the backups, and where a person downloads, corrects or deletes their data, or asks without signing in.
- **Its version.** The SHA-256 of the notice's content as JSON, so that any change to a word changes it.
  The page shows its first twelve characters. Slice 3 keeps the whole version with each record.
- **Draft until approved.** `privacyNoticeApproval` is empty, so the page says the notice is a draft,
  not approved by the privacy owner, not reviewed by a privacy professional and not legal advice. Only
  the privacy owner sets it, to the exact version they approve; a later change to any word makes the
  notice a draft again.
- **Words about downloads.** The inventory said downloaded files are removed after their retention
  date. Shown to a customer, that could read as taking back a copy they saved, which EDT-010 forbids.
  It now says the files Valo keeps for download are kept at Valo only until that date, and a copy a
  person has saved stays theirs. The customer wording check reads the inventory and the notice from now
  on.

## The owner's points

1. Each lawful basis, recipient and retention period the inventory proposes.
2. The notice's exact wording, approved by its version (`privacyNoticeApproval`).
3. The regions, retention and contracts the processor review lists as not verified.
4. Whether the notice should name a way to complain to the Nigeria Data Protection Commission. The draft
   names none: no official source for it has been checked here.
