# The guidance record

The finishing plan's Phase 3 row "The guidance record" (CMP-001). CMP-001 asks Valo to "Record
authority, jurisdiction, activity/legal form, conditions, action, evidence, source, effective period,
AI-review status and related templates", and accepts it when "missing authoritative evidence, scope or
review manifest blocks publication of the affected claim; a human reviewer is not a required field."
The regulatory guides released today keep their text and sources, and nothing else of that record.

## What there is today

**The drafts.** The 30 regulatory guides are drafted in four files under `docs/content-candidates/`,
each pinned by its SHA-256 in `r1-content-intake-manifest.json` and kept byte for byte. After each
guide's customer text come its editorial lines, in its file's own form:

| Guides | Their editorial lines |
| --- | --- |
| GUD-01 to GUD-10 | "Authority / sources", "Applicability", "Material claims", "Effective facts / exclusions" and "Action / evidence", whose line ends with "Related content" |
| GUD-11 to GUD-18 | One "Metadata" line: "scope=", "required facts=" and "Related template(s)=", and a claim table |
| GUD-19 to GUD-26 | One "Internal claim map" paragraph. Two of the eight say whom the guide applies to |
| GUD-27 to GUD-30 | An "ID" line with the topic, risk and jurisdiction, then "Audience condition", "Related templates", the claims and the mandatory holds |

**What is kept.** The staff library files each guide as a regulatory article with its title and
customer text, and leaves the editorial lines out: its table has no field for any of them. The
owner's source check keeps the sources the guide's claim map cites (address, title, locator, the bytes'
checksums and how long the reading stays valid) and the holds. The reviewed route keeps one line,
GUD-01 to GUD-10's applicability, as an assumption of its candidate, which its page then drops.

**What the claim maps hold.** Each guide's claim map binds its sentences to passages of registered
official instruments. Each instrument has its issuing body and the day it took effect, as its text
prints it. The source check does not keep them.

**The page.** A released regulatory guide's page shows its text with its sources' links, when its
sources were checked, the sources, a fixed "What it covers" and "Limits you should know", the
disclosure that it was released on the owner's sign-off, and what changed in this version.

## What changes

### 1. The record of a regulatory article (CMP-001)

A regulatory article in the staff library keeps its record with its text, as a template keeps its
entry details ([library entries](library-entries.md)):

| CMP-001's field | Where it comes from |
| --- | --- |
| Activity, legal form and conditions | **Who it applies to**, in up to 800 characters: whom and when the guide concerns. |
| Action and evidence | **What to do and keep**, in up to 800 characters: the steps a business takes and the records that show them. The drafts write the two together, so the record keeps them as one. |
| Related templates | **Related templates**: up to six registered template numbers. The page links each one only while a version filed as it is released. |
| Authority and effective period | Each source's issuing body and the day its text took effect, from the claim map's instrument, kept with the source check's sources. |
| Jurisdiction | Nigeria, as the claim map records it for every source. |
| Source | The source check's sources, as today. |
| AI-review status | How the version was released: on the owner's sign-off after a check of its official sources, and not reviewed by AI. |

- The retained drafts' loader fills the first three from each draft's own editorial lines, word for
  word, where its form has them: "Who it applies to" from GUD-01 to GUD-10's applicability, GUD-11 to
  GUD-18's scope and required facts, GUD-27 to GUD-30's audience condition and the two food guides that
  say it; "What to do and keep" from GUD-01 to GUD-10's action and evidence; and the template numbers
  GUD-11 to GUD-18 and GUD-27 to GUD-30 name. A test checks that every word it fills is in the pinned
  draft. Nothing is written for a draft that does not say it.
- A Content editor edits them as the rest of a draft, and they cannot change once saved. The owner's
  panel shows them with the text the owner signs.
- **A regulatory article is released only with whom it applies to** (CMP-001's scope). Its sources and
  the owner's sign-off are required already: the source check is the authoritative evidence, and the
  check and the sign-off are its review manifest. A human reviewer is not a field.
- The database enforces it, as it does a template's details: the release of a regulatory article
  without "Who it applies to" is refused. A version released before this change stays as it is; its
  next version needs the record.

### 2. The page shows the record (CMP-001)

A released regulatory guide's page shows, from the version and the check it was released on:
- "Who this is for", in place of the fixed "What it covers";
- "What to do and keep", where the version has it;
- each source's issuing body and the day its text took effect;
- the related templates that are released, as links;
- how it was released, as the disclosure does today.

The record is read with the version and its check, so the page shows what the owner signed, even when
the next day's check reads the same sources again.

## Settled while building it

Slice 1:
- The record is three columns of the staff library's revision, which only a regulatory article may fill
  (`valo_manual_guidance_record`): whom it applies to and what to do and keep in up to 800 characters
  each, and up to six registered template numbers, TPL-01 to TPL-40. They join the version's digest only
  when given, so every earlier version keeps its digest, and like the rest of a version they never change
  once saved.
- The database refuses the release of a regulatory article that does not say whom it applies to, before
  it checks the owner and the source check as before. The owner's panel shows the record with the text,
  offers no sign-off until the version says it, and the sign-off route refuses it with why (409).
- The loader takes each field from the guide's own pinned draft, without Markdown's emphasis marks:
  GUD-01 to GUD-10's "Applicability", and their "Action / evidence" up to "Related content", which names
  guides; GUD-11 to GUD-18's metadata from its scope up to its related templates; the claim map's
  "Applicability" or "Scope" sentence of GUD-20 and GUD-23; GUD-27 to GUD-30's "Audience condition"; and
  the template numbers the related templates lines name. So 24 guides are filed with whom they apply to,
  10 with what to do and keep, and 12 with related templates. GUD-19, GUD-21, GUD-22 and GUD-24 to GUD-26
  get nothing, and the drafts panel says a Content editor writes it.
- A guide already filed without its record gets it with "File the proposed records", as a new draft
  version of the same text, which the owner then signs. Filing releases nothing.
- Each source of a new source check keeps the body that issued it and, for an Act or a regulator's
  document, the day its text took effect, from the claim map's instrument. A web page says what it says
  when it is read, so it has no such day. Neither joins the check's evidence, so a guide signed before
  keeps showing.
- The public pages read none of this yet: slice 2 shows it. A database the migration has not reached
  keeps its public pages as before, while the staff library and the owner's panel ask for the migration.

## What does not change

- The text, its claim map and the owner's source check, and which guides can be released.
- The evidence the owner signs. The record is part of the version, which the owner signs. The sources'
  issuing bodies and dates sit beside the checksums the evidence binds, not in them, so a guide released
  before this change keeps showing.
- The reviewed route, whose candidate keeps its assumptions as before.
- Practical guides, industry introductions and packs, which state no law.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The record.** A migration adds the three fields to the staff library for regulatory articles, refuses a release without "Who it applies to", and keeps them unchanged once saved, with its upgrade test and runbook. The draft route and the editor take them; the loader fills them from the drafts, with a test against the pinned files; the owner's panel shows them. The source check keeps each source's issuing body and the day its text took effect. Tests: a release without the scope is refused, the record is kept and never changed, and the loader's words are the drafts' own. | CMP-001 |
| 2 | **The page.** The guide's page shows the record, the sources' issuing bodies and dates, the released related templates and how it was released. Tests: the page and its words, and a browser check. | CMP-001 |

## The owner's points

1. **The record's words.** The loader fills them with the drafts' editorial lines, which are written
   for staff ("Unknown material facts → More information needed"). A Content editor puts them in
   customer words before the owner signs; the owner signs the words the page shows.
2. **Six guides need their scope written.** GUD-19 to GUD-26's drafts say whom they apply to for two of
   the eight only. The other six cannot be released until a Content editor writes it. The drafts stay
   as they are, byte for byte.
3. **A guide released before this change** keeps its page and shows no record until its next version.
4. **The words** of the page's new headings.
