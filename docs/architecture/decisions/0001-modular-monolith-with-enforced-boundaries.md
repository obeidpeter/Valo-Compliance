# 0001 — Modular monolith with enforced module boundaries

Date: 2026-11-16. Status: accepted.

## Context

The brief asks for a modular monolith. The API has grown into one flat folder
of 202 files; 90 source files use the database directly and three import cycles
exist. Changes in one area routinely break another, and parallel branches
conflict on the same shared files.

## Decision

Keep one deployable application and one database. Organise the API into
`platform/` (settings, database, identity, queue, storage, logging, errors) and
one folder per business capability under `modules/`. A module exposes a single
`index.ts`; other code may import only that file. Only `platform/` reads
environment variables. Tooling enforces these rules in CI.

## Consequences

- Each move is mechanical and lands separately from behaviour changes.
- Cross-module calls become explicit and reviewable.
- Microservices remain unnecessary; the modules can be split later only if a
  measured need appears.
