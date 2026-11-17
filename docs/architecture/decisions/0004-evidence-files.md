# 0004 — Keep existing evidence files; record new evidence in CI

Date: 2026-11-16. Status: accepted.

## Context

Roughly half the repository by size is evidence JSON and checkpoint prose under
`docs/valo/`. Tests and the inference package pin many of these files by path
and hash, so moving or rewriting them breaks verification.

## Decision

Leave existing evidence files where they are. Do not add new evidence files to
the main tree. New run evidence is uploaded as CI artifacts and summarised in
pull requests.

## Consequences

- Historical verification keeps working.
- The repository stops growing with every checkpoint.
