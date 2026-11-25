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
