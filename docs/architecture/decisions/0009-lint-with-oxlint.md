# 0009 — Lint with oxlint instead of ESLint

Date: 2026-11-17. Status: accepted.

## Context

The plan called for ESLint. On 17 November the registry began reporting
GHSA-fc5q-39xc-vjpf for every `picomatch` release, with no fixed version. The
owner decided that the merge gate tolerates it only inside `orval`, the
development-only API client generator. ESLint's TypeScript parser depends on
`picomatch` through `tinyglobby`, and the Next.js plugin through `fast-glob` and
`micromatch`. Adding them would fail the gate or need a wider exception.

## Decision

Lint with oxlint (1.93.0) and its type-aware companion `oxlint-tsgolint`
(7.0.2006). Both install as native programs with no JavaScript dependencies;
only their Linux x64 builds are kept, as for esbuild and rollup. Both versions
were older than the 7-day release window when added, and are pinned.

`.oxlintrc.json` runs the correctness and suspicious rules of the TypeScript,
unicorn, oxc, import, promise, node, React, Next.js and accessibility plugins,
plus type-aware rules for promises nobody awaits, promises passed where nothing
waits for them, thrown non-errors and the rules of hooks. Each rule turned off
or configured has its reason beside it. An exception in the code names the rule
and gives a reason, and an exception that no longer suppresses anything fails
the run. `pnpm run lint` runs it, so the CI lint step and `pnpm test` do.

## Consequences

- The type-aware rules run on TypeScript's Go-based compiler, not the
  TypeScript 5.9 that `tsc` uses, so the two can differ at the edges. `tsc`
  remains the type check.
- Repository-specific rules stay in the repository rules checker; oxlint runs no
  custom rules here.
- A new oxlint version can add rules to the categories, so an upgrade fixes its
  new findings in the same change.
- The first run changed no behaviour except one link: the reminders screen's
  "Contact support" link ignored the base path the router applies, and now goes
  through the router like the app's other internal links.
