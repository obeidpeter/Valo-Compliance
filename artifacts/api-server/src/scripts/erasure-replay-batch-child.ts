import { pool } from "@workspace/db";
import { z } from "zod";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
import {
  replayErasedApplication,
  erasureReplayVerificationCounts,
  closePrivacyErasureLocks,
} from "../modules/privacy";
assertDevelopmentRuntime();
if (process.env.VALO_ERASURE_BATCH_CHILD !== "new-synthetic-fixture-only" || !process.send)
  throw Error("ISOLATED_REPLAY_CHILD_REQUIRED");
let busy = false;
const onMessage = async (raw: unknown) => {
  if (raw === "stop") {
    await closePrivacyErasureLocks();
    await pool.end();
    process.disconnect?.();
    return;
  }
  if (busy) throw Error("ONE_BATCH_AT_A_TIME");
  busy = true;
  try {
    const { caseId } = z.object({ caseId: z.string().uuid() }).strict().parse(raw),
      keys: string[] = [];
    const result = await replayErasedApplication(caseId, async (key) => {
      keys.push(key);
    });
    process.send?.({ type: "batch", result, keys, verification: erasureReplayVerificationCounts() });
  } catch (error) {
    process.send?.({
      type: "error",
      message: error instanceof Error ? error.message : "REPLAY_CHILD_FAILED",
    });
  } finally {
    busy = false;
  }
};
// A failure ends this child with an unhandled rejection, as it did when the listener was async.
process.on("message", (raw) => void onMessage(raw));
process.send({ type: "ready" });
