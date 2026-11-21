# 0013 — Move the AI lanes into a module of their own

Date: 2026-11-18. Status: accepted (owner instruction "implement all", given in reply to the
proposal to carry out this move) and implemented in the four commits below.

## Context

Thirteen files in `artifacts/api-server/src/lib` (2,304 lines) hold the AI work that runs through
the finite dispatcher in `modules/ai`:

| Files | What they hold |
| --- | --- |
| `valo-customer-ai.ts`, `valo-customer-ai-domain.ts`, `valo-customer-ai-model.ts`, `valo-customer-case-binding.ts`, `inference-customer-controls.ts`, `inference-customer-evaluation.ts`, `inference-customer-manifest.ts`, `inference-customer-runtime.ts` | The customer AI lane: drafts and their model contract, and the customer evaluation cases with their fault controls |
| `inference-operational-ready.ts`, `inference-prepared-report.ts` | The operational review lane |
| `inference-history-loader.ts` | The history loader the history reconciliation and budget proposal commands use |
| `inference-work-bindings.ts` | The work-binding checks the operator commands hand the dispatcher (`provideFiniteWorkBindings`) |
| `inference-operational-coverage.ts` | The 17 original operational templates whose intake, permission and arithmetic contracts are current |

The plan said these files "would form an import cycle with `modules/ai`, the catalogue,
publication and editorial whether they joined `modules/ai` or became a module of their own". The
repository rules fail CI on any import cycle, type-only and lazy imports included.

The import graph of the API's non-test source was measured with static, dynamic and type-only
imports, as the rule counts them. Every import from a module into the thirteen files lands on one
of them, `inference-operational-coverage.ts`:

- `modules/ai/inference-allocation-package.ts`;
- `modules/editorial/content-intake-preparation.ts` and `operational-preparation.ts`;
- `modules/publication/operational-intake.ts`, `operational-mechanical.ts` and
  `rights-applicability.ts`.

That file is 27 lines: a list of template IDs and a function that checks one against it. It
imports nothing. It describes what the operational intake supports, which is publication's
domain, not AI work.

The other twelve files import `modules/ai`, `modules/publication` (`inference-history-loader.ts`
and `inference-operational-ready.ts` statically; `inference-customer-evaluation.ts` for a type),
`modules/rules` (`valo-customer-ai.ts`) and, from `inference-work-bindings.ts` alone and lazily,
`modules/editorial`. Today `modules/editorial` imports `modules/ai`; of the other modules,
`modules/ai`, `modules/publication` and `modules/rules` import only `modules/sources`.

Each placement was checked for cycles across the whole graph:

| Placement | Result |
| --- | --- |
| All thirteen into `modules/ai` | Cycle through `modules/ai`, catalogue, editorial and publication |
| All thirteen into a module of their own | Cycle through that module, `modules/ai`, catalogue, editorial and publication |
| Coverage into `modules/publication`, the other twelve into `modules/ai` | Cycle: `modules/ai` and `modules/editorial` import each other |
| Coverage into `modules/publication`, the work-binding checks into `modules/editorial`, the other eleven into `modules/ai` | No cycle |
| Coverage into `modules/publication`, the other twelve into a module of their own | No cycle. Nothing in `modules/` imports the new module |

So the plan's statement holds only while the coverage list moves with the lanes.

Wherever the lanes go, the index they are reached through must load no database client:
- `modules/ai`'s index must load neither the database client nor the model SDK, and
  `inference-no-database.test.ts` fails if it does.
- CI runs `scripts/finite-inference-run.ts` with an empty `DATABASE_URL`
  (`managed-inference-entry.test.ts`), and the script imports two lane files at the top.
- `scripts/reminder-candidate-inputs.ts` uses a lane file and no database at all.

Two lane files load the database client when imported:
- `inference-operational-ready.ts`;
- `valo-customer-ai.ts`, both directly and through `modules/rules`, whose `valo-assessments.ts`
  imports `@workspace/db` at the top.

## Decision

Move the lanes into a module of their own, `modules/ai-lanes`, above `modules/ai`, in four
commits.

1. Rename one of the two different functions named `prepareCustomerFiniteManifest`, so one index
   can export both:
   - `inference-customer-evaluation.ts:228` builds a manifest from an evaluation plan;
   - `inference-customer-manifest.ts:24` reads an authored case and prepares its manifest.

   No behaviour changes.
2. Load the database client, and `modules/rules`, only inside the functions that use them in
   `inference-operational-ready.ts` and `valo-customer-ai.ts`, as the source controls do
   (`modules/sources/valo-source-controls.ts`). No behaviour changes once a function runs.
3. Move `inference-operational-coverage.ts` into `modules/publication`, beside the operational
   intake it describes, and export it from that index. `modules/ai` then imports
   `modules/publication`, a new edge. `modules/publication` must never import `modules/ai`, and
   today it does not.
4. Move the other twelve files, their tests and the customer AI fixtures into
   `modules/ai-lanes`, behind an `index.ts`. Its imports of `modules/ai`, editorial, publication and
   rules go through their indexes. The customer AI route and the scripts import the new index.
   The `inference-bindings` rule matches the identifier `assertFiniteWorkBindings`, not its file,
   so neither `FINITE_WORK_BINDING_ENTRIES` nor the rule changes.

The package scripts and the citations in `docs/registers/ci-evidence.json` that name the moved
test files take their new paths in step 4's commit.

## How it will be checked

- `pnpm run lint`: the architecture check reports no import cycle, type-only and lazy imports
  included, and no import of a module's file from outside it (`module-boundary`).
- `inference-no-database.test.ts` still imports `modules/ai`'s index without loading
  `@workspace/db`, the SDK or the provider transport. That index gains only the coverage list's
  edge to publication, whose index loads no database client either. The test also imports the
  new module's index the same way.
- `managed-inference-entry.test.ts` still runs `scripts/finite-inference-run.ts` with an empty
  `DATABASE_URL`.
- The moved tests run in the same CI steps from their new paths, and `valo:ci-evidence` checks
  that every citation of them passed. Local runs of the foundation and postgres jobs pass before
  the pull request opens.

## Consequences

- `modules/ai` stays the finite inference core: the budget, ledger, history, manifests,
  allocation packages and dispatcher. The lanes are its clients, so the dependency runs one way.
- The target structure gains a module that the list in `docs/architecture/README.md` does not
  have. The README and the plan change with the move.
- Lane code must keep loading the database client inside functions, or the new module's index
  stops loading without a database. The extended test catches that.
- Of what the plan lists as still in `src/lib`, the store (decision 0012) and the recovery and
  operations helpers remain.

## Alternatives considered

**Into `modules/ai`, with the work-binding checks in `modules/editorial`.** This is cycle-free
too, needs the same rename and lazy loading, and adds no module. But it has two costs:
- The finite inference core and its clients would share one index, and `modules/ai` would gain
  an edge to `modules/rules`.
- It puts checks that compare approved work with editorial and publication state into the
  editorial module, which does not own them.

A reviewer who prefers the target structure as listed can choose it. Steps 1 to 3 are the same.

**Leave the lanes in `src/lib`.** Nothing is wrong with them where they are, but `src/lib` keeps
files no module owns, and the plan's reason for leaving them, the cycle, does not hold.

## Decisions for the product owner

None. The move changes no behaviour, data, spending or approval. The module name is open to
review before the move.
