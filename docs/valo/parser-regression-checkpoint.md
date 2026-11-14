# Compressed-request parser regression

GHSA-27r3-jxmh-p828 affected the retained historical Express 5.3.0 → body-parser 2.3.0 path. The existing repair in application commit `f0d50f3` resolved body-parser 2.4.0 through Express's compatible dependency range and configured `express.json({ limit: "128kb", inflate: false })`.

The size limit alone is not the repair. Compressed JSON is deliberately unsupported: the API returns `415` with `UNSUPPORTED_CONTENT_ENCODING` before entering a decompressor. Customers should send ordinary uncompressed JSON.

## Executable isolated proof

```sh
VALO_PARSER_CHECKPOINT=synthetic-development-only \
  pnpm --filter @workspace/api-server exec tsx src/scripts/parser-regression-checkpoint.ts
```

The guarded harness starts the actual API in a separate development process bound to loopback. It checks valid gzip, truncated gzip, gzip with hostile trailing bytes, deflate and Brotli individually. After **each** rejection it checks HTTP health, the same child's exit/signal state and its IPC connection.

Separate cases check the ordinary 128 KiB limit, structural collection limit, malformed uncompressed JSON (`400`) and valid uncompressed JSON reaching the private document route's authentication requirement (`401`, not an accepted `403` alternative). No authentication bypass or synthetic success endpoint is added to the application.

The test also resolves body-parser **from Express's actual installed module path** and guards against a return to the affected compatible release range.

Actual results and exact source/lockfile hashes are retained in:

- `evidence/parser-regression.json`
- `evidence/parser-regression.tap.txt`
- `evidence/parser-regression-generator-path.txt`

## Undici reachability distinction

The historical npm Undici 7.29.1 findings were observed through Orval's specification-generation development dependencies. The direct parent is now Orval 8.47.0, updated within its existing major; its resolved branches use patched Undici 7.30.1 and 8.12.3. The generator configuration consumes the repository's `openapi.yaml`; regeneration and type checking passed in the prior content/dependency checkpoint.

The recorded API production dependency query identifies no npm Undici path. The current Node built-in Undici version is recorded separately. Repository source/import inspection did not identify Orval/Scalar generator imports in the API or customer AI adapter.

This is **not** evidence of an observed production TLS exploit, nor proof that tooling is absent from an eventual deployment filesystem. No production deployment or filesystem inventory was performed. Generator tooling, runtime built-ins and application import paths must remain distinct in the deployment assessment.

This targeted closure does not close the separate legacy-Zod finding, complete the 80/60/60 acceptance suites or accept R1/R2. Public launch and live payments remain disabled.
