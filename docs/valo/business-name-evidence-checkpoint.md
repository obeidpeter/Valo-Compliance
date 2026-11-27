# Narrow business-name candidate: source preparation

This is implemented source ingestion/preparation, not a released legal recommendation or completed R1/R2.

The official URLs recorded in [issue4](https://github.com/obeidpeter/Valo-Compliance/issues/4) were actually fetched through the application's allowlisted, public-address-pinned HTTPS transport. Four complete raw/text snapshots were written to private App Storage and their identifiers/checksums retained in `evidence/business-name/retrieval.json`. Customer drafts were not used. The live source registry includes the three newly allowlisted references alongside the existing CAC CAMA reference.

`evidence/business-name/candidate.json` contains exact extracted passages and locators:

- CAMA814(1) and all814(2), printed A405–A406/PDF405–406. Individual, firm and corporate name-composition distinctions; succession-only addition, shared-surname plural and court-appointed receiver/manager exceptions are mandatory. Section815 and its deadline are excluded.
- The actual CAMA20 text references **sections281 and283**, not simply “section283”. Its quote is retained as dependency context, not formation-capacity guidance.
- The official NIPC Business Facilitation Act, Schedule Part I, printed A103–A107/PDF9–13, includes the amendment to CAMA283. Reviewing this instrument is not proof that no other amendment or controlling judgment exists.
- Copyright Act3(b), official NCC copy, printed A184/PDF8, includes “except their compilations”. This is scoped statutory-passage rights evidence only, not blanket clearance for websites, commentary, compilations, AI outputs or account/provider terms.
- The current fetched CAC business-name process page provides registration steps and self-registration text. No fee amount, processing guarantee, marketing count or professional endorsement was inferred.

The preparer verifies retained text hashes, exact printed/PDF locations, section boundaries, all exceptions and the amendment dependency before constructing the candidate. Missing/altered/stale evidence fails. An original PDF's availability does **not** establish legal currentness. Retrieval freshness checks use a 30-day technical preparation ceiling, not a statutory period or a replacement for editorial freshness policy.

The candidate remains **held**: complete currentness, independent factual/challenge reviews, final scoped rights assessment and the exact publication manifest are not complete. It is not inserted into the released-rule registry and cannot drive customer recommendations or statutory reminders. Future customer questions must preserve unknown/unanswered/not-applicable distinctions. A negative result may concern only this business-name rule, never all SME registrations or duties.

The requirements execution matrix now links the verified implementation/review issues3–7. R2 links are explicitly future extensions, not completed R1 criteria. Existing source text/127 IDs are unchanged. No issue or gate is accepted just because it has a code link.

## Reproduction

```sh
NODE_ENV=development VALO_RUN_SOURCE_RETRIEVAL=official-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/ingest-business-name.ts
NODE_ENV=development VALO_RUN_SOURCE_RETRIEVAL=official-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/prepare-business-name.ts
pnpm --filter @workspace/api-server run test:valo-sources
```

The first command performs real official retrieval and stores raw/text bytes privately. The second reads those persisted snapshots, validates their hashes and probes both raw/text objects for authenticated checksum equality and anonymous denial. Generated operator text stays outside Git; only bounded research passages, hashes, results and identifiers are retained in the private repository.

Actual results and source revision are recorded in `evidence/business-name/checkpoint.json`; no professional review, currentness certification, public launch, live payment or full80/60/60 acceptance is claimed.
