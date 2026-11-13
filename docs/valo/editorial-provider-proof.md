# Valo editorial execution checkpoint

This is a development implementation checkpoint, not G0, R1/R2 acceptance,
publication eligibility, legal certification or production readiness.

## Working execution

The operator-only development pipeline reads the retained official CAC CAMA PDF's
extracted text through the private native-storage adapter. The actual numbered
section and adjacent page are selected from that text; no unavailable text is
reconstructed. The retained metadata-title mismatch, current amendments,
effectivity and rights remain unresolved.

The pipeline reserves separate PostgreSQL records for drafting, factual review
and challenge. Each has a distinct run ID, role-specific prompt, source hash,
model/configuration linkage and completion/failure state. Drafting cannot call
a release endpoint. Neither reviewer receives the other's result.

The successful execution used `gpt-5.4-mini-2026-03-17` via server-side Replit AI
Integrations. Measured provider-call latencies were 7,944 ms drafting, 1,329 ms
factual review and 3,310 ms challenge. These are three observed call timings,
not p95 performance or throughput evidence.

The factual result was **pass**, the challenge result was **hold**.
Deterministic passage/snapshot linkage rejected **15** claimed quote mappings on
the exact candidate. Mandatory policy, source currentness, rights, full scope,
export-sample and credential-isolation gates also remain unresolved. The outcome
is **held**, with zero published items. A model's pass did not override a failed
mechanical check or the conflicting review.

`docs/valo/evidence/p0-editorial-provider-proof.json` contains actual IDs,
hashes, telemetry and hold reasons. Candidate bodies, source excerpts, prompts
and review findings are private artifacts, not public library entries or Git
exports. The development dashboard exposes safe metadata only.

## Failures retained, not replaced with success

Three earlier `gpt-5-mini` generation attempts failed in the SDK's connection
path. Their six dependent reviews were held without provider calls. Those
PostgreSQL records are retained. Input-validation-only diagnostic requests
returned HTTP 400, while the model-list route returned 405. Neither response was
treated as a successful inference. The root cause of those model-specific
connection failures is not established; the supported alternative's actual
three-call execution is the evidence, not a claim that the old model is fixed.

Source preparation initially failed because layout extraction inserted marginal
headings inside a sentence. Selection now uses the actual numbered provision;
it does not strip inconvenient exceptions or weaken exact quote validation.

## Safety and configuration

- `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` are managed
  server-only configuration. No values are retained in the repository or logs.
- Usage is billed through existing Replit credits. No hosting, subscription or
  commercial spend approval is inferred.
- Explicit `NODE_ENV=development`,
  `VALO_RUN_EDITORIAL_PROOF=official-development-only`, and absence of a deployed
  environment are required. There is no public mutation endpoint.
- Nine potentially billable/reserved role calls per rolling 24 hours are the
  current technical development ceiling, atomically reserved under a database
  advisory lock. Dependency-held roles that never called the provider do not
  consume that ceiling. This is not an approved commercial allowance or budget.
- Requests have a 45-second timeout, no SDK retries, no tools and a bounded
  structured schema. Reviewer concurrency is two, using the provided batch
  limiter with zero retries. Failed and abandoned reservations stay observable.
- Only the selected official-source bundle and exact candidate are transmitted.
  No customer drafts, profiles, credentials, payment or filing tools are sent.
- Raw prompts/outputs are excluded from routine logs. Private artifacts are
  checksum-verified on storage and readback; existing keys cannot be reused by
  the adapter.
- OpenAI/Replit AI processor geography, contract, retention and confidential-data
  settings remain unapproved. No zero-retention claim is made.

## Execute and inspect

```sh
NODE_ENV=development VALO_RUN_EDITORIAL_PROOF=official-development-only \
  pnpm --filter @workspace/api-server run editorial:proof-development

pnpm --filter @workspace/api-server run test:valo-editorial
NODE_ENV=development VALO_RUN_EDITORIAL_TESTS=official-development-only \
  pnpm --filter @workspace/api-server run test:valo-editorial-proof
```

The proof script records a held result even when a provider fails, then exits
nonzero if a role is failed/missing or a provider response/private artifact is
missing. A zero exit means call execution completed, never publication approval.
Read the persisted statuses, response IDs, artifacts and hold reasons.

## Executed verification

- 12 mechanical/schema/independence/execution-status unit cases passed.
- Six real-storage/database proof checks passed (seven runner entries including
  the parent): actual response/artifact hashes, reviewer input independence,
  reproducible held outcome, anonymous storage denial, tampered-hash/overwrite
  denial, unique role/state constraints and metadata redaction.
- The reviewed `0004_valo_editorial_runs.sql` additive migration was executed
  transactionally against development and committed successfully. No schema push,
  production DDL or startup migration was run. This does not repair or accept the
  earlier incomplete schema-push path.

## Still not proved

Automatic eligible publication and a separately credentialed bounded publisher;
editorial queue restart/lease recovery; approved policy and content rights;
complete current legal evidence and claim maps; customer AI's four workflows;
the formal 60 editorial, 60 customer AI and 80 rule suites; signed-in browser
identity/recovery/MFA; production compatibility, isolated restore and independent
security/privacy/beta acceptance. All release gates remain unaccepted.
