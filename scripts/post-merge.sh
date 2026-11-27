#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm install --frozen-lockfile
pnpm run typecheck

# A task merge is not migration approval. Never supply schema-push acknowledgements,
# run automatic schema reconciliation, or bypass the guarded database command here.
# Reviewed migrations and their database postconditions run separately.
printf '%s\n' '{"postMergeSetup":"passed","schemaApplied":false,"schemaAcceptance":false}'
