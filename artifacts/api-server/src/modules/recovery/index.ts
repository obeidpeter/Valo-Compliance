/**
 * The recovery module's public entry: the signed recovery controls that the isolated recovery and
 * the separate-host replay apply, and the checks that their target is a disposable recovery
 * database. The recovery erasure brings its own database driver and the privacy module, so this
 * file does not load it: only the guarded recovery child does, through `loadRecoveryErasure` and
 * only when it runs. Code outside artifacts/api-server/src/modules/recovery imports only this file
 * (repository rule `module-boundary`); tests may import the module's files directly.
 */
export * from "./valo-recovery-controls";
export const loadRecoveryErasure = () => import("./valo-recovery-erasure");
