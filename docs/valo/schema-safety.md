# Development schema changes: fail-closed execution

## Implemented behaviour

The database package's `push` command now calls a guarded wrapper, not Drizzle
directly. The wrapper:

- Requires `NODE_ENV=development`, no deployment marker and explicit reviewed
  development / synthetic-test acknowledgements.
- Rejects arbitrary CLI arguments and the existing `push-force` path.
- Bounds subprocess duration/output and disables interactive input.
- Treats process failure, missing completion markers, SQLSTATEs and reported SQL
  errors as failure, including the previously observed **exit-zero SQL error**.
- Does not run postcondition tests after a failed/partially applied operation.
- Requires non-skipped successful application database tests after an otherwise
  clean command. A skipped suite or unrecognised verifier output fails.
- Emits only safe categories and counts, not raw SQL, connection strings or
  provider credentials.

The explicit development invocation is:

```sh
NODE_ENV=development \
VALO_SCHEMA_PUSH_ACK=reviewed-development-only \
VALO_RUN_DB_TESTS=synthetic-development-only \
pnpm --filter @workspace/db push
```

This is for the authorised development migration owner after inspecting the
actual database, reviewing the proposed change and confirming the environment.
It is not a production migration command, a startup hook or a way to bypass
review. No schema mutation was run for this checkpoint: the command's blocked
path, regression cases and existing database postconditions were tested.

## Evidence and limits

Seventeen guard tests passed, including a real subprocess proving nonzero exit
without acknowledgement. The existing development PostgreSQL suite passed all
14 runner entries (including parent test entries); it exercised actual tenant,
concurrency, history, foreign-key and durable-ticket behaviour with synthetic
fixtures.

The previous SQL failure is replayed from its retained log against the guard.
That is evidence of failure detection, not a newly executed migration or a
repair to the old partially applied state. See the handover execution record.

Even a passing wrapper returns `schemaAcceptance: false` and
`productionCompatibilityAccepted: false`: development command/application checks
do not prove reviewed migration equivalence, clean production-shaped staging,
queue functions/grants, least-privilege/RLS, production recovery or deployment
approval. The known migration ordering/introspection issue remains open.

Managed production schema changes remain owned by the supported Replit Publish
flow, subject to Valo's launch approvals and documented unsupported-object
limitations. No production DDL, force push, automatic rollback, backup copy,
hosting purchase or public launch was added.
