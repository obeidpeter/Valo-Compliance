import { environment } from "./settings";
/** Set only by the isolated recovery operator. A nonempty marker is fail-closed. */
export function assertRecoveryEffectsAllowed(env: NodeJS.ProcessEnv = environment()) {
  if (env.VALO_ISOLATED_RECOVERY)
    throw Object.assign(new Error("RECOVERY_EXTERNAL_EFFECTS_DISABLED"), {
      code: "RECOVERY_EXTERNAL_EFFECTS_DISABLED",
    });
}
