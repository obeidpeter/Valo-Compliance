# Valo Compliance — Valo Platform

Valo is being built for Nigerian SMEs to create business documents and understand source-backed business obligations.

**Status: early R1/P0 implementation. Not launched; P0 has not passed.**

## Implemented source in this branch

- Framework-independent editorial eligibility validation with strict schemas, candidate/source/policy/review/test/export bindings and fail-closed holds.
- Executable traceability currently covers the 12 editorial requirements, EDP-001–EDP-012. The complete supplied TRD with all 127 exact requirements is now available in this branch's specification and register baseline; integrating the other 115 into executable tracking remains required.
- Metadata for the original 40-template baseline and 19 provisional additional candidates. All templates are held; zero published templates.
- Requirements, content, conflict and platform-source research registers.
- Executable foundation unit tests and a machine-readable readiness report.

## Complete specification baseline

The master execution prompt, TRD v1.1, Roadmap v1.1 and Essential Business Documents extracts are preserved in [the specification baseline](docs/specification/). The [registers](docs/registers/) contain all 127 exact requirements, the 40 baseline templates, all 27 supplementary mappings and all 79 regulatory source rows. These files were brought from the original specification review branch without reconstructing missing requirements or changing application behavior. Content remains held and implementation status remains unverified. The missing-source-documents blocker is resolved at repository level; the Replit workspace and executable registers still need to consume this baseline.

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

After secure GitHub reconnection, the previously rejected workflow-file write succeeded. CI is active at `.github/workflows/valo-foundation.yml`. The activation commit's push and pull-request runs both passed dependency installation, full typechecking, foundation tests and the readiness report. Actual run identifiers, source commit and step results are preserved in [CI evidence](docs/valo/evidence/ci-activation.json).

CI check names must only be added as requirements after actual checks exist. Even then, account-plan restrictions may prevent enforcement. No protection setting or required-check configuration has been changed. Foundation CI is not evidence of P0 acceptance.
