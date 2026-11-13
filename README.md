# Valo Compliance — Valo Platform

Valo is being built for Nigerian SMEs to create business documents and understand source-backed business obligations.

**Status: early R1/P0 implementation. Not launched; P0 has not passed.**

## Implemented source in this branch

- Framework-independent editorial eligibility validation with strict schemas, candidate/source/policy/review/test/export bindings and fail-closed holds.
- Traceability for the 12 exact editorial requirements supplied so far, preserving EDP-001–EDP-012. The expected formal TRD total is 127; the missing 115 are not reconstructed.
- Metadata for the original 40-template baseline and 19 provisional additional candidates. All templates are held; zero published templates.
- Requirements, content, conflict and platform-source research registers.
- Executable foundation unit tests and a machine-readable readiness report.

## Not yet implemented or proven

The customer-facing application, verified customer sign-in and recovery, tenant-scoped business/document persistence, private DOCX/PDF exports, actual server AI review pipeline, pg-boss worker proof and backup/restore remain incomplete. Clerk development provisioning alone is not sign-in proof.

The separate **80-rule**, **60-customer-AI** and **60-editorial** acceptance suites remain unexecuted. Foundation tests do not count toward those suites. No R1 gate is accepted and R2 is locked. R3 is excluded.

## Development checks

Use Node.js 22 or newer and pnpm 10.26.1.

```sh
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/scripts test:valo
pnpm --filter @workspace/scripts valo:readiness
```

No credential values belong in source or GitHub Actions. Foundation checks require no provider secrets or production access. See [implementation evidence](docs/valo/README.md), [compatibility findings](docs/valo/compatibility.md) and [evaluation boundaries](docs/valo/evaluations.md).

## Release restrictions

Public launch, live payments, recurring billing, real confidential customer data and new paid hosting/subscription commitments remain disabled pending the required approvals. Use synthetic development data and sandbox transactions only.

The preferred application stack remains Next.js, TypeScript, Tailwind, PostgreSQL/Drizzle, Clerk, private storage, separate pg-boss workers, DOCX/Chromium PDF, Paystack hosted sandbox checkout, email and server AI. The frontend bootstrap conflict is recorded, not silently resolved by substituting a different stack.

## Repository safeguards

The intended repository is private: `obeidpeter/Valo-Compliance`. Feature work is submitted through a draft pull request; the original README-only main commit is preserved.

**Main-branch protection enforcement is blocked under the current private-repository account plan**, as reported by the repository owner. A saved rule is not enforced protection. Do not claim main is protected, upgrade or transfer the repository, make it public, force-push, delete branches or bypass review.

CI configuration is prepared at `docs/valo/ci/valo-foundation.yml` but is **inactive**. Upload with an active Actions workflow was rejected; a basic tree write succeeded. The connection needs workflow-file write authorization before this can be installed at `.github/workflows/valo-foundation.yml`.

CI check names must only be added as requirements after actual checks exist. Even then, account-plan restrictions may prevent enforcement. No protection setting or required-check configuration has been changed. No GitHub CI run has been claimed.
