/** Test-only composition: portable SQL proofs must never invoke native storage,
 * even when the runner accidentally inherits real provider configuration. */
import { mock } from "node:test";
if (process.env.VALO_ERASURE_STORAGE_PROOF !== "portable")
  throw Error("PORTABLE_STORAGE_GUARD_MODE_REQUIRED");
const url = new URL("../lib/valo-private-storage.ts", import.meta.url).href;
const original = await import(url);
let attempted = 0;
const denied = async () => {
  attempted++;
  process.exitCode = 1;
  throw Error("NATIVE_STORAGE_FORBIDDEN_IN_PORTABLE_PROOF");
};
mock.module(url, {
  namedExports: {
    ...original,
    writePrivateFile: denied,
    readPrivateFile: denied,
    deletePrivateFile: denied,
    anonymousPrivateFileStatus: denied,
  },
});
process.on("beforeExit", () => {
  if (attempted) process.exitCode = 1;
});
