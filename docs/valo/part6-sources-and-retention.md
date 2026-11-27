# Part 6: exact sequence, proposed retention and real source collection

This increment does not pass P0/G0, accept R1, unlock R2, authorise real customer
data or enable live commerce/public launch. R3 remains excluded.

## Source contracts

`docs/registers/final-source-context.json` and its generated typed projection
preserve roadmap sections 02–05, all seven original retention proposals and all
24 S01–S24 references, with exact baseline text and original source hashes.
The original calendar, human staffing/week estimates and expenditure are
planning assumptions. No budget or delivery date was invented.

The master execution prompt authorises actual engineering; earlier source
document preparation language is not interpreted as a prohibition on this
commissioned implementation. Unavailable Nigerian specialists do not block
general content publication; mandatory EDP evidence/review/mechanical gates do.
Content publication authority does not grant production, payment, procurement,
privacy or operational acceptance.

## Implemented collection behaviour

- Development-only operator command, fixed S01–S24 allowlist and bounded three-way
  concurrency; no customer-controlled fetch URL or HTTP trigger.
- HTTPS with normal certificate verification, no credential forwarding,
  same-host redirects only, maximum three redirects, IPv4 public-address checks
  and connection-pinned DNS. IPv6-only sources are unavailable rather than
  silently weakening this policy.
- An eight-MiB source-body ceiling, five-second DNS bound and fifteen-second
  per-request bound. Renderer/parser and storage have separate limitations;
  these are not a proved production sandbox or total process resource limit.
- Full received raw bytes and extracted text retained separately in private App
  Storage with read-back SHA-256 verification. A new UUID namespace is used
  for every attempt; the collector cannot accept customer document object keys.
- PostgreSQL append-only service methods retain attempt/response dates, HTTP
  status, MIME, source URL/final URL, extraction version, locators, hashes,
  private references and failures. Application code offers no snapshot update
  operation. Database administrator tamper resistance is not claimed.
- HTML is parsed with scripts/service workers disabled and all browser network
  requests aborted. PDFs use bounded `pdftotext` extraction with temporary-file
  cleanup. Challenge/empty/insufficient text is held. Retrieved text is untrusted
  data; it has no tools and cannot alter publication policy.
- `/api/development/source-evidence` and
  `/development?view=sources` expose current recorded state without private
  object locators or raw source bodies. They distinguish the original baseline
  notes from this run, retrieval from source checking/AI review, and proposed
  retention from enacted policy.

These development boundaries are not proved credential separation: the current
project database/storage credentials still have project-level scope. Separate
least-privilege service roles and deployment isolation remain mandatory gates.
Source collection alone supplies neither claim maps nor rights or AI approval.
No candidate has been published or labelled AI reviewed.

## Actual original-link run

`evidence/part6-source-retrieval.json` records all 24 direct-origin attempts:

- 17 raw-plus-text captures were stored and checksum-checked, still unreviewed.
- S02 exceeded the eight-MiB body ceiling; no complete instrument was retained.
- S04, S05 and S06 returned HTTP 403; NDPC operative text remains held.
- S16 and S17 returned HTTP 403; this run does not validate Paystack signing or
  transaction verification behaviour. Payment implementation must recheck the
  current official webhook and verification documentation and configured mode.
- S22 returned HTTP 200 but insufficient static text, not a successful evidence
  extraction.
- Zero source/rights approvals, separate AI reviews or publications resulted.

S07's successful retrieval does not establish that historical NAFDAC concessions
are current. S01/S03 or a source overview does not establish universal duties.
S24 is voluntary AI risk guidance, not Nigerian law or certification.

## Migration finding

The reviewed generated `0003` adds only the source snapshot table/index.
Development `drizzle-kit push` created both but subsequently reported that the
existing document composite unique index already existed; the CLI again exited
zero despite the error. Catalog inspection confirmed the new table/index before
any collection ran. Source integration tests exercise the real table and
historical-state behaviour; the push itself is **not** recorded as passed.
No force-push, destructive DDL, production migration hook or alternate database
was introduced. Clean end-to-end schema replay/staging remains blocked under
OPS-003; retain the SQL and failure evidence rather than infer a clean migration.

## Retention and recovery

All seven periods remain proposals requiring G0 policy approval, not statutory
periods or enabled cleanup jobs. In particular, no 35-day backup guarantee,
seven-year statutory retention assertion, deletion schedule or automated
tombstone restoration has been enabled.

Official Replit documentation was queried again; see
`evidence/part6-platform-documentation.json`. Documentation and source snapshots
do not prove account-specific retention, deployed worker access, data geography,
production queue migrations or recovery. No database dump/shadow backup was
built and no customer records were restored/deleted.

## Reproduce development checks

```sh
pnpm --filter @workspace/scripts exec tsx src/valo/sync-final-context.ts
pnpm --filter @workspace/api-server test:valo-sources
NODE_ENV=development VALO_RUN_SOURCE_TESTS=official-development-only pnpm --filter @workspace/api-server test:valo-source-db
VALO_RUN_SOURCE_RETRIEVAL=official-development-only pnpm --filter @workspace/api-server sources:retrieve-development
```

The collection command writes new immutable evidence attempts and performs real
official-site requests/private-storage writes. Do not rerun it just to reproduce
the UI; its persisted results already survive refresh and API restart.

## GitHub and remaining prerequisites

The authorised GitHub App GET again returned `private:false`,
`visibility:public` for the intended repository; the compact observation is
`evidence/part6-github-status.json`. No source upload, visibility change, paid
upgrade or protection change was attempted. Owner restoration/confirmation of
private visibility is required before source synchronisation can resume.

The existing identity/storage development configuration is not an end-to-end
identity/recovery acceptance result. Model configuration, source/AI operating
policy and budget, transactional email sender/provider, sandbox merchant
configuration, commercial/privacy decisions, staging/deployment compatibility,
disaster restore and independent security/usability proof remain unaccepted.
No credential value is requested or retained in this handover.
