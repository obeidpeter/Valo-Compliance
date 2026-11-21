# 0006 — The repository is public

Date: 2026-11-16. Status: accepted (owner decision).

## Context

The brief asked for a private repository, and earlier work held uploads whenever
GitHub reported public visibility. On 16 November 2026 the repository was found
public, and the owner confirmed that this is intended.

## Decision

The repository stays public. Pushes are not held because of visibility.

## Consequences

- Every commit is published. Secrets, credentials, real customer data and
  private business details must never be committed; CI secret scanning stays
  mandatory.
- Earlier "must remain private" statements in historical documents are superseded.
