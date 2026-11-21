# Valo dependency triage — research note

Reviewed 13 November 2026 against commit `00405603728570bd66c6caaae9c3bb145d47cc2a` and its retained dependency scan. **Unfixed at that commit.** This is dependency-path and reachability research, not a reproduced exploit, independent security acceptance or release approval. No application code or dependency was changed by this review.

## Scope and counts

The retained scanner reports **22 package-version/advisory findings: 10 high, 10 moderate and 2 low**, with zero critical. These represent **21 distinct advisory identifiers across eight package names**: the same Zod advisory appears against two installed versions. They are not 22 demonstrated vulnerabilities reachable through Valo. Scanner severity and maintainer severity can differ; preserve both rather than silently changing the historical scan.

Paths below are reconstructed from `pnpm-lock.yaml` importers and dependency snapshots at the reviewed commit. Build-time classification does not establish that packages are excluded from the eventual deployment: verify the deployed dependency graph. Node's built-in fetch/Undici version also requires its own runtime inventory; the npm lockfile does not establish that version.

## Prioritized repairs and acceptance checks

| Priority | Installed path | Assessment and targeted acceptance |
| --- | --- | --- |
| 1 — request parser | `artifacts/api-server` → `express@5.3.0` → `body-parser@2.3.0` | JSON parsing runs before identity verification. The maintainer describes a compressed-request trailing-data crash before routing. Resolve a compatible `body-parser >=2.4.0`; reject compressed bodies if not required. In an isolated test process, malformed compressed requests must not terminate the server; retain normal JSON, malformed JSON, 128 KiB rejection and authentication tests. Existing body-size limits alone do not fix this decoder lifecycle issue. |
| 2 — runtime validation | `artifacts/api-server`, `lib/api-zod`, `lib/db`, `lib/valo-core` → direct `zod@3.25.76`; `lib/db` → `drizzle-zod@0.8.3` → same Zod. `lib/integrations-openai-ai-server` → `openai@6.49.0` → resolved `zod@4.6.5`. | Plan a compatible migration to patched Zod `>=4.6.6`, with regenerated API validators and Drizzle/OpenAI compatibility checks, rather than a blind major override. Old collection maximum checks can run after element validation. Confirm early rejection of oversized collections, bounded validation-error responses, preserved strict schemas/unknown-value semantics, and unchanged valid document/profile parsing and revision hashes. The 128 KiB HTTP cap reduces exposure but does not itself establish bounded validation cost. Verify the actual Zod entry point: retaining an unchanged legacy v3 implementation inside a newer package does not prove the fix. |
| 3 — Next.js build dependency | `artifacts/valo` → `next@15.5.29` → `postcss@8.4.31` | Replace this nested copy through a compatible parent/resolution with patched PostCSS `>=8.5.23`. Direct `postcss@8.5.32` and Tailwind's same patched copy already exist but do not replace Next's pinned copy. No customer-supplied CSS processing path was identified; ordinary source builds and preview/development use must be distinguished from an exposed CSS service. Require production build, styles/layout checks, and proof that the vulnerable nested resolution is gone. |
| 4 — API generator | `lib/api-spec` dev dependency `orval@8.41.0` → `@scalar/json-magic@0.15.6` → `undici@7.29.1`; Orval also reaches JSON Magic through `@scalar/openapi-parser@0.29.12`. | Resolve the generator chain to compatible Undici `>=7.30.1` within its supported major. Test API generation and remote-reference handling. Do not label these eight findings as customer-auth/runtime TLS bypass without tracing a runtime import. The TLS callback finding requires custom function-valued TLS options; cache, EventSource, WebSocket and interceptor findings have their own feature prerequisites. Verify production exclusion of generator tooling and separately inventory runtime Node. |
| 5 — API generator URI handling | `lib/api-spec` → `orval@8.41.0` → `@scalar/openapi-parser@0.29.12` → `@scalar/openapi-validator@0.1.11` → `@scalar/json-schema-validator@0.1.11` → `ajv@8.20.0` → `fast-uri@3.1.8` | Resolve compatible `fast-uri >=3.1.9`, retaining specification-reference and generated-contract tests. Valo's official-source fetcher uses its own URL/IP controls; this installed generator dependency alone does not demonstrate SSRF in that fetcher. |
| 6 — style tooling | `artifacts/valo` dev dependency `@tailwindcss/typography@0.5.20` → `postcss-selector-parser@6.0.10` | Resolve compatible `>=6.1.5` on the current major and rebuild styles. Maintainer distinguishes untrusted selector parsing from ordinary build-time trusted CSS. No user-selector parsing route was identified. |
| Lower — affected method unobserved | `artifacts/api-server` → `express@5.3.0` → `qs@6.16.0`, also through `body-parser@2.3.0` | Compatible `qs >=6.16.1` update and query-handling regression checks. The advisory concerns comma-format stringification, not all query parsing. No current call to that affected stringification operation was identified. |
| Lower — current parents call unaffected UUID method | `artifacts/api-server` → `@replit/object-storage@1.0.0` → `@google-cloud/storage@7.22.0` → `gaxios@6.7.1` / `teeny-request@9.0.0` → `uuid@9.0.1` | Exact upstream parent sources use `v4()` without caller-provided output buffers. The advisory affects `v3`/`v5`/`v6` supplied-buffer methods; therefore those observed parent call paths do not trigger it. Maintainer severity is Moderate while the retained scanner calls it High. Record this limited reachability disposition rather than forcing an untested UUID major replacement. A supported parent upgrade must retain private upload/download/checksum and document-export tests. |

Zod `4.6.5` also appears in Orval's generated-schema toolchain through `@orval/zod@8.41.0` and Scalar types. A successful runtime migration must not obscure remaining generator copies.

## Advisory inventory and verified patch targets

| Package/version in scan | Advisory URL | Reported patched version relevant to installed major |
| --- | --- | --- |
| body-parser 2.3.0 | [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828) | 2.4.0 |
| Zod 3.25.76 and 4.6.5 — two findings | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | 4.6.6; major migration for current v3 consumers |
| PostCSS 8.4.31 | [GHSA-6g55-p6wh-862q](https://github.com/postcss/postcss/security/advisories/GHSA-6g55-p6wh-862q) | 8.5.12; later related fixes require 8.5.23 |
| PostCSS 8.4.31 | [GHSA-fxqj-rqcc-2cmp](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) | 8.5.23 |
| PostCSS 8.4.31 | [GHSA-qx2v-qp2m-jg93](https://github.com/postcss/postcss/security/advisories/GHSA-qx2v-qp2m-jg93) | 8.5.10 |
| PostCSS 8.4.31 | [GHSA-r28c-9q8g-f849](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849) | 8.5.18 |
| Undici 7.29.1 | [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx) | 7.30.1 |
| Undici 7.29.1 | [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685) | 7.30.1 |
| Undici 7.29.1 | [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26) | 7.30.1 |
| Undici 7.29.1 | [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6) | 7.30.1 |
| Undici 7.29.1 | [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6) | 7.30.1 |
| Undici 7.29.1 | [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472) | 7.30.1 |
| Undici 7.29.1 | [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm) | 7.30.1 |
| Undici 7.29.1 | [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) | 7.30.1 |
| fast-uri 3.1.8 | [GHSA-333x-w4r6-6crp](https://github.com/fastify/fast-uri/security/advisories/GHSA-333x-w4r6-6crp) | 3.1.9 |
| fast-uri 3.1.8 | [GHSA-w74x-v6f9-j3xg](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg) | 3.1.9 |
| fast-uri 3.1.8 | [GHSA-wjr9-j795-jxcr](https://github.com/fastify/fast-uri/security/advisories/GHSA-wjr9-j795-jxcr) | 3.1.9 |
| fast-uri 3.1.8 | [GHSA-xhq7-xmqj-769h](https://github.com/fastify/fast-uri/security/advisories/GHSA-xhq7-xmqj-769h) | 3.1.9 |
| postcss-selector-parser 6.0.10 | [GHSA-rj75-hqrm-r3gf](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf) | 6.1.5 |
| qs 6.16.0 | [GHSA-6pq8-jhm2-2vcw](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw) | 6.16.1 |
| uuid 9.0.1 | [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) | 11.1.1 or another supported patched major; do not blindly override |

Inventory identifiers and targets come from the retained scan. Primary-source checks included body-parser, UUID, qs, PostCSS's final related fix, selector-parser, fast-uri host handling, the Undici advisory pages, and the [Zod maintainer fix](https://github.com/colinhacks/zod/pull/6652). The following exact upstream source versions substantiate the UUID call-path assessment: [gaxios 6.7.1](https://github.com/googleapis/gaxios/blob/v6.7.1/src/gaxios.ts) and [teeny-request 9.0.0](https://github.com/googleapis/teeny-request/blob/v9.0.0/src/index.ts).

## Closure evidence required

For each targeted repair retain the new locked version and dependency path, scanner readback, relevant behavior tests and exact-commit CI. Classify each original finding as fixed, not reachable through the inspected current call path, or unresolved; a reachability disposition is not removal of a vulnerable package. Do not claim dependency upgrades solve the separate origin-validation, mutation-quota, membership-revocation or active-export crash-recovery findings. Do not infer production readiness from a clean dependency scan alone.
